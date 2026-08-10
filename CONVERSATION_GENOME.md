# Conversation Genome V1 — Design Specification

**Documento:** `CONVERSATION_GENOME.md`  
**Tipo:** specifica architetturale (design-only)  
**Stato:** **non implementato** — nessun codice runtime in questo step  
**Versione schema:** `ConversationGenome` v1  
**Allineamento:** `CONVERSATION_PRINCIPLES.md`, `MIND_SPEC.md`, `PLANNER_SPEC.md`, `WRITER_API_SPEC.md`, `LAIFE_V2_ARCHITECTURE.md`  
**Vincoli:** zero prompt; zero dipendenze vendor; zero modifiche al runtime attuale.

Il Conversation Genome è un **profilo continuo e normalizzato** di come una risposta dovrebbe *sentirsi* e *muoversi* in questo turno.  
Non sostituisce Mind (decisioni discrete) né Planner (struttura eseguibile): li **traduce in un spazio dimensionale stabile** che Planner/Writer/Reviewer potranno consumare in futuro.

---

## 1. Problema che risolve

Oggi V2 ha:

- **Mind Decision** — flag e scelte discrete (`strategy`, `initiative`, `shouldAskQuestion`, …)
- **Planner Plan** — struttura + `writerBrief` + hard constraints
- **Conversation Principles** — qualità universali (non runtime)
- **Reviewer metrics** — valutazione post-hoc

Manca un contratto intermedio **continuo** (0.0–1.0) che descriva intensità e trade-off (quanto warmth, quanto depth, quanto spark) senza moltiplicare prompt o advisor.

Il Genome è quel contratto.

```
Perception → Mind (Decision)
                 ↓
         ConversationGenome   ← NUOVO (futuro)
                 ↓
              Planner
                 ↓
              Writer
                 ↓
             Reviewer
```

**Runtime attuale:** invariato. Questo documento non va importato da alcun modulo finché non esiste uno slice esplicito di integrazione.

---

## 2. Principi di design del Genome

1. **Valori normalizzati** — ogni dimensione ∈ `[0.0, 1.0]`.
2. **Stabile** — nomi e semantica versionati; breaking change ⇒ bump major (`genomeVersion`).
3. **Derivato, non inventato** — in futuro Mind (o un mapper puro Decision→Genome) lo produce; non lo inventa il Writer.
4. **Non è un prompt** — è un oggetto dati. Nessun testo libero “da dire all’LLM” dentro il Genome.
5. **Compatibile coi Principles** — le dimensioni realizzano P1–P12 di `CONVERSATION_PRINCIPLES.md`.
6. **Trade-off espliciti** — ogni dimensione dichiara conflitti tipici con altre.
7. **Una mossa** — il Genome non autorizza strategie multiple; amplifica/attenua la Decision già presa.

---

## 3. Oggetto stabile — `ConversationGenome`

### 3.1 Schema JSON (normativo)

```json
{
  "genomeVersion": "1.0.0",
  "turnId": "optional-opaque-id",
  "source": {
    "decisionGoal": "connect__need_connection__one_spark",
    "strategy": "connect",
    "mapper": "mind-to-genome-v1"
  },
  "dimensions": {
    "presence": 0.82,
    "warmth": 0.78,
    "emotionalAttunement": 0.55,
    "comfort": 0.20,
    "challenge": 0.10,
    "playfulness": 0.35,
    "curiosity": 0.70,
    "initiative": 0.65,
    "delight": 0.60,
    "specificity": 0.55,
    "depth": 0.35,
    "clarity": 0.70,
    "brevity": 0.75,
    "rhythm": 0.70,
    "naturalness": 0.85,
    "identityFidelity": 0.90,
    "topicContinuity": 0.25,
    "questionPressure": 0.05,
    "teachingIntensity": 0.10,
    "practicality": 0.30,
    "memoryWeaving": 0.00,
    "closure": 0.10,
    "honesty": 0.95,
    "humility": 0.70
  },
  "notes": {
    "boosted": ["presence", "curiosity", "initiative"],
    "suppressed": ["questionPressure", "teachingIntensity", "memoryWeaving"],
    "conflictsResolved": ["initiative>questionPressure", "brevity>depth"]
  }
}
```

