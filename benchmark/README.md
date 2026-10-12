# Erőforrás- és latency-benchmark: baseline vs Istio vs Linkerd

Ugyanazt a MicroBank telepítést méri három hálózati biztonsági réteggel, ugyanazon a minikube node-on:

| Stack | Beállítás |
|---|---|
| `baseline` | `serviceMesh.provider=none`, nincs sidecar, istiod 0 replikán |
| `istio` | Istio sidecar injection + `k8s/istio/peer-authentication-strict.yaml` + `destination-rules.yaml` (STRICT mTLS) |
| `linkerd` | Linkerd (a `k8s/linkerd/` manifestekből, klasszikus sidecar módban) + `authorization-policies-strict.yaml` (`all-authenticated`) |

Minden stacknél: átkonfigurálás → minden pod újraindítása (Postgres először, `emptyDir` → üres DB) → 1 p warm-up (nem kerül a riportba) → 2 p idle → `k6/normal-traffic.js` → 1 p szünet → `k6/peak-traffic.js` → 1 p szünet → `k6/burst-traffic.js` → 1 p szünet.

## Fájlok

| Fájl | Szerep |
|---|---|
| `run.sh` | Vezérlő: stackek konfigurálása, k6 futtatás, fázisok jelölése (`phase.txt`), a mintavevő indítása/leállítása |
| `sampler.py` | 10 s-onként: konténerenkénti kumulatív CPU-idő + working set a kubelet Summary API-ból (`kubectl get --raw /api/v1/nodes/minikube/proxy/stats/summary`), teljes node a `docker stats minikube`-ból → `containers.csv`, `node.csv` |
| `prepare_linkerd.py` | `k8s/linkerd/*.yaml` → UTF-8 + klasszikus sidecar mód (a native sidecart a K8s 1.28 nem támogatja), kimenet: `.build/linkerd/` |
| `build_xlsx.py` | Excel riport: k6 eredmények, CPU-ms/kérés, kategóriánkénti erőforrás, összehasonlítás, service-bontás, idősorok, módszertan |
| `analyze.py` | Gyors markdown összefoglaló (`report.md`) |

## Előfeltételek

- minikube (docker driver), pl. `minikube start --driver=docker --cpus=6 --memory=10g --disk-size=40g` + `minikube addons enable ingress`. Windowson a WSL2 memóriát `%UserProfile%\.wslconfig`-ban kell megemelni (pl. `memory=12GB`); a gépen ezen felül legyen legalább ~4 GB szabad RAM, különben a futás leállhat.
- Telepítve: `istio-base` + `istiod` (Helm, `istio-system`), `microbank` és `monitoring` Helm release a `student-research` namespace-ben (lásd a projekt dokumentációját).
- Docker (a k6 a `grafana/k6` image-ből fut a `minikube` Docker hálózaton, ezért a saját CPU-ja nem kerül a mérésbe), `kubectl`, `helm`.
- Python 3 + `openpyxl`, `pyyaml` (`pip install openpyxl pyyaml`).
- Opcionális: az instrumentált (`client_request_duration_seconds`) api-gateway és transaction-service image a minikube Docker daemonjában. Ha nincs meg, a `run.sh` a chart image-ét használja:
  ```bash
  eval $(minikube docker-env)
  docker build -t microbank-api-gateway:test-instrumented services/api-gateway
  docker build -t microbank-transaction-service:test-instrumented services/transaction-service
  ```

## Futtatás

```bash
# Git Bash (Windows) vagy bash (Linux/macOS), a repó gyökeréből
benchmark/run.sh istio baseline linkerd restore-istio     # ~1,5–2 óra
# vagy csak egy stack:
OUT_DIR=benchmark/results/linkerd-run benchmark/run.sh linkerd restore-istio

# riport (több results könyvtár is összefésülhető)
python benchmark/build_xlsx.py benchmark/results/<run1> [benchmark/results/<run2>] benchmark/resource-benchmark.xlsx
python benchmark/analyze.py benchmark/results/<run>
```

A `restore-istio` csak visszaállítja az Istio konfigurációt, nem mér. Az eredmények a `benchmark/results/<időbélyeg>/` alá kerülnek (git-ignore-olt).

## Fontos tudnivalók

- **Egyszerre csak egy `run.sh` fusson.** Két párhuzamos futás ugyanazokat a `k6-vu-*` usereket használja, kölcsönösen érvénytelenítik egymás tokenjét (401-ek), és mindkettő ugyanabba a `phase.txt`-be ír. Ugyanarra a results könyvtárra a lockfájl védi, de más könyvtárba írva nem. Ha egy futást megszakítasz, ellenőrizd, hogy nem maradt-e árva `run.sh` processz.
- **k6 userek:** az auth-service felhasználónként egy tokent tárol, és minden login felülírja. A peak/burst/normal szkriptek ezért VU-nként saját usert használnak (`k6/lib/users.js`).
- **CPU limitek:** a `run.sh` az account- és transaction-service CPU limitjét 1500m-re emeli (minden stacknél azonosan). 500m-en a transaction-service readiness probe-ja peak/burst alatt kiesik, és a pod kikerül az endpointok közül.
- **Linkerd és a Grafana:** `all-authenticated` policy mellett a nem meshelt ingress csak az api-gateway-t és a frontendet éri el; a Grafana ilyenkor `kubectl port-forward`-dal érhető el.
- **Korlátok:** egy node, a k6 ugyanazon a gépen fut, kombinációnként egyetlen futás. Az eredmények egymáshoz viszonyítva értelmezhetők, abszolút értékként nem.
