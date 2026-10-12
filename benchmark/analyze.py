"""Quick markdown summary (report.md) of a benchmark results dir — see build_xlsx.py for the full workbook.

Usage: python benchmark/analyze.py <results-dir>
"""
import csv
import json
import os
import sys
from collections import defaultdict
from statistics import mean

OUT = sys.argv[1]
STACKS = ["baseline", "istio", "linkerd"]
PHASES = ["idle", "normal", "peak", "burst"]
BUCKET = 10  # seconds
PROXIES = {"istio-proxy", "linkerd-proxy"}
CATS = ["app", "sidecars", "control-plane", "monitoring", "ingress", "kubernetes"]


def category(ns, pod, container):
    if ns in ("istio-system", "linkerd"):
        return "control-plane"
    if ns == "ingress-nginx":
        return "ingress"
    if ns == "student-research":
        if pod.startswith("monitoring-"):
            return "monitoring"
        return "sidecars" if container in PROXIES else "app"
    return "kubernetes"


def service(pod):
    # microbank-transaction-service-f4c76d7c9-zz4jc -> transaction-service
    parts = pod.split("-")
    return "-".join(parts[1:-2]) if pod.startswith("microbank-") else None


# ---- per-container series -> CPU rate (cores) and memory, bucketed per 10s ----
series = defaultdict(list)
with open(os.path.join(OUT, "containers.csv")) as f:
    for r in csv.DictReader(f):
        series[(r["namespace"], r["pod"], r["container"])].append(
            (float(r["ts"]), r["phase"], float(r["cpu_seconds_total"]), int(r["mem_bytes"])))