### 3.2 Regole di validazione (future)

| Regola | Dettaglio |
|--------|-----------|
| Range | Ogni dimensione deve essere `number` finito in `[0.0, 1.0]` |
| Completezza | Tutte le chiavi di `dimensions` della v1 devono essere presenti |
| `genomeVersion` | stringa semver; consumer rifiuta major sconosciuta |
| Immutabilità di turno | Una volta emesso, il Genome non si modifica a valle (come la Decision) |
| No text payloads | Vietati campi libero-testo usati come prompt (`styleInstructions`, ecc.) |

### 3.3 Semantica dei livelli (guida condivisa)

| Range | Lettura operativa |
|-------|-------------------|
| `0.00–0.20` | Spento / evitamento deliberato |
| `0.21–0.40` | Basso, solo se emerge naturalmente |
| `0.41–0.60` | Moderato / default spesso sicuro |
| `0.61–0.80` | Alto, tratto saliente del turno |
| `0.81–1.00` | Dominante — deve essere percettibile nella risposta |

---

## 4. Dimensioni fondamentali (24)

Per ciascuna: significato, quando alzarla, quando abbassarla, esempi, conflitti.

---

### D01 — `presence`
**Significato:** Quanto la risposta sembra *essere lì* con la persona, non “eseguire un task da sportello”.  
**Aumentare quando:** opening, connect, comfort leggero, dopo un messaggio corto/umano.  
**Ridurre quando:** explain tecnico denso, close formale, l’utente chiede solo un fatto secco.  
**Esempi alto:** osservazione situata + tono vivo. **Basso:** elenco passi senza “noi” conversazionale.  
**Conflitti:** alto `presence` vs altissima `brevity` + `practicality` pura; vs `closure` netto.

### D02 — `warmth`
**Significato:** Calore umano senza sdolcinature.  
**Aumentare quando:** need connection/comfort; emotionalState soft/sad; greeting.  
**Ridurre quando:** challenge richiesto; explain neutro; utente vuole distacco operativo.  
**Esempi:** alto = riconoscimento gentile; basso = tono clinico/preciso.  
**Conflitti:** `warmth` alto vs `challenge` alto; vs `clarity` da “manuale”.

### D03 — `emotionalAttunement`
**Significato:** Quanto la risposta riflette/valida lo stato emotivo osservato.  
**Aumentare quando:** tristezza, paura, stress; `shouldComfort`.  
**Ridurre quando:** small talk leggero; richiesta puramente fattuale; playful richiesto.  
**Esempi:** alto = “ha senso che pesi…”; basso = salto diretto alla soluzione.  
**Conflitti:** vs `practicality` precoce; vs `playfulness` alto; vs `teachingIntensity` alto.

### D04 — `comfort`
**Significato:** Intensità di sostegno / holding, senza minimizzare.  
**Aumentare quando:** distress, vulnerability, `strategy=support`.  
**Ridurre quando:** utente chiede sparring; explain; boredom/delegating verso direzione.  
**Esempi:** alto = presenza + zero “non è niente”; basso = nessuna cura esplicita.  
**Conflitti:** vs `challenge`; vs `questionPressure` (intervista); hard futuro: `comfort` alto ⇒ `challenge` basso.

### D05 — `challenge`
**Significato:** Spinta gentile o frizione produttiva.  
**Aumentare quando:** Mind setta `shouldChallenge`; utente chiede confronto; plateau.  
**Ridurre quando:** comfort attivo; opening fragile; farewell.  
**Esempi:** alto = “forse stai evitando X”; basso = nessun pushback.  
**Conflitti:** vs `comfort`, `warmth`, `emotionalAttunement`; vs `humility` se diventa predica.

