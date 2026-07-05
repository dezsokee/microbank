# Cosign aláírás CI/CD overhead — mérési eredmények

## Áttekintés

Ez a dokumentum a **Cosign kulcs nélküli (keyless) aláírás és ellenőrzés** CI/CD folyamatra gyakorolt **időbeli többletköltségét (overhead)** méri számszerűen a MicroBank projektben. A kérdés, amelyre a mérés választ ad:

> *Mennyi extra időbe kerül a folyamatosan integrált (CI) build futásában az, hogy minden konténerképet Cosign-nal aláírunk és azonnal ellenőrzünk?*

A mérés a [Cosign_keyless_signing_documentation.md](Cosign_keyless_signing_documentation.md) által leírt aláírási mechanizmus **futásidejű költségét** kvantifikálja, kiegészítve a [CI-CD_documentation.md](CI-CD_documentation.md) pipeline-dokumentációt.

---

## 1. Módszertan

### Kísérleti elrendezés

A méréshez a 9 service CI workflow-ját (`ci-*.yml`) egy `cosign_enabled` `workflow_dispatch` bemenettel láttuk el. Ez a kapcsoló a hívott (reusable) workflow-ban feltételessé teszi a Cosign-hoz kötődő lépéseket:

- **Install Cosign** — a `cosign` bináris letöltése (`sigstore/cosign-installer@v3`)
- **Sign image with Cosign (keyless)** — aláírás a build digest alapján
- **Verify signature (keyless)** — az aláírás azonnali ellenőrzése Fulcio-identitás és Rekor-bejegyzés ellen

`cosign_enabled=false` esetén mindhárom lépés kimarad; a build változatlan.

### Minta

| Paraméter | Érték |
|---|---|
| Service-ek száma | 9 |
| Ismétlés / service / feltétel | 5 |
| Feltételek | Cosign **be** / Cosign **ki** |
| **Összes futás** | **9 × 5 × 2 = 90** |
| Runner | GitHub-hosted `ubuntu-latest` |
| Build | `docker/build-push-action@v5`, `--no-cache` (minden réteg újraépül) |
| Aláírás | keyless, GitHub Actions OIDC identitás, Fulcio + Rekor |

Minden futás sikeres volt (45 + 45, retry nélkül). Az időadatok forrása a GitHub Actions **jobs API** lépésenkénti `started_at`/`completed_at` időbélyege (másodperc felbontás).

### Metrikák

- **build_s** — a „Build and push image" lépés ideje.
- **install_s / sign_s / verify_s** — a három Cosign-lépés ideje (csak `be` esetén).
- **overhead_s** = install_s + sign_s + verify_s — a **teljes aláírási többletköltség** a pipeline-ban.

> **Fontos módszertani megjegyzés.** A `be` és `ki` futások **build-idejének különbsége** nem alkalmas az overhead mérésére: a GitHub-hosted runnerek terhelésingadozása miatt a build-idő szórása igen nagy (**σ ≈ 38–41 s**, lásd 4. szakasz), így a különbség gyakran a zajba vész, sőt előjelet is válthat. Az overhead-et ezért **közvetlenül a hozzáadott lépések idejéből** számoljuk — ennek szórása mindössze **σ ≈ 1,75 s**, tehát nagyságrenddel tisztább jel.

---

## 2. Eredmények service-enként

Az értékek 5–5 futás átlagai. Az `overhead_%` az aláírási többlet a Cosign nélküli build-időhöz viszonyítva.

| Service | Stack | Build be (s) | Build ki (s) | **Overhead (s)** | Overhead % | install | sign | verify |
|---|---|---|---|---|---|---|---|---|
| api-gateway | Go | 34,2 | 32,4 | **3,80** | 11,7% | 0,80 | 2,40 | 0,60 |
| auth-service | Go | 44,8 | 34,2 | **4,60** | 13,5% | 0,80 | 3,20 | 0,60 |
| fraud-service | Go | 37,0 | 34,6 | **5,00** | 14,5% | 0,60 | 3,80 | 0,60 |
| account-service | Kotlin/Spring | 118,0 | 107,8 | **4,40** | 4,1% | 0,60 | 3,40 | 0,40 |
| transaction-service | Kotlin/Spring | 95,8 | 106,2 | **4,60** | 4,3% | 0,60 | 3,40 | 0,60 |
| audit-service | Java/Spring | 69,8 | 82,8 | **4,00** | 4,8% | 0,80 | 2,60 | 0,60 |
| exchange-service | Python | 49,8 | 52,0 | **4,60** | 8,8% | 0,60 | 3,40 | 0,60 |
| notification-service | Python | 39,4 | 48,0 | **4,80** | 10,0% | 0,60 | 3,80 | 0,40 |
| frontend | React | 26,0 | 26,4 | **6,20** | 23,5% | 0,60 | 3,80 | 1,80 |