cpu = defaultdict(lambda: defaultdict(float))   # (phase, bucket) -> key -> cores
mem = defaultdict(lambda: defaultdict(float))   # (phase, bucket) -> key -> bytes
for (ns, pod, cont), pts in series.items():
    pts.sort()
    uniq = [p for i, p in enumerate(pts) if i == 0 or p[0] != pts[i - 1][0]]
    cat, svc = category(ns, pod, cont), service(pod)
    keys = [cat] + ([f"svc:{svc}:{'proxy' if cont in PROXIES else 'app'}"] if svc and ns == "student-research" else [])
    # Average per container per bucket before summing: kubelet timestamps drift, so a
    # container can land two samples in one bucket and would otherwise count twice.
    per_bucket = defaultdict(list)
    for (t0, _, c0, _), (t1, ph, c1, m1) in zip(uniq, uniq[1:]):
        if c1 < c0 or t1 <= t0:
            continue  # container restart
        per_bucket[int(t1 // BUCKET)].append((ph, (c1 - c0) / (t1 - t0), m1))
    for b, samples in per_bucket.items():
        ph = samples[-1][0]
        for k in keys:
            cpu[(ph, b)][k] += mean(s[1] for s in samples)
            mem[(ph, b)][k] += mean(s[2] for s in samples)

def phase_stats(store, ph, key):
    vals = [v.get(key, 0.0) for (p, _), v in store.items() if p == ph]
    return (mean(vals), max(vals)) if vals else (None, None)

node = defaultdict(list)
with open(os.path.join(OUT, "node.csv")) as f:
    for r in csv.DictReader(f):
        node[r["phase"]].append((float(r["cpu_percent"]) / 100, int(r["mem_bytes"])))

def k6(stack, scen):
    path = os.path.join(OUT, f"k6-{stack}-{scen}.json")
    if not os.path.exists(path):
        return None
    m = json.load(open(path))["metrics"]
    d = m["http_req_duration"]
    checks = m.get("checks", {})
    return {
        "p50": d.get("med"), "p95": d.get("p(95)"), "p99": d.get("p(99)"),
        "rps": m["http_reqs"]["rate"], "reqs": m["http_reqs"]["count"],
        "failed": m["http_req_failed"]["value"] * 100,
        "checks": 100 * checks.get("passes", 0) / max(1, checks.get("passes", 0) + checks.get("fails", 0)),
    }

def phase_seconds(ph):
    return len({b for (p, b) in cpu if p == ph}) * BUCKET

mc = lambda v: "–" if v is None else f"{v * 1000:.0f}"
mib = lambda v: "–" if v is None else f"{v / 2**20:.0f}"

lines = ["# MicroBank resource benchmark — baseline vs Istio vs Linkerd", "",
         "CPU in millicores (mean / peak of 10 s buckets), memory in MiB working set (mean / peak).", ""]

for ph in PHASES:
    lines += [f"## {ph}", "", "| stack | " + " | ".join(f"{c} CPU" for c in CATS) + " | node CPU | " +
              " | ".join(f"{c} RAM" for c in CATS) + " | node RAM |",
              "|" + "---|" * (2 * len(CATS) + 3)]
    for st in STACKS:
        key = f"{st}/{ph}"
        cells = [st]
        for c in CATS:
            a, p = phase_stats(cpu, key, c); cells.append(f"{mc(a)} / {mc(p)}")
        n = node.get(key, [])
        cells.append(f"{mc(mean(x for x, _ in n))} / {mc(max(x for x, _ in n))}" if n else "–")
        for c in CATS:
            a, p = phase_stats(mem, key, c); cells.append(f"{mib(a)} / {mib(p)}")
        cells.append(f"{mib(mean(y for _, y in n))} / {mib(max(y for _, y in n))}" if n else "–")
        lines.append("| " + " | ".join(cells) + " |")
    lines.append("")

lines += ["## k6 results + CPU efficiency", "",
          "CPU-ms/req = (app + sidecars + control-plane CPU-seconds during the run) / HTTP requests. Mesh overhead = this column vs baseline.", "",
          "| scenario | stack | req/s | requests | failed % | checks % | p50 ms | p95 ms | p99 ms | mesh CPU (sidecar+cp) mean m | CPU-ms/req |",
          "|---|---|---|---|---|---|---|---|---|---|---|"]
for scen in ["normal", "peak", "burst"]:
    for st in STACKS:
        r = k6(st, scen)
        if not r:
            continue
        key = f"{st}/{scen}"
        total = sum((phase_stats(cpu, key, c)[0] or 0) for c in ("app", "sidecars", "control-plane"))
        mesh = sum((phase_stats(cpu, key, c)[0] or 0) for c in ("sidecars", "control-plane"))
        per_req = total * phase_seconds(key) / r["reqs"] * 1000
        lines.append(f"| {scen} | {st} | {r['rps']:.1f} | {r['reqs']} | {r['failed']:.2f} | {r['checks']:.1f} | "
                     f"{r['p50']:.0f} | {r['p95']:.0f} | {r['p99']:.0f} | {mesh * 1000:.0f} | {per_req:.1f} |")
lines.append("")

svcs = sorted({k.split(":")[1] for v in cpu.values() for k in v if k.startswith("svc:")})
for scen in ["peak"]:
    lines += [f"## Per-service mean CPU (m) / RAM (MiB) during {scen} — app container / sidecar", "",
              "| service | " + " | ".join(STACKS) + " |", "|---|" + "---|" * len(STACKS)]
    for s in svcs:
        cells = [s]
        for st in STACKS:
            key = f"{st}/{scen}"
            ac, _ = phase_stats(cpu, key, f"svc:{s}:app"); pc, _ = phase_stats(cpu, key, f"svc:{s}:proxy")
            am, _ = phase_stats(mem, key, f"svc:{s}:app"); pm, _ = phase_stats(mem, key, f"svc:{s}:proxy")
            cells.append(f"{mc(ac)}m {mib(am)}Mi / {mc(pc) if pc else '–'}m {mib(pm) if pm else '–'}Mi")
        lines.append("| " + " | ".join(cells) + " |")
    lines.append("")

report = "\n".join(lines)
open(os.path.join(OUT, "report.md"), "w", encoding="utf-8").write(report)
print(report)