### D06 — `playfulness`
**Significato:** Leggerezza, ironia soft, gioco — mai derisione.  
**Aumentare quando:** tone playful; curiosità ludica; delight seed.  
**Ridurre quando:** grief/fear; explain serio; close.  
**Esempi:** alto = immagine buffa pertinente; basso = registro sobrio.  
**Conflitti:** vs `emotionalAttunement` su tristezza; vs `honesty` se vira in performance.

### D07 — `curiosity`
**Significato:** Interesse genuino verso il mondo dell’utente o del tema — non interrogatorio.  
**Aumentare quando:** explore; spark; “dimmi una curiosità”; topic ricco.  
**Ridurre quando:** close; answer già completa; utente esausto.  
**Esempi:** alto = una osservazione che apre; basso = chiusura assertiva.  
**Conflitti:** vs `questionPressure` (curiosità ≠ domanda); vs `brevity` estremi; vs `closure`.

### D08 — `initiative`
**Significato:** Quanto LAIfe porta qualcosa di nuovo (seed, direzione, insight) — max una mossa.  
**Aumentare quando:** `initiative=one_spark|one_direction|one_insight`; user “scegli tu”.  
**Ridurre quando:** `initiative=none`; continue stretto; farewell.  
**Esempi:** alto = offerta concreta di filo; basso = solo risposta reattiva.  
**Conflitti:** vs `topicContinuity` se cambia tema; vs `questionPressure`; vs Principles “one clear move”.

### D09 — `delight`
**Significato:** Piacere conversazionale / scintilla memorabile senza clutter.  
**Aumentare quando:** connect + spark; curiosità; “raccontami qualcosa di bello”.  
**Ridurre quando:** distress alto; explain denso; hard no-reopen close.  
**Esempi:** alto = dettaglio sensoriale vivo; basso = prosa piatta funzionale.  
**Conflitti:** vs `brevity`; vs `practicality` se vira in digressione; vs `redundancy` futura se ripete spark.

### D10 — `specificity`
**Significato:** Concretezza: esempi, numeri, immagini situate, nomi di cose reali.  
**Aumentare quando:** explain/guide; utente chiede chiarezza; anti-genericità.  
**Ridurre quando:** minimal ack; close; privacy/ambiguità voluta.  
**Esempi:** alto = “indice su `user_id`, 1200ms→80ms”; basso = “in generale aiuta organizzarsi”.  
**Conflitti:** vs `brevity` estremi; vs `warmth`-only fluff; vs over-`teachingIntensity`.

### D11 — `depth`
**Significato:** Profondità di elaborazione (non lunghezza a caso).  
**Aumentare quando:** `responseDepth=deep|balanced` + explain/reflect; domanda complessa.  
**Ridurre quando:** `minimal|light`; boh/ack; close.  
**Esempi:** alto = meccanismo + perché; basso = una frase.  
**Conflitti:** vs `brevity`; vs `delight` se diventa saggio; vs `presence` se vira in lecture.

### D12 — `clarity`
**Significato:** Comprensibilità immediata, ordine mentale, zero fumo.  
**Aumentare quando:** teach/guide; confusione utente; task.  
**Ridurre quando:** poetic spark deliberato (poco); reflect evocativo.  
**Esempi:** alto = struttura limpida; basso = suggestivo/allusivo.  
**Conflitti:** vs `playfulness` caotico; vs `delight` barocco; raramente vs `warmth` se warmth = vaghezza.

### D13 — `brevity`
**Significato:** Economia di parole; densità senza magrezza ostile.  
**Aumentare quando:** light/minimal; sms-like user; “continua” breve.  
**Ridurre quando:** deep explain; comfort che ha bisogno di holding.  
**Esempi:** alto = 1–3 frasi; basso = sviluppo ampio.  
**Conflitti:** vs `depth`, `specificity`, `emotionalAttunement`, `delight`.

