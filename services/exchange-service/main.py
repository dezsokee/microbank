import logging
import json
import os
import sys
import threading
import time
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from prometheus_fastapi_instrumentator import Instrumentator

from opentelemetry import trace, metrics
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor


# ---------------------------------------------------------------------------
# JSON logging setup
# ---------------------------------------------------------------------------


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log_record: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info and record.exc_info[0] is not None:
            log_record["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_record)


handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(JsonFormatter())
logging.root.handlers = [handler]
logging.root.setLevel(logging.INFO)

logger = logging.getLogger("exchange-service")

# ---------------------------------------------------------------------------
# OpenTelemetry initialization
# ---------------------------------------------------------------------------

otel_resource = Resource.create(
    {
        "service.name": os.environ.get("OTEL_SERVICE_NAME", "exchange-service"),
    }
)

tracer_provider = TracerProvider(resource=otel_resource)
tracer_provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
trace.set_tracer_provider(tracer_provider)

metric_reader = PeriodicExportingMetricReader(OTLPMetricExporter())
meter_provider = MeterProvider(resource=otel_resource, metric_readers=[metric_reader])
metrics.set_meter_provider(meter_provider)

HTTPXClientInstrumentor().instrument()

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

PORT = int(os.getenv("PORT", "8085"))

RATES_API_URL = os.getenv("RATES_API_URL", "https://api.exchangerate.host/latest")
RATES_CACHE_TTL_SECONDS = int(os.getenv("RATES_CACHE_TTL_SECONDS", "300"))
RATES_API_TIMEOUT_SECONDS = float(os.getenv("RATES_API_TIMEOUT_SECONDS", "3.0"))

FALLBACK_RATES: dict[str, float] = {
    "EUR": 1.0,
    "USD": 1.08,
    "GBP": 0.86,
    "HUF": 395.50,
    "RON": 4.97,
    "CHF": 0.94,
    "JPY": 162.30,
}

SUPPORTED_CURRENCIES = set(FALLBACK_RATES.keys())
NON_EUR_SYMBOLS = ",".join(sorted(c for c in SUPPORTED_CURRENCIES if c != "EUR"))

_rates_cache: dict[str, float] = {}
_rates_cache_ts: float = 0.0
_rates_cache_source: str = "uninitialized"  # "live" | "fallback" | "uninitialized"
_rates_lock = threading.Lock()

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="MicroBank Exchange Rate Service",
    version="1.0.0",
)

Instrumentator().instrument(app).expose(app, endpoint="/metrics")
FastAPIInstrumentor.instrument_app(app)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _load_rates() -> tuple[dict[str, float], str]:
    """
    Fetch EUR-based rates for the 6 non-EUR supported currencies from the
    configured upstream provider.

    On any failure (network, non-2xx, malformed body), log a warning and
    return the hardcoded FALLBACK_RATES so the service stays available.
    """
    params = {"base": "EUR", "symbols": NON_EUR_SYMBOLS}
    try:
        with httpx.Client(timeout=RATES_API_TIMEOUT_SECONDS) as client:
            resp = client.get(RATES_API_URL, params=params)
            resp.raise_for_status()
            body = resp.json()
        upstream_rates = body.get("rates")
        if not isinstance(upstream_rates, dict):
            raise ValueError(f"upstream response missing 'rates' object: {body!r}")
        rates: dict[str, float] = {"EUR": 1.0}
        for currency in SUPPORTED_CURRENCIES:
            if currency == "EUR":
                continue
            value = upstream_rates.get(currency)
            if value is None:
                raise ValueError(f"upstream response missing currency {currency}")
            rates[currency] = float(value)
        logger.info("Loaded rates source=live from %s", RATES_API_URL)
        return rates, "live"
    except Exception as exc:
        logger.warning(
            "Failed to fetch live rates from %s, using fallback: %s",
            RATES_API_URL,
            exc,
        )
        return dict(FALLBACK_RATES), "fallback"


def _get_cached_rates() -> tuple[dict[str, float], str]:
    """Return (rates, source). Refreshes the cache if the TTL has expired."""
    global _rates_cache, _rates_cache_ts, _rates_cache_source
    with _rates_lock:
        now = time.monotonic()
        if not _rates_cache or (now - _rates_cache_ts) > RATES_CACHE_TTL_SECONDS:
            rates, source = _load_rates()
            _rates_cache = rates
            _rates_cache_ts = now
            _rates_cache_source = source
        return dict(_rates_cache), _rates_cache_source


