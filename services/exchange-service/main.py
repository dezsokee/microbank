import logging
import json
import os
import random
import sys
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from prometheus_fastapi_instrumentator import Instrumentator


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
# Configuration
# ---------------------------------------------------------------------------

PORT = int(os.getenv("PORT", "8085"))

BASE_RATES: dict[str, float] = {
    "EUR": 1.0,
    "USD": 1.08,
    "GBP": 0.86,
    "HUF": 395.50,
    "RON": 4.97,
    "CHF": 0.94,
    "JPY": 162.30,
}

SUPPORTED_CURRENCIES = set(BASE_RATES.keys())

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="MicroBank Exchange Rate Service",
    version="1.0.0",
)

Instrumentator().instrument(app).expose(app, endpoint="/metrics")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _fluctuate(rate: float) -> float:
    """Apply +/-0.5 % random fluctuation to a rate."""
    return round(rate * (1 + random.uniform(-0.005, 0.005)), 4)


def _get_rate(from_curr: str, to_curr: str) -> float:
    """
    Return the exchange rate from *from_curr* to *to_curr*.

    All base rates are expressed relative to EUR, so conversion between two
    non-EUR currencies goes through EUR:
        from_curr -> EUR -> to_curr
    """
    if from_curr == to_curr:
        return 1.0

    # from_curr -> EUR
    from_eur = 1.0 / _fluctuate(BASE_RATES[from_curr])
    # EUR -> to_curr
    to_eur = _fluctuate(BASE_RATES[to_curr])

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
    rates = {
        currency: _fluctuate(rate)
        for currency, rate in BASE_RATES.items()
        if currency != "EUR"
    }
    return {
        "base": "EUR",
        "rates": rates,
        "timestamp": _now_iso(),
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
        amount, from_curr, converted, to_curr, rate,
    )

    return {
        "from": from_curr,
        "to": to_curr,
        "originalAmount": amount,
        "convertedAmount": converted,
        "rate": rate,
    }