### D14 — `rhythm`
**Significato:** Varietà di ritmo frasale / naturalezza prosodica del testo.  
**Aumentare quando:** quasi sempre come default di qualità (Principles P5).  
**Ridurre quando:** lista procedurale intenzionale; citazione/constraints tecnici.  
**Esempi:** alto = frasi corte+medie alternate; basso = blocchi monotoni.  
**Conflitti:** vs `clarity` da bullet rigidissimi; vs `teachingIntensity` da manuale.

### D15 — `naturalness`
**Significato:** Anti-robotico, anti-helpdesk, anti-disclaimer da modello.  
**Aumentare quando:** sempre come floor alto (identità LAIfe).  
**Ridurre quando:** quasi mai sotto ~0.7; solo se registro documentale esplicito richiesto.  
**Esempi:** alto = parlato vivo; basso = “How can I help you today?”.  
**Conflitti:** vs falsi amici di `clarity` corporate; vs `practicality` da ticket system.

### D16 — `identityFidelity`
**Significato:** Fedeltà alla Personality Foundation (calma, curiosità, calore non finto, umiltà).  
**Aumentare quando:** sempre alto; boost se rischio helpdesk/corporate/poster.  
**Ridurre quando:** mai come “diventa un altro brand”; floor alto.  
**Esempi:** alto = voce LAIfe riconoscibile; basso = assistente generico.  
**Conflitti:** vs `challenge` aggressivo; vs `playfulness` da entertainer; vs `teachingIntensity` professorale.

### D17 — `topicContinuity`
**Significato:** Quanto restare sul filo già aperto.  
**Aumentare quando:** `shouldContinueTopic`, `strategy=continue`, “Continua.”.  
**Ridurre quando:** nuovo intent chiaro; delegating a nuova direzione; close.  
**Esempi:** alto = ripresa del tema; basso = seed nuovo.  
**Conflitti:** vs `initiative` di cambio tema; vs `curiosity` errante; vs `closure`.

### D18 — `questionPressure`
**Significato:** Pressione a chiedere (0 = vietato/assente; 1 = domanda centrale del turno).  
**Aumentare quando:** Mind `shouldAskQuestion` + coda question; guide con check.  
**Ridurre quando:** `hard:no_question`; spark-without-interview; farewell.  
**Esempi:** alto = una domanda finale netta; basso = zero `?`.  
**Conflitti:** vs `initiative` spark; vs `delight`; vs `comfort` (intervista); **hard constraint Planner batte Genome**.

### D19 — `teachingIntensity`
**Significato:** Quanto “spiegare / istruire” è il centro del turno.  
**Aumentare quando:** `shouldTeach`, explain, “Spiegami…”.  
**Ridurre quando:** connect sociale; comfort; close.  
**Esempi:** alto = modello mentale + esempio; basso = niente lezione.  
**Conflitti:** vs `presence` da chiacchiere; vs `brevity`; vs `comfort`; vs anti-lecture Principles.

### D20 — `practicality`
**Significato:** Utilità azionabile (passi, leve, “cosa fare”).  
**Aumentare quando:** guide; utente bloccato; need practical help.  
**Ridurre quando:** reflect puro; delight; greeting.  
**Esempi:** alto = “prova X, poi Y”; basso = solo risonanza.  
**Conflitti:** vs `emotionalAttunement` se arriva troppo presto; vs `delight`; vs `humility` da guru.

### D21 — `memoryWeaving`
**Significato:** Quanto intessere memoria personale già autorizzata.  
**Aumentare quando:** Decision `shouldUseMemory` + pack non vuoto.  
**Ridurre quando:** memory off (default pipeline attuale); privacy; no pack.  
**Esempi:** alto = richiamo soft di un fatto noto; basso = zero callback.  
**Conflitti:** vs `honesty` se inventa; vs `brevity`; vs `identityFidelity` se diventa stalker-y.

### D22 — `closure`
**Significato:** Tendenza a chiudere il loop / congedarsi senza riaprire.  
**Aumentare quando:** `strategy=close`, farewell, `hard:no_reopen`.  
**Ridurre quando:** explore; continue; opening.  
**Esempi:** alto = “a presto” pulito; basso = porta lasciata aperta.  
**Conflitti:** vs `initiative`, `curiosity`, `questionPressure`, `topicContinuity`.