---

## 3. Eredmények technológiai stack szerint

| Stack | Service-ek | Build be (s) | Build ki (s) | **Overhead (s)** | Overhead % |
|---|---|---|---|---|---|
| Go | api-gateway, auth, fraud | 38,7 | 33,7 | **4,47** | 13,2% |
| Kotlin/Spring | account, transaction | 106,9 | 107,0 | **4,50** | 4,2% |
| Java/Spring | audit | 69,8 | 82,8 | **4,00** | 4,8% |
| Python | exchange, notification | 44,6 | 50,0 | **4,70** | 9,4% |
| React | frontend | 26,0 | 26,4 | **6,20** | 23,5% |

---

## 4. Összesített overhead

A 45 Cosign-os futás aláírási többletköltsége:

| Statisztika | Érték |
|---|---|
| **Átlag** | **4,67 s** |
| Szórás (σ) | 1,75 s |
| Minimum | 3 s |
| Maximum | 12 s |
| Minta (n) | 45 |

Az overhead összetevőinek átlaga:

| Lépés | Átlag (s) | Arány |
|---|---|---|
| Install Cosign | 0,67 | 14% |
| **Sign** | **3,31** | **71%** |
| Verify | 0,69 | 15% |
| **Összesen** | **4,67** | 100% |

Összehasonlításul a build-idő szórása (a runner-zaj mértéke):

| Feltétel | Build átlag (s) | Build σ (s) |
|---|---|---|
| Cosign be | 57,2 | 38,4 |
| Cosign ki | 58,3 | 41,4 |

---

## 5. Értelmezés

1. **Az aláírási overhead gyakorlatilag fix, ~4,7 másodperc**, a service-től és a konténerkép méretétől **függetlenül**. A szórás (1,75 s) is kicsi. Ez logikus: az aláírás egy rögzített méretű digest (SHA-256) fölött történik, nem a teljes image fölött — így a művelet költsége nem skálázódik az image méretével.

2. **Az abszolút költség domináns tétele az aláírás (`sign`, ~3,3 s)**, ezt követi az ellenőrzés és a bináris telepítése (egyenként ~0,7 s). A `sign` és `verify` idejében benne van a Fulcio-tanúsítványkérés és a Rekor átláthatósági naplóba írás/olvasás hálózati köre is.

3. **A relatív költség (overhead %) fordítottan arányos a build-idővel.** A leggyorsabb build-ű **frontend (React)** és a **Go** service-ek szenvedik el a legnagyobb relatív lassulást (23,5%, illetve 13,2%), míg a nehéz **Kotlin/Spring** és **Java/Spring** Gradle-buildeknél a ~4,5 s többlet elhanyagolható (4–5%). Ugyanaz a fix ~4,7 s költség tehát egészen mást jelent egy 26 s-os és egy 107 s-os pipeline-ban.

4. **A build-idők közötti „be" vs „ki" különbség nem tekinthető overhead-jelnek.** Több service-nél (transaction, audit) a Cosign-os build átlagosan *gyorsabb* volt, mint a Cosign nélküli — ez tisztán a runner-teljesítmény ingadozása (σ ≈ 40 s). Ezért mértük az overhead-et közvetlenül a hozzáadott lépésekből.

**Következtetés a disszertáció szempontjából:** a Cosign keyless aláírás + ellenőrzés bevezetése a CI/CD folyamatba **állandó, alacsony (~4–5 másodperces) és jól előrejelezhető** időköltséggel jár pipeline-onként, miközben teljes kriptográfiai provenance-t és tamper-evidence-t biztosít. A biztonsági kontroll ára a legtöbb reális build mellett a futásidő néhány százaléka.

---

## 6. Érvényességi korlátok (threats to validity)

- **Runner-zaj.** A GitHub-hosted runnerek megosztott infrastruktúrán futnak; a build-idő szórása nagy. Az overhead-mérést ez nem érinti (közvetlen lépésmérés), de a build-idők abszolút értékei tájékoztató jellegűek.
- **Másodperc felbontás.** A jobs API időbélyegei másodperc pontosságúak, így a ~0,7 s-os lépések (install, verify) kerekítési hibája relatíve nagy lehet — az összesített ~4,7 s-os becslést azonban 45 minta stabilizálja.
- **Hálózati függőség.** A `sign`/`verify` idő tartalmazza a Fulcio és Rekor felé irányuló hálózati köröket; ezek terhelése/elérhetősége befolyásolhatja az eredményt.
- **Cache kikapcsolva.** A `--no-cache` a legrosszabb eset a build-időre; valós cache-elt buildeknél a relatív overhead % magasabb lenne (mert a build gyorsabb, az overhead fix).

