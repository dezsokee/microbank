"""Samples per-container CPU/memory from the minikube kubelet's Summary API
plus whole-node usage from `docker stats minikube`, every INTERVAL seconds.

Usage: python benchmark/sampler.py <results-dir>   (started/stopped by run.sh)

The current phase label (e.g. "istio/peak") is read from PHASE_FILE on each tick,
so the orchestrator just rewrites that file to tag samples. Stops when STOP_FILE exists.

Output CSVs (appended):
  containers.csv: ts,phase,namespace,pod,container,cpu_seconds_total,mem_bytes
  node.csv:       ts,phase,cpu_percent,mem_bytes
"""
import csv
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime

OUT_DIR = sys.argv[1]
INTERVAL = 10
PHASE_FILE = os.path.join(OUT_DIR, "phase.txt")
STOP_FILE = os.path.join(OUT_DIR, "stop")

UNITS = {"B": 1, "KiB": 1024, "MiB": 1024**2, "GiB": 1024**3, "kB": 1000, "MB": 1000**2, "GB": 1000**3}


def phase():
    try:
        with open(PHASE_FILE) as f:
            return f.read().strip()
    except OSError:
        return "unknown"


def scrape_summary():
    # The kubelet's cAdvisor endpoint only exposes pod-level cgroups under the
    # minikube docker driver (container=""), so per-container numbers come from
    # the kubelet Summary API instead: cumulative CPU core-nanoseconds + working
    # set, each with the kubelet's own measurement timestamp.
    raw = subprocess.run(["kubectl", "get", "--raw", "/api/v1/nodes/minikube/proxy/stats/summary"],
                         capture_output=True, text=True, timeout=30).stdout
    rows = {}
    for pod in json.loads(raw)["pods"]:
        ns, name = pod["podRef"]["namespace"], pod["podRef"]["name"]
        for c in pod.get("containers", []):
            cpu, mem = c.get("cpu", {}), c.get("memory", {})
            if "usageCoreNanoSeconds" not in cpu or "time" not in cpu:
                continue
            ts = datetime.fromisoformat(cpu["time"].replace("Z", "+00:00")).timestamp()
            rows[(ns, name, c["name"])] = (ts, cpu["usageCoreNanoSeconds"] / 1e9, mem.get("workingSetBytes", 0))
    return rows


def scrape_node():
    out = subprocess.run(["docker", "stats", "minikube", "--no-stream", "--format", "{{.CPUPerc}};{{.MemUsage}}"],
                         capture_output=True, text=True, timeout=30).stdout.strip()
    cpu, mem = out.split(";")
    used = mem.split("/")[0].strip()
    num, unit = re.match(r"([\d.]+)\s*(\w+)", used).groups()
    return float(cpu.rstrip("%")), int(float(num) * UNITS[unit])


def main():
    cpath = os.path.join(OUT_DIR, "containers.csv")
    npath = os.path.join(OUT_DIR, "node.csv")
    new_c, new_n = not os.path.exists(cpath), not os.path.exists(npath)
    with open(cpath, "a", newline="") as cf, open(npath, "a", newline="") as nf:
        cw, nw = csv.writer(cf), csv.writer(nf)
        if new_c:
            cw.writerow(["ts", "phase", "namespace", "pod", "container", "cpu_seconds_total", "mem_bytes"])
        if new_n:
            nw.writerow(["ts", "phase", "cpu_percent", "mem_bytes"])
        while not os.path.exists(STOP_FILE):
            start = time.time()
            ph = phase()
            try:
                for (ns, pod, container), (ts, cpu, mem) in scrape_summary().items():
                    cw.writerow([f"{ts:.3f}", ph, ns, pod, container, f"{cpu:.6f}", mem])
                cf.flush()
            except Exception as e:  # keep sampling through transient API errors
                print(f"summary scrape failed: {e}", file=sys.stderr, flush=True)
            try:
                cpu_pct, mem_bytes = scrape_node()
                nw.writerow([f"{start:.1f}", ph, cpu_pct, mem_bytes])
                nf.flush()
            except Exception as e:
                print(f"docker stats failed: {e}", file=sys.stderr, flush=True)
            time.sleep(max(0, INTERVAL - (time.time() - start)))


if __name__ == "__main__":
    main()