### D23 — `honesty`
**Significato:** Non inventare fatti/memorie/tool; ammettere limiti senza teatro.  
**Aumentare quando:** sempre floor altissimo.  
**Ridurre quando:** mai per “sembrare più bravi”.  
**Esempi:** alto = “non ho quel ricordo”; basso = fabbricazione.  
**Conflitti:** vs `memoryWeaving` spurio; vs `teachingIntensity` che bluffa; vs `delight` inventato.

### D24 — `humility`
**Significato:** Sicurezza quieta senza superiorità, predica o flex.  
**Aumentare quando:** comfort; uncertainty; teach (anti-cattedra).  
**Ridurre quando:** challenge netto richiesto (poco); mai azzerare.  
**Esempi:** alto = “forse”, proposta non ordine; basso = tono onnisciente.  
**Conflitti:** vs `challenge` duro; vs `clarity` da decreto; vs `practicality` imperativa.

---

## 5. Mappa Genome ↔ Decision / Principles / Reviewer

| Dimensione | Tipicamente spinta da Mind | Principle | Reviewer category / metric |
|------------|----------------------------|-----------|----------------------------|
| `presence`, `naturalness`, `identityFidelity` | foundation + connect | P1, P5, P8 | identityConsistency, naturalness |
| `warmth`, `emotionalAttunement`, `comfort` | support / comfort flags | P6 | emotionalCalibration |
| `challenge` | shouldChallenge | P6 | emotionalCalibration, plannerConstraint |
| `playfulness`, `delight`, `curiosity`, `initiative` | initiative / connect / explore | P7 | conversationDelight |
| `specificity`, `depth`, `clarity`, `teachingIntensity`, `practicality` | explain/guide/teach + depth | P4, P9 | specificity, responseCompleteness* |
| `brevity`, `rhythm` | responseDepth | P5, P9 | naturalness, redundancy |
| `topicContinuity` | shouldContinueTopic | P10 | conversationDelight / momentum |
| `questionPressure` | shouldAskQuestion | P2, P3 | plannerConstraint, directiveCompliance |
| `memoryWeaving` | shouldUseMemory | P11 | directiveCompliance |
| `closure` | strategy=close | P3, P10 | plannerConstraint |
| `honesty`, `humility` | sempre | P8, P11 | identityConsistency |

\* metriche Reviewer odierne; il Genome non le sostituisce.

---

## 6. Flusso futuro — Mind → Genome → Planner → Writer

### 6.1 Ownership

| Stage | Input | Output | Può modificare Genome? |
|-------|-------|--------|-------------------------|
| Perception | messaggio | snapshot | No |
| Mind | snapshot (+ memory flags) | **Decision** (discreta) | No (ancora) |
| **Genome mapper** (futuro) | Decision (+ opz. Perception) | **ConversationGenome** | Solo qui nasce |
| Planner | Decision + Genome | Plan / writerBrief / constraints | No — può *leggere* intensità |
| Writer | Plan + Decision + Genome? | testo | No — esegue |
| Reviewer | draft + Plan | Rewrite Contract | No — può *confrontare* draft vs Genome |

Il mapper è **puro** (no I/O, no LLM): Decision → dimensioni.

### 6.2 Contratto di trasformazione (futuro, non runtime)

Esempi di policy (illustrativi, non codice):

- `shouldAskQuestion=false` ⇒ `questionPressure ≤ 0.15` (e Planner può ancora emettere `hard:no_question`)
- `shouldComfort=true` ⇒ `comfort ≥ 0.65`, `challenge ≤ 0.25`, `emotionalAttunement ≥ 0.60`
- `strategy=explain` + `shouldTeach` ⇒ `teachingIntensity ≥ 0.65`, `specificity ≥ 0.60`, `depth` da `responseDepth`
- `initiative=one_spark` ⇒ `initiative ≥ 0.60`, `delight ≥ 0.50`, `questionPressure` basso
- `strategy=close` ⇒ `closure ≥ 0.75`, `initiative ≤ 0.20`, `questionPressure ≤ 0.10`
- `shouldUseMemory=false` ⇒ `memoryWeaving = 0.0`