---

## Függelék A — Nyers adatok, Cosign **be** (45 futás)

| Service | build_s | install_s | sign_s | verify_s | overhead_s |
|---|---|---|---|---|---|
| account-service | 82 | 0 | 3 | 0 | 3 |
| account-service | 83 | 1 | 4 | 1 | 6 |
| account-service | 86 | 1 | 4 | 1 | 6 |
| account-service | 140 | 0 | 3 | 0 | 3 |
| account-service | 199 | 1 | 3 | 0 | 4 |
| api-gateway | 32 | 1 | 2 | 1 | 4 |
| api-gateway | 32 | 1 | 3 | 0 | 4 |
| api-gateway | 33 | 1 | 2 | 1 | 4 |
| api-gateway | 36 | 0 | 3 | 0 | 3 |
| api-gateway | 38 | 1 | 2 | 1 | 4 |
| audit-service | 45 | 1 | 3 | 0 | 4 |
| audit-service | 48 | 1 | 2 | 1 | 4 |
| audit-service | 50 | 0 | 3 | 0 | 3 |
| audit-service | 102 | 1 | 3 | 1 | 5 |
| audit-service | 104 | 1 | 2 | 1 | 4 |
| auth-service | 31 | 1 | 3 | 0 | 4 |
| auth-service | 31 | 1 | 3 | 1 | 5 |
| auth-service | 34 | 1 | 3 | 1 | 5 |
| auth-service | 35 | 1 | 4 | 1 | 6 |
| auth-service | 93 | 0 | 3 | 0 | 3 |
| exchange-service | 25 | 0 | 3 | 0 | 3 |
| exchange-service | 25 | 0 | 3 | 1 | 4 |
| exchange-service | 26 | 1 | 4 | 1 | 6 |
| exchange-service | 84 | 1 | 3 | 0 | 4 |
| exchange-service | 89 | 1 | 4 | 1 | 6 |
| fraud-service | 33 | 1 | 3 | 0 | 4 |
| fraud-service | 36 | 1 | 5 | 1 | 7 |
| fraud-service | 37 | 0 | 4 | 1 | 5 |
| fraud-service | 39 | 1 | 4 | 1 | 6 |
| fraud-service | 40 | 0 | 3 | 0 | 3 |
| frontend | 23 | 0 | 3 | 1 | 4 |
| frontend | 25 | 1 | 4 | 1 | 6 |
| frontend | 26 | 0 | 3 | 0 | 3 |
| frontend | 27 | 1 | 4 | 1 | 6 |
| frontend | 29 | 1 | 5 | 6 | 12 |
| notification-service | 23 | 0 | 3 | 0 | 3 |
| notification-service | 23 | 1 | 2 | 1 | 4 |
| notification-service | 26 | 1 | 3 | 0 | 4 |
| notification-service | 33 | 0 | 4 | 0 | 4 |
| notification-service | 92 | 1 | 7 | 1 | 9 |
| transaction-service | 79 | 0 | 3 | 0 | 3 |
| transaction-service | 81 | 0 | 3 | 0 | 3 |
| transaction-service | 89 | 2 | 4 | 1 | 7 |
| transaction-service | 93 | 1 | 4 | 1 | 6 |
| transaction-service | 137 | 0 | 3 | 1 | 4 |

## Függelék B — Nyers adatok, Cosign **ki** (build_s, 5–5 futás)

| Service | build_s értékek |
|---|---|
| account-service | 80, 84, 94, 139, 142 |
| api-gateway | 31, 31, 32, 34, 34 |
| audit-service | 45, 47, 48, 108, 166 |
| auth-service | 33, 33, 34, 35, 36 |
| exchange-service | 25, 30, 31, 86, 88 |
| fraud-service | 33, 34, 35, 35, 36 |
| frontend | 23, 25, 26, 29, 29 |
| notification-service | 23, 23, 24, 25, 145 |
| transaction-service | 79, 81, 85, 143, 143 |

> A nyers futásazonosítók (GitHub Actions run ID) és a feldolgozott adatok a mérés során a `bm_all_runs.txt` és `bm_results.tsv` állományokban készültek. A méréshez tiszta, teljes újrafuttatás történt; korábbi (részben megszakított) futások nem kerültek felhasználásra.
