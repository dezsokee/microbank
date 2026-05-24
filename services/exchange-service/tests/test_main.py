import sys
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main  # noqa: E402


LIVE_RATES_BODY = {
    "base": "EUR",
    "rates": {
        "USD": 1.10,
        "GBP": 0.85,
        "HUF": 400.0,
        "RON": 5.0,
        "CHF": 0.95,
        "JPY": 160.0,
    },
}


@pytest.fixture(autouse=True)
def _reset_cache():
    main._rates_cache = {}
    main._rates_cache_ts = 0.0
    main._rates_cache_source = "uninitialized"
    yield


@pytest.fixture
def client():
    return TestClient(main.app)


def _install_mock_transport(monkeypatch, handler):
    """Replace httpx.Client with one bound to a MockTransport built from `handler`."""
    transport = httpx.MockTransport(handler)
    original_client = httpx.Client

    def factory(*args, **kwargs):
        kwargs["transport"] = transport
        return original_client(*args, **kwargs)

    monkeypatch.setattr(main.httpx, "Client", factory)


def test_list_rates_returns_live_when_upstream_ok(monkeypatch, client):
    calls = {"count": 0}

    def handler(request):
        calls["count"] += 1
        return httpx.Response(200, json=LIVE_RATES_BODY)

    _install_mock_transport(monkeypatch, handler)

    resp = client.get("/api/v1/exchange-rates")
    assert resp.status_code == 200
    body = resp.json()
    assert body["base"] == "EUR"
    assert body["source"] == "live"
    assert set(body["rates"].keys()) == {"USD", "GBP", "HUF", "RON", "CHF", "JPY"}
    assert body["rates"]["USD"] == pytest.approx(1.10)
    assert calls["count"] == 1


def test_list_rates_falls_back_when_upstream_errors(monkeypatch, client):
    def handler(request):
        raise httpx.ConnectError("upstream unreachable", request=request)

    _install_mock_transport(monkeypatch, handler)

    resp = client.get("/api/v1/exchange-rates")
    assert resp.status_code == 200
    body = resp.json()
    assert body["source"] == "fallback"
    assert body["rates"]["USD"] == pytest.approx(main.FALLBACK_RATES["USD"])


def test_list_rates_falls_back_on_non_2xx(monkeypatch, client):
    def handler(request):
        return httpx.Response(500, json={"error": "boom"})

    _install_mock_transport(monkeypatch, handler)

    resp = client.get("/api/v1/exchange-rates")
    assert resp.status_code == 200
    assert resp.json()["source"] == "fallback"


def test_get_rate_uses_live_value(monkeypatch, client):
    def handler(request):
        return httpx.Response(200, json=LIVE_RATES_BODY)

    _install_mock_transport(monkeypatch, handler)

    resp = client.get("/api/v1/exchange-rates/EUR/USD")
    assert resp.status_code == 200
    assert resp.json()["rate"] == pytest.approx(1.10, rel=1e-3)


def test_cache_ttl_avoids_repeat_fetches(monkeypatch, client):
    calls = {"count": 0}

    def handler(request):
        calls["count"] += 1
        return httpx.Response(200, json=LIVE_RATES_BODY)

    _install_mock_transport(monkeypatch, handler)

    client.get("/api/v1/exchange-rates")
    client.get("/api/v1/exchange-rates")
    client.get("/api/v1/exchange-rates/EUR/USD")
    assert calls["count"] == 1


def test_convert_uses_live_rate(monkeypatch, client):
    def handler(request):
        return httpx.Response(200, json=LIVE_RATES_BODY)

    _install_mock_transport(monkeypatch, handler)

    resp = client.post(
        "/api/v1/exchange-rates/convert",
        json={"from": "EUR", "to": "USD", "amount": 100},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["from"] == "EUR"
    assert body["to"] == "USD"
    assert body["originalAmount"] == 100
    assert body["rate"] == pytest.approx(1.10, rel=1e-3)
    assert body["convertedAmount"] == pytest.approx(110.0, rel=1e-3)


def test_unsupported_currency_returns_400(monkeypatch, client):
    def handler(request):
        return httpx.Response(200, json=LIVE_RATES_BODY)

    _install_mock_transport(monkeypatch, handler)

    resp = client.get("/api/v1/exchange-rates/EUR/XYZ")
    assert resp.status_code == 400
    assert resp.json()["error"] == "UNSUPPORTED_CURRENCY"


def test_healthz(client):
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "UP", "service": "exchange-service"}
