# Service mesh overhead — baseline vs Istio vs Linkerd

Ez a dokumentum azt méri, mennyi **késleltetési és erőforrás-többletet (CPU, RAM)** okoz a MicroBank rendszerben a service mesh alapú mTLS. A mérés ugyanazt a telepítést hasonlítja össze három változatban: mesh nélkül (baseline), Istióval és Linkerddel. A nyers adatok a [resource-benchmark-istio-vs-baseline.xlsx](resource-benchmark-istio-vs-baseline.xlsx) fájlban vannak, a mérőeszközök a [`README.md`](README.md)-ben leírt szkriptek.

---

## 1. Módszertan

### Környezet

| Paraméter | Érték |
|---|---|
| Cluster | egy node-os minikube (docker driver, 6 CPU, 10 GB RAM), Kubernetes v1.28.3 |
| Baseline | `serviceMesh.provider=none`: nincs sidecar, nincs mTLS |
| Istio | Istio 1.30.4, sidecar injection, STRICT `PeerAuthentication` + `ISTIO_MUTUAL` `DestinationRule` |
| Linkerd | Linkerd edge-26.5.3, klasszikus sidecar mód, `all-authenticated` inbound policy |
| Meshelt podok | 9 alkalmazás-pod (a `postgres` egyik mesh-ben sem kap sidecart) |

### Mérési menet

Minden stacknél: átkonfigurálás, minden pod újraindítása (üres adatbázis), 1 perc bemelegítés (nem kerül a riportba), majd három k6 terhelési forgatókönyv, köztük 1–1 perc szünettel:

| Forgatókönyv | Terhelés | Időtartam | Jelleg |
|---|---|---|---|
| **normal** | 10 VU | 5 perc | nem telített rendszer: a tényleges mesh-overhead |
| **peak** | 50 VU | 9 perc | telítés: kapacitás |
| **burst** | 2 × 100 VU-s tüske | 4 perc | hirtelen terhelés: hibatűrés |

A k6 a minikube Docker hálózatáról, közvetlenül az ingress-nginx felé küldi a kéréseket, így a saját CPU-használata nem kerül bele a mérésbe.

### Metrikák és forrásuk

**Késleltetés.** A k6 beépített `http_req_duration` metrikája (`--summary-export`) a kérés elküldésétől a válasz beérkezéséig mér, kliensoldalon, a teljes ingress → api-gateway → downstream úton. A közölt értékek: p50, p95, p99, valamint az áteresztőképesség (req/s) és a hibás kérések aránya.

**CPU és RAM.** 10 másodpercenkénti mintavétel a kubelet Summary API-ról (`/api/v1/nodes/minikube/proxy/stats/summary`). Az API a pod cgroup-hierarchiája alapján **konténerenként külön** adja meg a kumulatív CPU-időt (`usageCoreNanoSeconds`) és a memória working setjét (`workingSetBytes`). Így a sidecar proxy fogyasztása az alkalmazáskonténerétől elkülönítve mérhető.

- CPU (millicore) = két egymást követő minta CPU-idejének különbsége / eltelt idő.
- RAM (MiB) = working set.
- A közölt értékek az adott fázis 10 másodperces mintáinak átlagai.

Kategóriák:
- **Sidecar** = az alkalmazás-podokban futó összes `istio-proxy` / `linkerd-proxy` konténer összege.
- **Control plane** = az `istio-system`, illetve a `linkerd` namespace összes konténere.
- **Workload CPU** = app + sidecar + control plane.
- **CPU-ms/kérés** = workload CPU × fázis hossza / kérések száma. Ez a terheléssel normalizált CPU-költség.

### Korlátok

- Kombinációnként egyetlen futás, egyetlen node-on, szórás nélkül. A ~10% alatti különbségek a mérési zajon belül lehetnek. Az eredmények egymáshoz viszonyítva értelmezhetők, abszolút értékként nem.
- A kernel szintű hálózati feldolgozás (iptables-átirányítás a sidecarba, loopback-ugrások) nem a konténerek cgroupjára könyvelődik. A sidecar-értékek ezért a teljes mesh-overhead **alsó becslései**.
- A teljes node-ra vonatkozó CPU-értéket (`docker stats`) nem használjuk: a Linkerd menet más időpontban futott, és a node szintjén a podokon kívüli folyamatok zaja is megjelenik benne.
- Az adatbázis-forgalom (`postgres`) nincs a mesh-ben, ezért az mTLS overhead csak a service–service hívásokra vonatkozik.

---

## 2. Eredmények

### 2.1 Késleltetés (normal terhelés)

| Stack | p50 (ms) | p95 (ms) | p99 (ms) | Req/s | Hibaarány |
|---|---|---|---|---|---|
| baseline | 5,2 | 39,9 | 57,7 | 38,4 | 0% |
| Istio | 8,0 (+2,8 ms, +54%) | 53,4 (+13,5 ms, +34%) | 71,9 (+14,1 ms, +24%) | 37,5 | 0% |
| Linkerd | 7,4 (+2,2 ms, +42%) | 47,7 (+7,8 ms, +19%) | 68,7 (+10,9 ms, +19%) | 37,8 | 0% |