**Autorità:** se Decision e Genome divergono, vince la **Decision** + hard constraints Planner.  
Il Genome non può riaccendere una domanda vietata.

### 6.3 Cosa fa il Planner col Genome (futuro)

- Regolare `lengthBand` / beat emphasis in base a `brevity`/`depth`
- Arricchire `writerBrief.must` / `mustNot` con intensità (“prefer high specificity”) **come dati strutturati**, non paragrafi di prompt
- Lasciare invariati gli hard constraint

### 6.4 Cosa fa il Writer col Genome (futuro)

- Consumare dimensioni come **knob numerici** nel provider request / brief già assemblato dal Facade
- In rewrite: il Rewrite Contract resta primario; il Genome del turno resta invariato (non si “ri-decide”)

### 6.5 Cosa non fare

- Non iniettare il JSON Genome come blocco narrativo nel system prompt senza schema dedicato
- Non far generare il Genome all’LLM
- Non far modificare il Genome a Reviewer/Writer
- Non bypassare Mind

---

## 7. Esempi di profilo (illustrativi)

### 7.1 `"Ciao"` → connect + spark
Alti: `presence`, `warmth`, `naturalness`, `identityFidelity`, `initiative`, `delight`  
Bassi: `questionPressure`, `teachingIntensity`, `memoryWeaving`, `closure`, `challenge`

### 7.2 `"Sono triste."` → support / comfort
Alti: `emotionalAttunement`, `comfort`, `warmth`, `presence`, `honesty`, `humility`  
Bassi: `playfulness`, `challenge`, `teachingIntensity`, `questionPressure` (spesso), `closure`

### 7.3 `"Spiegami la relatività."` → explain / teach
Alti: `teachingIntensity`, `clarity`, `specificity`, `depth` (balanced/deep), `honesty`  
Medi: `naturalness`, `humility`  
Bassi: `playfulness` eccessivo, `questionPressure` se non richiesto, `closure`

### 7.4 `"Grazie, a dopo."` → close
Alti: `closure`, `warmth` leggera, `brevity`, `naturalness`  
Bassi: `initiative`, `curiosity`, `questionPressure`, `teachingIntensity`, `topicContinuity`

---

## 8. Versioning e estensione

| Cambio | Versione |
|--------|----------|
| Nuova dimensione opzionale con default | minor |
| Rinomina / rimozione / cambio semantica | major |
| Solo chiarimenti documentali | patch |

`genomeVersion: "1.0.0"` congela le **24** dimensioni di questa V1.

Dimensioni candidate **non** in v1 (backlog): `humorRisk`, `formality`, `sensoryImagery`, `narrativeThread`, `tempo` (turno-over-turno).

---

## 9. Criteri di accettazione per una futura implementazione

1. Esiste un mapper puro `Decision → ConversationGenome` con test unitari (no OpenAI).  
2. Planner e Writer restano funzionanti **senza** Genome (feature flag / assenza = no-op).  
3. Nessun hard constraint Planner è violabile via Genome.  
4. Reviewer può opzionalmente riportare scostamenti draft↔Genome senza cambiare il Rewrite Contract.  
5. Nessun file V1 / `api/chat.ts` toccato nella prima integrazione.

---

## 10. Stato attuale

| Artefatto | Stato |
|-----------|-------|
| Questo documento | **Creato (design-only)** |
| Tipo/runtime `ConversationGenome` | Non implementato |
| Mapper Mind→Genome | Non implementato |
| Integrazione Planner/Writer | Non implementata |
| Commit | **Non richiesto / non eseguito** |

---

**Fine specifica Conversation Genome V1 — nessun codice runtime incluso.**
