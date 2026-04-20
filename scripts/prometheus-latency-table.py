#!/usr/bin/env python3
"""
Query Prometheus for per-service latency and print a comparison table.
Usage:
    python scripts/prometheus-latency-table.py [--label baseline|mtls]

Prometheus is accessed via the ELB with a Host header because the ingress
uses a .local hostname.
"""

import sys
import urllib.request
import urllib.parse
import json
import argparse
import datetime

ELB = "afbca40bbde6d4710bd3d8d1bad1e82e-d549f520d5031734.elb.eu-west-1.amazonaws.com"
PROMETHEUS_HOST = "prometheus.microbank.local"
RANGE = "5m"   # look-back window — run this right after the k6 test finishes

# (display name, PromQL for p50, p95, p99, avg, rps)
SERVICES = [
    # Go services use http_request_duration_seconds
    ("auth-service",         'job="auth-service"',         "go"),
    ("api-gateway",          'job="api-gateway"',           "go"),
    ("fraud-service",        'job="fraud-service"',         "go"),
    # Spring Boot services use http_server_requests_seconds
    ("account-service",      'job="account-service"',       "spring"),
    ("transaction-service",  'job="transaction-service"',   "spring"),
    ("audit-service",        'job="audit-service"',         "spring"),
    # Python services use http_request_duration_seconds (fastapi-instrumentator)
    ("exchange-service",     'job="exchange-service"',      "python"),
    ("notification-service", 'job="notification-service"',  "python"),
]

DURATION_METRIC = {
    "go":     "http_request_duration_seconds",
    "spring": "http_server_requests_seconds",
    "python": "http_request_duration_seconds",
}

REQUEST_METRIC = {
    "go":     "http_requests_total",
    "spring": "http_server_requests_seconds_count",
    "python": "http_requests_total",
}


def prom_query(expr):
    url = f"http://{ELB}/api/v1/query?" + urllib.parse.urlencode({"query": expr})
    req = urllib.request.Request(url, headers={"Host": PROMETHEUS_HOST})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.loads(r.read())
        results = data.get("data", {}).get("result", [])
        if results:
            return float(results[0]["value"][1])
    except Exception:
        pass
    return None


def quantile(q, selector, metric):
    return prom_query(
        f'histogram_quantile({q}, sum by (le) (rate({metric}_bucket{{{selector}}}[{RANGE}])))'
    )


def avg_latency(selector, metric):
    rate_sum   = prom_query(f'sum(rate({metric}_sum{{{selector}}}[{RANGE}]))')
    rate_count = prom_query(f'sum(rate({metric}_count{{{selector}}}[{RANGE}]))')
    if rate_sum is not None and rate_count and rate_count > 0:
        return rate_sum / rate_count
    return None


def rps(selector, stack):
    metric = REQUEST_METRIC[stack]
    if stack == "spring":
        return prom_query(f'sum(rate({metric}{{{selector}}}[{RANGE}]))')
    return prom_query(f'sum(rate({metric}{{{selector}}}[{RANGE}]))')


def fmt(val, unit="ms"):
    if val is None:
        return "  n/a  "
    if unit == "ms":
        return f"{val * 1000:7.2f}"
    return f"{val:7.2f}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--label", default="baseline", help="Label for this measurement (e.g. baseline, mtls)")
    args = parser.parse_args()

    now = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    print(f"\n{'='*74}")
    print(f"  MicroBank per-service latency  |  {args.label.upper()}  |  {now}")
    print(f"  Prometheus look-back: {RANGE}  |  10 VUs")
    print(f"{'='*74}")
    print(f"{'Service':<22} {'avg':>7} {'p50':>7} {'p95':>7} {'p99':>7} {'req/s':>7}")
    print(f"{'-'*22} {'-'*7} {'-'*7} {'-'*7} {'-'*7} {'-'*7}")

    for name, selector, stack in SERVICES:
        metric = DURATION_METRIC[stack]
        p50 = quantile(0.50, selector, metric)
        p95 = quantile(0.95, selector, metric)
        p99 = quantile(0.99, selector, metric)
        avg = avg_latency(selector, metric)
        r   = rps(selector, stack)
        r_s = f"{r:7.2f}" if r is not None else "  n/a  "
        print(f"{name:<22} {fmt(avg)} {fmt(p50)} {fmt(p95)} {fmt(p99)} {r_s}")

    print(f"{'='*74}")
    print(f"  All values in milliseconds (ms)")
    print()


if __name__ == "__main__":
    main()