Nem telített rendszerben a mesh kérésenként néhány ms többletet okoz a medián késleltetésben. A Linkerd minden percentilisen kisebb többlettel jár, mint az Istio.

### 2.2 Kapacitás és hibatűrés (peak, burst)

| Stack | Peak req/s | Peak Δ | Burst hibaarány |
|---|---|---|---|
| baseline | 64,9 | – | 0,41% |
| Istio | 60,4 | −7,0% | 2,42% |
| Linkerd | 59,9 | −7,6% | 2,21% |

Telítésben a latency már a baseline-on is többmásodperces (peak p95 ≈ 2 s), és sorban állás dominálja, ezért itt az áteresztőképesség és a hibaarány a mérvadó. Ebben a két mesh között nincs érdemi különbség: mindkettő kb. 7%-kal kevesebb kérést szolgál ki, és burst alatt kb. 2 százalékponttal több hibát ad. A szűk keresztmetszet mindhárom esetben a `postgres` (≈ 420–475 m CPU), nem a mesh.

### 2.3 CPU-többlet

| Forgatókönyv | Stack | Sidecar CPU (m) | Control plane CPU (m) | Workload CPU (m) | CPU-ms/kérés | Δ a baseline-hoz |
|---|---|---|---|---|---|---|
| normal | baseline | – | – | 429 | 11,5 | – |
| normal | Istio | 204 | 2,3 | 633 | 16,8 | **+46%** |
| normal | Linkerd | 137 | 4,4 | 602 | 15,4 | **+33%** |
| peak | baseline | – | – | 1063 | 16,3 | – |
| peak | Istio | 452 | 2,6 | 1458 | 24,5 | **+50%** |
| peak | Linkerd | 236 | 4,8 | 1255 | 20,9 | **+28%** |
| burst | baseline | – | – | 1025 | 17,3 | – |
| burst | Istio | 407 | 3,0 | 1386 | 24,3 | **+41%** |
| burst | Linkerd | 193 | 4,7 | 1130 | 20,5 | **+19%** |

- A CPU-többletet gyakorlatilag teljes egészében a sidecarok adják. A control plane fogyasztása mindkét mesh-nél elhanyagolható (2–5 m).
- A sidecar CPU a terheléssel arányosan nő. Kérésenként az Istio sidecarok ≈ 5,4–7,6 ms, a Linkerd sidecarok ≈ 3,5–3,9 ms CPU-időt használnak, vagyis az Envoy kb. kétszer annyi CPU-t igényel, mint a linkerd-proxy.
- Az alkalmazáskonténerek CPU-ja a három stacknél azonos nagyságrendű (normal: 429 / 427 / 461 m). A többlet tehát nem az alkalmazásban, hanem a proxyban keletkezik.

### 2.4 Memória-többlet

| Forgatókönyv | Stack | Sidecar RAM (MiB) | Sidecar RAM / pod (MiB) | Control plane RAM (MiB) | Összes mesh RAM (MiB) |
|---|---|---|---|---|---|
| normal | Istio | 340 | ≈ 38 | 175 | 514 |
| normal | Linkerd | 138 | ≈ 15 | 203 | 341 |
| peak | Istio | 368 | ≈ 41 | 170 | 538 |
| peak | Linkerd | 155 | ≈ 17 | 203 | 358 |
| burst | Istio | 399 | ≈ 44 | 170 | 568 |
| burst | Linkerd | 192 | ≈ 21 | 203 | 396 |

- A memória-többlet nagyrészt fix költség, a terheléssel csak mérsékelten nő.
- Egy Linkerd sidecar ≈ 2,5-ször kevesebb memóriát használ, mint egy Istio sidecar. A Linkerd control plane (≈ 203 MiB) valamivel nagyobb az istiodnál (≈ 170 MiB), de ezt a 9 sidecaron elért megtakarítás bőven ellensúlyozza.

---

## 3. Összegzés

| Szempont | Istio | Linkerd |
|---|---|---|
| p50 többlet (normal) | +2,8 ms | +2,2 ms |
| p95 többlet (normal) | +13,5 ms | +7,8 ms |
| CPU-ms/kérés többlet | +41–50% | +19–33% |
| Sidecar CPU / kérés | ≈ 5,4–7,6 ms | ≈ 3,5–3,9 ms |
| Mesh RAM összesen | ≈ 510–570 MiB | ≈ 340–400 MiB |
| Kapacitásvesztés telítésben | ≈ −7% | ≈ −7,6% |

Mindkét mesh mérhető, de mérsékelt többlettel biztosítja a service–service mTLS-t. A **Linkerd erőforrásban egyértelműen olcsóbb**: kérésenként kb. feleannyi sidecar CPU-t és kb. 2,5-ször kevesebb sidecar memóriát használ, és a késleltetési többlete is kisebb. Telítésben a két mesh kapacitásvesztése és hibaaránya gyakorlatilag azonos, mert ott az adatbázis a szűk keresztmetszet.
