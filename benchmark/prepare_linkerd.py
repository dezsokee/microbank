"""Prepares the Linkerd manifests from k8s/linkerd/ for the benchmark.

1. k8s/linkerd/linkerd-crds.yaml and linkerd-control-plane.yaml are UTF-16 (written
   by a PowerShell redirect) — kubectl needs UTF-8.
2. The control plane was rendered with proxy.nativeSidecar=true, i.e. the proxy is an
   initContainer with restartPolicy: Always. Kubernetes 1.28 (minikube's default here)
   rejects that, so this switches to Linkerd's classic sidecar mode: the proxy moves to
   regular containers and the injector config is set to nativeSidecar: false, so app
   pods get a classic sidecar too — the same model Istio uses in this setup.

Output goes to benchmark/.build/linkerd/ (git-ignored: the control plane manifest
embeds the identity issuer key, which is already tracked once under k8s/linkerd/).
"""
import os
import sys

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "k8s", "linkerd")
OUT = os.path.join(HERE, ".build", "linkerd")


def read_any(path):
    raw = open(path, "rb").read()
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        return raw.decode("utf-16")
    return raw.decode("utf-8-sig")


def main():
    os.makedirs(OUT, exist_ok=True)

    with open(os.path.join(OUT, "linkerd-crds.yaml"), "w", encoding="utf-8", newline="\n") as f:
        f.write(read_any(os.path.join(SRC, "linkerd-crds.yaml")).replace("\r\n", "\n"))

    docs = list(yaml.safe_load_all(read_any(os.path.join(SRC, "linkerd-control-plane.yaml"))))
    moved = 0
    for d in docs:
        if not d:
            continue
        if d.get("kind") == "ConfigMap" and d["metadata"]["name"] == "linkerd-config":
            d["data"]["values"] = d["data"]["values"].replace("nativeSidecar: true", "nativeSidecar: false")
        if d.get("kind") == "Deployment":
            spec = d["spec"]["template"]["spec"]
            inits = spec.get("initContainers", [])
            for c in [c for c in inits if c.get("restartPolicy") == "Always"]:
                inits.remove(c)
                c.pop("restartPolicy")
                spec["containers"].insert(0, c)
                moved += 1
    out = os.path.join(OUT, "linkerd-control-plane.yaml")
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        yaml.safe_dump_all(docs, f, sort_keys=False)
    print(f"linkerd manifests ready in {OUT} (proxy moved to classic sidecar in {moved} deployments)")


if __name__ == "__main__":
    sys.exit(main())