def _get_rate(from_curr: str, to_curr: str) -> float:
    """
    Return the exchange rate from *from_curr* to *to_curr*.

    All rates are expressed relative to EUR, so conversion between two
    non-EUR currencies goes through EUR:
        from_curr -> EUR -> to_curr
    """
    if from_curr == to_curr:
        return 1.0
    rates, _ = _get_cached_rates()
    from_eur = 1.0 / rates[from_curr]
    to_eur = rates[to_curr]
    return round(from_eur * to_eur, 4)


def _error_response(status: int, error_code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={
            "error": error_code,
            "message": message,
            "timestamp": _now_iso(),
        },
    )


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class ConvertRequest(BaseModel):
    from_currency: str = Field(alias="from")
    to_currency: str = Field(alias="to")
    amount: float

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# Exception handler
# ---------------------------------------------------------------------------


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    return _error_response(exc.status_code, exc.detail, exc.detail)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/healthz")
async def health():
    return {"status": "UP", "service": "exchange-service"}


@app.get("/api/v1/exchange-rates")
async def list_rates():
    """Return all rates with EUR as the base currency."""
    logger.info("Listing all exchange rates")
    rates, source = _get_cached_rates()
    return {
        "base": "EUR",
        "rates": {
            currency: rate for currency, rate in rates.items() if currency != "EUR"
        },
        "timestamp": _now_iso(),
        "source": source,
    }


@app.get("/api/v1/exchange-rates/{from_curr}/{to_curr}")
async def get_rate(from_curr: str, to_curr: str):
    """Return a single exchange rate between two currencies."""
    from_curr = from_curr.upper()
    to_curr = to_curr.upper()

    if from_curr not in SUPPORTED_CURRENCIES:
        logger.warning("Unsupported currency requested: %s", from_curr)
        return _error_response(
            400,
            "UNSUPPORTED_CURRENCY",
            f"Currency '{from_curr}' is not supported. Supported: {sorted(SUPPORTED_CURRENCIES)}",
        )

    if to_curr not in SUPPORTED_CURRENCIES:
        logger.warning("Unsupported currency requested: %s", to_curr)
        return _error_response(
            400,
            "UNSUPPORTED_CURRENCY",
            f"Currency '{to_curr}' is not supported. Supported: {sorted(SUPPORTED_CURRENCIES)}",
        )

    rate = _get_rate(from_curr, to_curr)
    logger.info("Rate %s -> %s = %s", from_curr, to_curr, rate)
    return {
        "from": from_curr,
        "to": to_curr,
        "rate": rate,
        "timestamp": _now_iso(),
    }


@app.post("/api/v1/exchange-rates/convert")
async def convert(req: ConvertRequest):
    """Convert an amount from one currency to another."""
    from_curr = req.from_currency.upper()
    to_curr = req.to_currency.upper()
    amount = req.amount

    if from_curr not in SUPPORTED_CURRENCIES:
        logger.warning("Unsupported currency in conversion: %s", from_curr)
        return _error_response(
            400,
            "UNSUPPORTED_CURRENCY",
            f"Currency '{from_curr}' is not supported. Supported: {sorted(SUPPORTED_CURRENCIES)}",
        )

    if to_curr not in SUPPORTED_CURRENCIES:
        logger.warning("Unsupported currency in conversion: %s", to_curr)
        return _error_response(
            400,
            "UNSUPPORTED_CURRENCY",
            f"Currency '{to_curr}' is not supported. Supported: {sorted(SUPPORTED_CURRENCIES)}",
        )

    if amount < 0:
        logger.warning("Negative amount in conversion: %s", amount)
        return _error_response(
            400,
            "INVALID_AMOUNT",
            "Amount must be non-negative.",
        )

    rate = _get_rate(from_curr, to_curr)
    converted = round(amount * rate, 2)

    logger.info(
        "Converted %s %s -> %s %s (rate=%s)",
        amount,
        from_curr,
        converted,
        to_curr,
        rate,
    )

    return {
        "from": from_curr,
        "to": to_curr,
        "originalAmount": amount,
        "convertedAmount": converted,
        "rate": rate,
    }
