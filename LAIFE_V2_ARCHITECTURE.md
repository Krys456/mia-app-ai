# LAIfe V2 — Specifica di architettura software

**Stato:** specifica di progetto (non implementazione)  
**Fonte vincolante:** `LAIFE_V2_ANALYSIS.md`  
**Destinatari:** team di sviluppo LAIfe  
**Ambito:** ridisegno del sistema conversazionale server-side e del contratto client↔API, senza alterare il prodotto V1 finché la migrazione non è completa.

Questo documento definisce **cosa** deve diventare l’architettura. Non contiene codice, refactoring né istruzioni di deploy.

---

# 1. Visione

## 1.1 Filosofia della V2

LAIfe V2 non è “più engine”. È **meno decision-makers e più chiarezza**.

La qualità conversazionale resta l’obiettivo di prodotto: partner intelligente, presente, curioso, utile, piacevole da leggere. Quello che cambia è *come* si ottiene quella qualità.

In V2:

- **Una sola autorità decisionale** per turno (Director).
- **Una sola costituzione di identità** (Personality Foundation), separata dai comportamenti.
- **Una sola memoria unificata** con tre livelli espliciti.
- **Un Writer esecutore**, non un secondo cervello.
- **Un Reviewer unico**, con al massimo una riscrittura.
- **Un prompt Writer corto e strutturato**, non una concatenazione di decine di brief ridondanti.

La filosofia in una frase:

> *Percepisci con precisione, decidi una volta, ricorda ciò che serve, pianifica in modo leggibile, scrivi con voce stabile, revisiona senza loop.*

## 1.2 Problemi della V1 che la V2 risolve

Derivati direttamente dall’analisi V1:

| Problema V1 | Effetto osservato | Soluzione V2 |
|-------------|-------------------|--------------|
| Mesh di ~90+ advisor sempre eseguiti | Costo cognitivo, manutenzione, rumore | Pipeline a 6 moduli fissi |
| Responsabilità sovrapposte (presence, curiosity, openings, constitutions, emotion, planning) | Policy contraddittorie nello stesso prompt | Un Owner per dominio decisionale |
| Triplo encoding delle regole (client prompt + FALLBACK + engine contexts + briefs + directives + gates) | Prompt enorme, conflitti silenziosi | Un solo package istruzioni per il Writer |
| Coordinator con budget direttivo stretto (4) ma context concatenation larga | “Decide poco” in superficie, rumore alto nel contesto | Decision Record unico; niente dump di advisor |
| Engine eseguiti due volte (primary + fail-soft re-run) | Duplicazione di esecuzione | Ogni percezione gira una volta |
| Memoria a 4+ strati con surface prompt simili | Recall inconsistente / ripetizioni | Memory Service con 3 livelli e API unica |
| Post-gate multipli che chiedono la stessa rewrite | Complessità senza più qualità | Un Reviewer, una checklist, una rewrite max |
| Alias e dualismi (critic-engine, diversity client/server) | Confusione operativa | Un componente per concetto |
| Decisioni sparse tra Cognitive Engine, Coordinator, Directive Authority, Writer, gates | Nessuno è davvero “il direttore” | Director = unica autorità |

## 1.3 Principi che devono rimanere invariati

Questi sono **non negoziabili** rispetto alla missione prodotto già presente in V1:

1. **Companion, non helpdesk** — conversazione che si gode, non sportello Q&A.
2. **Invisibilità dei meccanismi** — l’utente non vede engine, piani, score, tool.
3. **Fail-soft** — un fallimento interno non deve rompere la risposta.
4. **OpenAI solo lato server** — il browser non chiama mai il modello direttamente.
5. **Al massimo una rifinitura LLM** dopo la bozza — niente loop di rewrite.
6. **Correttezza > stile** — mai sacrificare i fatti per “suonare meglio”.
7. **Memoria solo se pertinente** — niente dump autobiografici.
8. **Domande economiche** — non chiudere sempre con una domanda.
9. **Lingua sticky** — mantieni la lingua della conversazione; switch solo se intenzionale.
10. **Client constitution rispettata** — personalizzazione utente resta autorevole quando presente.
11. **Tool silenziosi** — memoria/web/vision si integrano in una sola risposta naturale.
12. **Contratto di risposta semplice** — il client riceve testo finale + echo di stato, non il cervello interno.

---

# 2. Architettura generale

## 2.1 Flusso completo

```
Utente
  ↓
Perception
  ↓
Conversation State   ← WHAT IS CURRENTLY TRUE (session working state; echoed across turns)
  ↓
Director (Mind)      ← strategy / Decision Record
  ↓
Memory               ← durable knowledge (not live in V2 Phase 3)
  ↓
Planner              ← WHAT SHOULD HAPPEN NEXT
  ↓
Writer               ← HOW TO SAY IT
  ↓
Contract Evaluator   ← optional contract fidelity (at most one HOW rewrite)
  ↓
State Transition     ← nextConversationState after successful delivery
  ↓
Risposta (+ conversationState echo)
```

### Conversation State vs Memory

- **Conversation State** = short-lived conversation working state (topic, proposals, phase, mode).
- **Memory** = durable user/context knowledge (not implemented in live V2 yet).

### Note di sequenza

1. **Perception** osserva il turno; non decide la strategia.
2. **Conversation State** evolve i fatti da `previousState` + messaggi; non genera prosa.
3. **Director (Mind)** decide il Decision Record senza sovrascrivere i fatti di State.
4. **Memory** (futuro) carica solo ciò che è autorizzato.
5. **Planner** produce piano + writer brief.
6. **Writer** genera il testo.
7. **Contract Evaluator** verifica fedeltà al contratto Planner; al massimo una riscrittura HOW.
8. **State Transition** pubblica lo State del prossimo turno solo se Writer ha consegnato.
9. Echo client di `conversationState` (non Supabase Memory).

### Split Focus / Resume / Director / Momentum (Phase 3)

| Modulo | Resta | Autorità |
|--------|--------|----------|
| Resume | compat `resumeSentence` Writer-only | continuity facts in State |
| Focus | coda / avoidClarification (planning) | **non** pubblica activeTopic |
| Momentum | deprecated alias `conversationMomentum.kind` | **conversationMode** in State |
| Director | `directorState` decisions | topic/engagement from State |

## 2.2 Moduli — responsabilità, input, output, divieti

### 2.2.1 Perception

**Responsabilità**  
Trasformare messaggio utente + storia recente + segnali di sessione in una **Perception Snapshot** strutturata, oggettiva e riusabile.

**Input**
- Ultimo messaggio utente
- Storia recente (limitata)
- Modalità (`text` | `voice`)
- Segnali client: welcome session, preference profile, learning signals (solo come segnali, non come fatti)
- Attachment hints (immagine/documento)
- Flag `memoryEnabled`

**Output — Perception Snapshot**
- Lingua dominante e sticky-language suggerita
- Intent primario e secondari (es. greeting, learning, support, problem solving, celebration, …)
- Framing sociale vs informazionale
- Tono emotivo stimato (energia, serietà, playfulness, frustrazione, …)
- Segnali di continuità (ack, entusiasmo, “continua”, short reply, stop)
- Segnali di leadership richiesta (“scegli tu”, incertezza, silenzio)
- Ambiguity flags
- Knowledge-level hint (beginner…expert) se rilevabile
- Feedback-on-assistant flags (“sei ripetitivo”, “più naturale”, …)
- Attachment presence

**NON deve**
- Scegliere se fare una domanda
- Scegliere apertura, struttura, lunghezza, tool
- Scrivere pezzi di risposta
- Concatenare prompt
- Persistare memoria
- Chiamare il modello

---

### 2.2.2 Director

**Responsabilità**  
Essere l’**unica autorità** che decide cosa fare in questo turno. Produce un **Decision Record** chiuso.

**Input**
- Perception Snapshot
- Personality Foundation (identità, non comportamenti)
- Preferenze utente soft (lunghezza, emoji, custom instructions) come vincoli, non come motori
- Stato conversazione sintetico (topic corrente, ownership precedente) — senza dump

**Output — Decision Record (immutabile per il turno)**
Vedi Sezione 4 per l’elenco completo delle decisioni.

**NON deve**
- Generare testo utente
- Rieseguire Perception
- Concatenare brief di “advisor” multipli
- Rivalutare dopo il Writer (salvo signal esplicito del Reviewer di tipo *policy violation hard*, che può solo triggerare rewrite, non nuove decisioni di dominio)
- Esporre ragionamento all’utente

---

### 2.2.3 Memory

**Responsabilità**  
Fornire e aggiornare fatti/contesto pertinenti secondo le decisioni del Director, con tre livelli chiari (Sezione 6).

**Input**
- Decision Record (policy memoria: off / conversation-only / retrieve permanent / save candidates)
- Query di retrieve (derivata da intent + topic)
- Dopo la risposta: bozza finale + messaggio utente (per save)

**Output**
- Memory Pack (max N item, già filtrati e priorizzati)
- Eventi di save (`saved` | `updated` | `null`)
- Conversation Map aggiornata (echo client)

**NON deve**
- Decidere la strategia conversazionale
- Inserire memoria non autorizzata dal Director
- Scrivere stile/prompt di personalità
- Inventare ricordi
- Esporre meccanismi di storage all’utente

---

### 2.2.4 Planner

**Responsabilità**  
Tradurre Decision Record + Memory Pack in un **Response Plan** corto, strutturato, eseguibile dal Writer.

**Input**
- Decision Record
- Memory Pack
- Personality Foundation (solo per vincoli di voce, non per reinventarla)
- Tool results eventuali (se il Director ha chiesto tool)

**Output — Response Plan**
- Goal del turno (1 frase)
- Move conversazionale (continue / lead / answer / support / teach / celebrate / close)
- Struttura (max 4–6 beat)
- Opening constraint (cosa evitare / cosa privilegiare)
- Question policy (0 o 1, e perché)
- Memory weave instruction (se e come richiamare)
- Tool facts già normalizzati (se presenti)
- Length band
- Epistemic ceiling (fatto / inferenza / opinione)

**NON deve**
- Cambiare decisioni del Director
- Generare la risposta finale
- Aggiungere nuove policy costituzionali
- Recuperare memoria in autonomia
- Superare un budget di lunghezza del piano (piano leggibile in pochi secondi da un umano)

---

### 2.2.5 Writer

**Responsabilità**  
Produrre la bozza di risposta in linguaggio naturale, eseguendo Personality + Decision Record + Response Plan.

**Input**
- Personality Foundation
- Decision Record
- Response Plan
- Memory Pack (già filtrato)
- Storia messaggi (input conversazione)
- Preferenze utente non confliggenti

**Output**
- Draft text (unica risposta candidata)

**NON deve**
- Decidere intent, leadership, question policy, tool, memory policy
- Ignorare WriterDirectives / Decision Record
- Auto-invocare rewrite
- Citare moduli interni
- Allungare “perché c’erano più fonti”

Dettaglio esteso: Sezione 5.

---

### 2.2.6 Reviewer

**Responsabilità**  
Controllo qualità pre-invio con **una checklist unica** e budget di **una sola riscrittura**.

**Input**
- Draft
- Decision Record
- Response Plan
- Personality Foundation (check di coerenza identitaria, non di comportamento)

**Output**
- `accept` + testo finale  
  oppure  
- `rewrite_once` + brief di correzione mirato  
  poi testo finale (accettato anche se imperfetto, salvo hard safety)

**NON deve**
- Aprire un secondo ciclo di planning
- Far girare dozzine di gate indipendenti
- Cambiare Intent/Leadership/Memory policy
- Loop infinito
- Esporre score all’utente

Dettaglio: Sezione 8.

---

## 2.3 Contratto tra moduli (Decision Record come spina dorsale)

Tutti i moduli a valle del Director sono **consumatori** del Decision Record.  
Nessun modulo a valle può creare un Decision Record concorrente.

```
Perception Snapshot
        ↓
 Director → Decision Record ──────────────────────────────┐
        ↓                                                 │
     Memory → Memory Pack                                 │
        ↓                                                 │
     Planner → Response Plan                              │
        ↓                                                 │
     Writer ← Personality + Decision + Plan + Memory ─────┘
        ↓
     Reviewer → Final text (+ optional one rewrite)
```

## 2.4 Dove vive il modello LLM

| Fase | LLM? | Note |
|------|------|------|
| Perception | No (default) | Euristica/deterministica; eventuale modello dedicato solo se necessario in futuro, fuori scope V2 core |
| Director | No | Decisioni deterministiche/rules + scoring semplice |
| Memory retrieve/save | No | DB + ranking |
| Planner | No | Assemblaggio del piano |
| Writer | **Sì — Call A** | Unica generazione primaria |
| Reviewer rewrite | **Sì — Call B opzionale** | Max una |
| Tool selection | No | Euristica (come V1 orchestrator), sotto mandato Director |

Questo preserva il pattern V1 “1–2 call OpenAI” eliminando il costo della mesh advisor.

---

# 3. Responsabilità

## 3.1 Principio

Ogni modulo ha **una sola ragione di cambiare**.

Se due moduli rispondono alla stessa domanda (“devo fare una domanda?”, “come apro?”, “che tono uso?”), uno dei due è di troppo.

## 3.2 Tabella Single Responsibility

| Modulo | Domanda a cui risponde | Unica ragione di cambiamento |
|--------|------------------------|------------------------------|
| **Perception** | “Cosa sta succedendo in questo messaggio?” | Cambiano i segnali da osservare / i classificatori |
| **Director** | “Cosa facciamo in questo turno?” | Cambiano le policy decisionali di prodotto |
| **Memory** | “Cosa ricordiamo / recuperiamo / salviamo?” | Cambiano storage, ranking, privacy, schema fatti |
| **Planner** | “Come organizziamo la risposta?” | Cambiano template di piano / beat structure |
| **Writer** | “Come lo diciamo, in voce LAIfe?” | Cambiano modello, temperature, packaging prompt |
| **Reviewer** | “Questa bozza è accettabile?” | Cambiano criteri qualità / soglie rewrite |
| **Personality Foundation** | “Chi è LAIfe?” | Cambia l’identità di marca (raro) |

## 3.3 Separazioni obbligatorie

| Separazione | Perché |
|-------------|--------|
| Identità ≠ comportamento | Evita che la personalità diventi un elenco di micro-regole turno-per-turno (problema V1: costituzioni + engine texture) |
| Percezione ≠ decisione | Evita che ogni classificazione “spinga” già una strategia |
| Decisione ≠ scrittura | Evita Writer autonomo (problema V1: troppe istruzioni e ancora libertà conflittuale) |
| Memoria ≠ stile | Evita che i recall diventino prompt di personalità |
| Review ≠ re-plan | Evita loop e secondo cervello post-draft |

## 3.4 Regola anti-mesh

È vietato introdurre un nuovo “engine” parallelo se la sua responsabilità rientra già in Perception, Director, Memory, Planner, Writer o Reviewer.

Se serve una nuova capacità, si estende **un** modulo esistente con un sottocomponente interno, senza nuovo decision-maker.

---

# 4. Director

## 4.1 Perché è l’unico autorizzato a decidere

In V1 le decisioni sono frammentate tra:

- advisor engines (suggeriscono),
- Cognitive Coordinator (rank/dedupe con budget stretto),
- Directive Authority (congela),
- Writer (interpreta un prompt enorme),
- post-gates (possono forzare rewrite).

Risultato: **molti “quasi-direttori”**, nessun proprietario chiaro, e conflitti risolti per concatenazione di testo.

In V2 il Director:

1. riceve fatti percepiti (non prose normative);
2. applica policy di prodotto in un punto solo;
3. emette un Decision Record **chiuso**;
4. rende inutili advisor concorrenti sullo stesso slot.

Senza un unico Director, la V2 ricadrebbe nella mesh V1.

## 4.2 Decisioni che il Director PUÒ prendere

Il Decision Record include almeno:

### Identità operativa del turno
- `language` (sticky o switch intenzionale)
- `mode` (conversation | explanation | brainstorming | planning | technical_help | emotional_support | collaboration | teaching)
- `social` (social | informational | mixed)

### Leadership e mossa
- `leadConversation` (yes | no | shared)
- `conversationalMove` (continue | open | answer | support | celebrate | teach | recover | close)
- `topicPolicy` (stay | bridge | new — e se new, perché)

### Domande e iniziativa
- `askQuestion` (true/false)
- `questionPurpose` (clarify_blocking | deepen_earned | none)
- `initiative` (none | one_insight | one_spark) — max uno

### Tono e ritmo (scelte discrete, non essay)
- `emotionalTone` (es. calm | warm | playful | serious | supportive)
- `pace` (short | balanced | reflective)
- `responseLength` (concise | balanced | detailed)

### Memoria e tool
- `memoryRetrieve` (none | conversation | permanent | both)
- `memorySave` (allow | deny)
- `tools` (lista ordinata: memory/web/vision/document/… oppure none)
- `webOff` sticky se richiesto

### Vincoli di qualità / risk
- `epistemicCeiling` (fact | strong_evidence | inference | speculation | opinion)
- `hardConstraints` (no_end_question, no_robotic_opener, no_interview, emotion_first, …)
- `rewriteBudget` (sempre 1 max a livello sistema; il Director non lo alza)

### Apertura e coda
- `openingPolicy` (observation | continuation | answer_direct | warm_ack | spark — uno solo)
- `codaPolicy` (none | memorable_line | soft_invite — uno solo; default spesso none)

## 4.3 Decisioni che il Director NON può prendere

- Il **testo** della risposta (parole, frasi, metafore concrete)
- Il **modello LLM** da usare (config infrastruttura)
- La **verità fattuale** inventata (non può creare fatti; può solo impostare epistemic ceiling)
- La **persistenza tecnica** (schema DB, timeout) — decide solo policy allow/deny
- La **UI** (toast, reveal, streaming client)
- Una **seconda strategia** dopo il Reviewer (niente re-direct mid-rewrite)
- **Override della Personality Foundation** (può scegliere mode/tone entro l’identità, non cambiare chi è LAIfe)
- **Safety legale/policy di piattaforma** oltre i hard constraints di prodotto (restano layer infra separato se necessario)

## 4.4 Forma del Decision Record

Requisiti non negoziabili:

- Strutturato (campi tipizzati), non prosa libera.
- Completo per il Writer senza bisogno di rileggere 40 brief.
- Idempotente per il turno.
- Serializzabile per debug interno (mai mostrato all’utente).
- Piccolo: un umano deve poterlo leggere in < 30 secondi.

---

# 5. Writer

## 5.1 Writer ideale

Il Writer V2 è un **esecutore espressivo**:

- ha una voce stabile (Personality Foundation);
- riceve ordini chiari (Decision Record + Response Plan);
- riceve fatti già filtrati (Memory Pack / tool facts);
- scrive **solo** la risposta finale;
- non negozia la strategia.

Idealmente il prompt Writer è:

1. Personality Foundation (corta, identitaria)
2. Preferenze utente non confliggenti (nome, lunghezza, emoji, custom)
3. Decision Record (campi, non saggi)
4. Response Plan (beat)
5. Memory/Tool pack (se presente)
6. Regola: *scrivi solo la risposta; non citare il piano*

Niente concatenazione di decine di “Può arrivare ENGINE X…”.

## 5.2 Cosa riceve

| Pacchetto | Contenuto |
|-----------|-----------|
| Personality Foundation | Identità stabile |
| User preferences | Soft constraints |
| Decision Record | Ordini di turno |
| Response Plan | Struttura eseguibile |
| Memory Pack | Fatti pertinenti |
| Conversation input | Messaggi user/assistant |
| (Opzionale) Review rewrite brief | Solo se Call B |

## 5.3 Cosa produce

- Una bozza di messaggio assistant in lingua corretta
- Nessun metadata utente
- Nessuna checklist
- Nessuna auto-valutazione esposta

## 5.4 Cosa non deve più decidere autonomamente

Rispetto a V1, il Writer **non** decide più:

- se fare una domanda
- se guidare o seguire
- se recuperare memoria
- quale mode/behavior usare
- quale apertura tipologica scegliere
- se aggiungere insight/surprise/coda
- se “social first” o “information first”
- se riscrivere se stesso (lo fa solo su mandato Reviewer, una volta)

Il Writer decide ancora (inevitabilmente, perché è un LLM):

- lessico, ritmo frasale, esempi, metafore **entro** i vincoli
- come realizzare i beat del piano in prosa naturale

Ma non può contraddire il Decision Record.

---

# 6. Memory

## 6.1 Obiettivo

Sostituire i quattro+ meccanismi V1 (brain-memory, memory map, conversational memory, memory flow, più store client paralleli) con **un Memory Service** a tre livelli e un’unica API concettuale.

## 6.2 Tre livelli

### A. Memoria permanente

**Cos’è**  
Fatti duraturi sull’utente e sulla relazione: preferenze stabili, nome, progetti di lungo periodo, vincoli importanti, decisioni esplicite “ricorda che…”.

**Persistenza**  
Database (come l’attuale brain-memory / Supabase).

**Quando usarla**
- Il Director setta `memoryRetrieve` include `permanent`
- C’è segnale di recall personale
- Welcome/returning user ha bisogno di un fatto stabile ad alto valore
- Save solo se `memorySave=allow` e il fatto passa filtri anti-rumore

**Quando non usarla**
- Small talk puro senza richiamo utile
- Fatti effimeri del turno (“ok”, “grazie”)
- Preferenze stilistiche momentanee (vanno in temporanea o preference profile)

### B. Memoria della conversazione

**Cos’è**  
Mappa viva della chat corrente: temi esplorati, domande aperte, goal, spiegazioni già date, ownership del filo, callback utili (battuta, idea in sospeso).

**Persistenza**  
Session echo client↔server (come memory map), eventualmente snapshot server-side di sessione — **non** confusa con i fatti permanenti.

**Quando usarla**
- Quasi ogni turno dopo il primo, in forma compatta
- Per evitare ripetizioni e restart
- Per continuare lo stesso filo (“build, don’t reset”)

**Quando non usarla**
- Come sostituto della memoria permanente
- Come dump intero nel prompt (solo estratto pertinente al Decision Record)

### C. Memoria temporanea

**Cos’è**  
Stato operativo a breve vita: learning signals, preference profile di stile, welcome used-greetings, pending automation, voice interrupt/resume, bozze tool.

**Persistenza**  
Client local/session storage o TTL breve.

**Quando usarla**
- Calibrare stile senza salvare come “fatto”
- Continuare un flusso multi-step (automation confirm)
- Evitare aperture welcome ripetute

**Quando non usarla**
- Come fonte di fatti biografici
- Come costituzione di personalità
- Oltre la sessione se non esplicitamente promossi a permanenti

## 6.3 API concettuale unica

```
Memory.load(decision, perception) → Memory Pack
Memory.save(decision, turn) → memoryEvent
Memory.promote(temporary → permanent) // solo con criteri stretti / conferma
```

## 6.4 Memory Pack (output tipico)

- Max pochi item (es. ≤ 3 permanenti + ≤ 5 conversation callbacks)
- Ogni item ha: tipo, testo corto, rilevanza, epistemic tag
- Istruzione di weave: silenzio | soft bridge | explicit callback — scelta già presa dal Director/Planner, non dalla Memory

## 6.5 Diversità anti-ripetizione

Il dualismo V1 client diversity vs server diversity si unifica:

- **Conversation memory** tiene traccia di forme/temi recenti
- Il Director/Planner applica policy anti-ripetizione
- Niente secondo “diversity brain” indipendente nel prompt client

---

# 7. Personality

## 7.1 Ruolo

La Personality Foundation è l’**identità stabile** di LAIfe.  
Non è un motore. Non è una checklist di turni. Non decide comportamenti.

Vive una volta sola nel prompt Writer (e nel Reviewer come riferimento di coerenza). Non viene riscritta da ogni advisor.

## 7.2 Foundation (solo identità)

LAIfe è:

- calma e thoughtful
- naturalmente curiosa
- emotivamente intelligente
- umile
- ottimistica senza esagerazione
- quietly confident
- calda senza finzione
- intelligente e piacevole da frequentare

LAIfe **non** è:

- un assistente generico da sportello
- drammatica, robotica o iper-entusiasta
- un terapeuta dichiarato
- un’enciclopedia parlante
- una personalità che cambia a ogni messaggio

Test identitario interno (non comportamento):

> *Does this sound like someone I would genuinely enjoy talking to?*

## 7.3 Cosa NON contiene questa sezione (di proposito)

Niente di tutto ciò che in V1 era “behavior engine”:

- quando fare domande
- come aprire
- quando guidare
- quanto essere lunghi
- policy tool
- checklist worth-reading
- regole social vs informational

Quelli sono **Decisioni del Director** o **criteri del Reviewer**, non identità.

## 7.4 Personalizzazione utente

Nome, bias soft di stile, lunghezza preferita, emoji, custom instructions restano **preferenze**, subordinate a:

1. Safety / hard constraints
2. Personality Foundation
3. Decision Record del turno

Non riscrivono chi è LAIfe.

---

# 8. Reviewer

## 8.1 Controllo qualità unico

Il Reviewer sostituisce la costellazione V1 di:

- Self-Critique
- Satisfaction Estimator
- Delight / Self-Reflection / Constitution / Ownership / Worth Reading / Quality / Authority gates
- Conversation Critic
- dozzine di `draftViolates*`

Una checklist. Un budget. Un esito.

## 8.2 Aspetti che controlla

Checklist obbligatoria (pass/fail + note brevi):

1. **Fedeltà alle decisioni** — lingua, mode, askQuestion, lead, length, coda
2. **Identità** — suona ancora come LAIfe (Foundation), non helpdesk
3. **Utilità** — risponde all’intent percepito / goal del piano
4. **Naturalità** — niente opener robotici, filler, “How can I help?”, chiusure sportello
5. **Question economy** — nessuna domanda se `askQuestion=false`; max una se true
6. **Memoria** — non inventa ricordi; non dumpa
7. **Epistemic honesty** — non spinge certezza oltre il ceiling
8. **Momentum** — non resetta il filo senza `topicPolicy` che lo autorizzi
9. **Delight minimo** — non piatta/cliché obbligatori; non richiede “geniale”
10. **Hard rejects** — frasi vietate note / interview loop / encyclopedia dump non richiesto

## 8.3 Quando richiede UNA riscrittura

Rewrite **una sola volta** se uno o più fail “riparabili” senza nuovo planning, ad esempio:

- domanda presente contro policy
- opener robotico / delight killer
- violazione lingua
- length band palesemente fuori
- helpdesk coda
- contraddizione hard con Decision Record

Il brief di rewrite è corto, puntuale, non una nuova costituzione.

## 8.4 Quando accetta la risposta

Accetta se:

- tutti i check hard passano, oppure
- dopo la singola rewrite i hard passano,

anche se soft quality non è perfetta.

Accetta **senza rewrite** se i fail sono solo soft estetici minori (micro-ritmo, wit assente, ecc.).

In caso di conflitto tra bellezza e fedeltà alle decisioni: **vincono le decisioni + correttezza**.

## 8.5 Cosa succede dopo l’accept

1. Testo finale → client
2. Memory.save secondo Decision Record
3. Aggiornamento conversation memory / temporanea
4. Nessun altro LLM call

---

# 9. Moduli della V1

Legenda:

- **KEEP** — resta concettualmente, eventualmente ribattezzato/relocato
- **MERGE** — la responsabilità sopravvive dentro un modulo V2
- **REWRITE** — l’idea resta ma il design deve essere rifatto
- **REMOVE** — non entra in V2 come componente (valore assorbito altrove o rumore netto)

Motivazioni basate su `LAIFE_V2_ANALYSIS.md`.

## 9.1 Spine / infrastruttura

| Componente V1 | Verdetto | Motivo |
|---------------|----------|--------|
| `api/chat.ts` (shell HTTP) | **REWRITE** | Resta entrypoint, ma deve orchestrare Perception→…→Reviewer invece della mesh |
| `cognitive-engine.js` | **REWRITE** | Oggi è il “tuttofare”; in V2 la pipeline è esplicita e più corta |
| `cognitive-coordinator.js` | **REWRITE** → diventa **Director** | È il decision maker dichiarato, ma oggi affogato da re-run e brief dump |
| `directive-authority.js` | **MERGE** nel Director | Le WriterDirectives sono il Decision Record |
| `orchestrator.js` | **KEEP** (sotto Director) | Tool routing euristico utile; non deve più decidere strategia conversazionale |
| `brain-memory.js` | **KEEP** come backend Permanent Memory | Buona base durable; API esposta via Memory Service |
| `supabase.js` | **KEEP** | Infra storage |
| `http.js` | **KEEP** | CORS/JSON |
| Client `ChatContext` / `chatApi` | **KEEP** (contratto snellito) | Echo stato sì; meno cervello nel systemPrompt |
| `personality.ts` (prompt client) | **REWRITE** | Separare Foundation da behavior/diversity dump |
| `src/lib/diversity/*` | **MERGE** in Conversation Memory + Director policy | Eliminare dualismo client/server |
| Eval scripts | **KEEP** | Fuori runtime; utili a validare V2 |

## 9.2 Identità / legge / qualità (overlap 8.1)

| Componente | Verdetto | Motivo |
|------------|----------|--------|
| Human Personality Foundation (concetto) | **KEEP** → Personality | Identità di prodotto |
| `conversation-constitution` | **MERGE** → Reviewer + pochi hardConstraints Director | Legge utile, non come engine parallelo |
| `human-impact-constitution` | **MERGE** → Reviewer/Director constraints | Ridondante come modulo standalone |
| `project-soul` | **MERGE** → Personality (essenza) / REMOVE residui behavior | Parte identitaria sì; checklist no |
| `laife-manifesto` | **MERGE** → Personality | Messaggio di marca, non runtime engine |
| `conversation-ownership` | **MERGE** → Director (`leadConversation`) | È una decisione, non un protocollo ripetuto |
| `worth-reading-protocol` | **MERGE** → Reviewer | Criterio qualità post-draft |
| `conversation-quality-gate` | **REWRITE** → Reviewer unico | Priorità alta V1; in V2 è *il* gate |
| `cognitive-authority-engine` | **MERGE** → Director + Reviewer | Autorità sì; engine separato no |
| `self-critique` | **MERGE** → Reviewer | Già cuore del refine budget |
| `satisfaction-estimator` | **MERGE** → Reviewer | Un segnale, non un motore |
| `self-reflection-engine` | **MERGE** → Reviewer (preflight checks assorbiti) | Evitare doppia checklist pre/post |
| `conversation-delight` | **MERGE** → Reviewer soft checks + strip helpers | Delight sì; gate separato no |
| `conversation-critic` / `conversation-critic-engine` | **MERGE** → Reviewer; **REMOVE** alias | Alias inutile |
| Soft strip helpers (robotic openers, delight killers) | **KEEP** come util del Reviewer | Deterministici e utili |

## 9.3 Social / intent / leadership

| Componente | Verdetto | Motivo |
|------------|----------|--------|
| `social-conversation-engine` | **MERGE** → Perception (+ Director mode/social) | Classificazione precoce utile |
| `social-context-engine` | **MERGE** → Perception | Tono/relazione = percezione |
| `conversation-intent` | **MERGE** → Perception | Intent è osservazione |
| `conversation-leadership` | **MERGE** → Director | Decisione di leadership |
| `topic-leadership` | **MERGE** → Director | Stesso dominio leadership/topic |
| `conversation-intelligence` | **MERGE** → Perception + Conversation Memory | Sessione sintetica |
| `language-awareness` | **MERGE** → Perception + Director `language` | Sticky language essenziale |
| `human-conversation-simulator` | **MERGE** → Director move | Utile come intent-of-move, non modulo fantasma |
| `insight-discovery` | **MERGE** → Director `initiative` | Max un insight, decisione unica |

## 9.4 Openings / welcome / spark

| Componente | Verdetto | Motivo |
|------------|----------|--------|
| `welcome-engine` | **MERGE** → Director opening + Temporary Memory | Serve returning/first; non engine autonomo |
| `conversation-opening-engine` | **MERGE** → Director `openingPolicy` | Troppa overlap |
| `opening-intelligence-engine` | **MERGE** → Reviewer opening checks | Qualità apertura = review |
| `conversation-spark-engine` | **MERGE** → Director initiative/opening | Iniziativa sì; spark library come dato opzionale |
| `conversation-opportunity-engine` | **MERGE** → Director | Stesso dominio |
| `conversation-opening-sparks` (corpus) | **REWRITE** o **REMOVE** progressivo | Corpus enorme; in V2 al massimo data pack opzionale, non motore |
| `small-talk-intelligence-engine` | **MERGE** → Perception/Director social mode | Ridondante con social stack |
| `warm-conversation` | **MERGE** → Personality + Reviewer strips | Calore = identità; strip = review |

## 9.5 Presence / naturalità / voice texture

| Componente | Verdetto | Motivo |
|------------|----------|--------|
| `presence-engine` | **MERGE** → Personality + Director pace/tone | Overlap dichiarato |
| `conversational-presence` | **MERGE** → Personality / Reviewer | Stesso asse |
| `natural-dialogue-engine` | **MERGE** → Perception (move) + Director | Mossa dialogica |
| `natural-conversation-engine` | **MERGE** → Personality + Reviewer | Quasi duplicato |
| `personal-voice-engine` | **MERGE** → Personality | Voce = identità |
| `personality-consistency-engine` | **MERGE** → Personality | Consistenza identitaria |
| `human-imperfection-engine` | **REMOVE** (default) / eventuale soft Planner hint raro | Texture opzionale; alto rischio rumore |
| `human-conversation-corpus` | **REMOVE** come runtime | Eventuale dataset eval, non engine |
| `conversational-pragmatics-engine` | **MERGE** → Perception | Ironia/teasing = percezione |
| `narrative-conversation-engine` | **MERGE** → Director move=continue + Planner | Continuazione narrativa |
| `voice-conversation` | **KEEP** come profilo Writer mode voice | Modalità reale, non mesh |

## 9.6 Curiosity / questions / coda

| Componente | Verdetto | Motivo |
|------------|----------|--------|
| `question-economy` | **MERGE** → Director `askQuestion` | Decisione centrale |
| `curiosity-engine` | **MERGE** → Director initiative | Coda curiosità = decisione |
| `genuine-curiosity-engine` | **MERGE** → Director + Reviewer | Policy anti keep-alive |
| `wonder-engine` | **MERGE** → Director initiative | Overlap curiosity |
| `next-ask-prediction` | **MERGE** → Planner (opzionale soft) | Non deve forzare domande |
| `shared-discovery-engine` | **MERGE** → Director initiative | Stesso slot coda |
| `intellectual-initiative` | **MERGE** → Director `initiative` | Unificare |
| `surprise-without-confusion` | **MERGE** → Director initiative | Unificare |
| `conversation-momentum` | **MERGE** → Director move/coda | Flusso |
| `conversation-continuation` | **MERGE** → Director move=continue | Essenziale anti-reset |
| `conversation-mindset` | **MERGE** → Personality (spirito) / REMOVE runtime | Non deve essere engine |

## 9.7 Thinking / planning depth

| Componente | Verdetto | Motivo |
|------------|----------|--------|
| `think-before-speaking` | **MERGE** → Planner | Pre-write structure |
| `thoughtfulness-engine` | **MERGE** → Planner goal/contribution | Overlap depth |
| `deep-thinking-engine` | **MERGE** → Planner | Una sola fase di thinking plan |
| `deep-thinking-writer` | **REMOVE** come modulo | Confonde Writer con planning |
| `reasoning-expansion-engine` | **MERGE** → Planner | Stesso dominio |
| `wisdom-engine` | **MERGE** → Reviewer soft + Director tone | Evitare sermoni |
| `progressive-reasoning` | **MERGE** → Planner | Utile se compatto |
| `adaptive-reasoning` | **MERGE** → Director effort/mode | Scelta effort |
| `response-mode-engine` | **MERGE** → Director `mode` | |
| `conversation-director` (V1) | **MERGE** → Director V2 | Nome già corretto; oggi non è unico |
| `conversation-planner-engine` | **MERGE** → Planner | |
| `task-planner` | **KEEP** sotto Planner | Struttura task |
| `multi-step-task-planner` | **KEEP** sotto Planner/Actions | Casi multi-azione |
| `dynamic-behavior` | **MERGE** → Director `mode` | |
| `expert-teacher` | **MERGE** → Director mode=teaching + Planner layers | |
| `info-prioritization` / `information-value-estimator` | **MERGE** → Planner/Memory ranking | |
| `knowledge-level-estimator` | **MERGE** → Perception + Director depth | |
| `intellectual-honesty` | **MERGE** → Director epistemicCeiling + Reviewer | |

## 9.8 Emotion / pace

| Componente | Verdetto | Motivo |
|------------|----------|--------|
| `emotional-momentum-engine` | **MERGE** → Perception + Director tone | Unificare emotional stack |
| `emotional-continuity-engine` | **MERGE** → Conversation Memory + Director | |
| `emotional-resonance-engine` | **MERGE** → Director tone | |
| `conversation-chemistry-engine` | **MERGE** → Reviewer soft / REMOVE runtime pesante | Alto overlap |
| `conversation-pace-engine` | **MERGE** → Director `pace` | |
| `human-timing-engine` | **MERGE** → Director pace/coda | |
| `intelligent-silence-engine` | **MERGE** → Director codaPolicy=none / short | |
| `deep-listening-engine` | **MERGE** → Perception | Ascolto = percezione |
| `micro-observation-engine` | **MERGE** → Planner optional beat / REMOVE se rumore | |
| `internal-monologue-engine` | **REMOVE** come output runtime | Non deve entrare nel prompt utente |
| `authentic-agreement-engine` | **MERGE** → Director tone/move | |
| `authentic-opinions-engine` | **MERGE** → Personality + epistemic opinion | |
| `conversational-creativity-engine` | **MERGE** → Planner/Writer freedom entro vincoli | |
| `storytelling-engine` | **MERGE** → Director move + Planner | |
| `conversation-recovery-engine` | **MERGE** → Director move=recover | |
| `conversation-taste` | **MERGE** → Reviewer soft taste checks | |
| `human-conversation-score` | **MERGE** → Reviewer; fix naming debt V1 | |
| `conversation-reflection` / learning signals | **KEEP** come Temporary Memory | Non factual |

## 9.9 Memory stack V1

| Componente | Verdetto | Motivo |
|------------|----------|--------|
| `conversation-memory-map` | **MERGE** → Conversation Memory | |
| `conversational-memory-engine` | **MERGE** → Conversation Memory | |
| `conversation-memory-flow` | **MERGE** → Planner weave instruction | Tessitura ≠ storage |
| Preference profile / welcome / pending / voice sessions | **KEEP** come Temporary Memory | |
| Adaptive self-awareness / feedback-interpretation | **MERGE** → Perception (feedback flags) + Temporary Memory | |

## 9.10 Azioni / vita / plugin

| Componente | Verdetto | Motivo |
|------------|----------|--------|
| `life-intelligence` | **KEEP** come capability sotto Director tools/initiative | Silenzio se no valore |
| `nl-automation-builder` | **KEEP** capability | |
| `device-manager` | **KEEP** capability | |
| `action-engine` + trust/plugins | **KEEP** capability | Trust resta |
| Domain silenti nella chat tipica | Restano **on-demand**, non pipeline fissa | Risolve “sempre eseguiti ma inutili” |

## 9.11 Sintesi portafoglio V1 → V2

| Azione | Quanti concetti (ordine di grandezza) |
|--------|----------------------------------------|
| KEEP | Spine infra, brain-memory, orchestrator tools, voice mode, action/life/plugin capabilities, learning signals |
| MERGE | La maggioranza degli ~90 advisor → Perception / Director / Memory / Planner / Reviewer / Personality |
| REWRITE | chat shell, cognitive-engine, coordinator→Director, quality gate→Reviewer, client personality prompt, opening sparks data |
| REMOVE | Alias critic-engine; dual diversity client; texture engines a basso segnale (internal monologue, human corpus runtime, imperfection di default); costituzioni duplicate come runtime |

---

# 10. Roadmap

Principio guida: **strangler migration**.  
V1 resta il path di default. Ogni fase aggiunge pezzi V2 dietro flag, senza spegnere la mesh finché il pezzo non è dimostrabilmente equivalente o migliore.

Ogni fase è **indipendente**: può essere rilasciata, misurata, eventualmente messa in pausa senza dipendere dalle successive.

## Fase 0 — Contratto e osservabilità

**Obiettivo:** rendere visibile ciò che oggi è opaco, senza cambiare output.  
**Deliverable:** Decision Record *shadow* (calcolato in parallelo, non inviato al Writer); metriche di lunghezza prompt; conteggio gate che chiedono rewrite.  
**Criterio di uscita:** dashboard interna su rumore prompt e conflitti askQuestion/lead.  
**V1:** invariata.

## Fase 1 — Personality Foundation unica

**Obiettivo:** una sola identità corta lato server+client allineati; rimuovere behavior dal blocco identità.  
**Deliverable:** Foundation documentata (Sez. 7) usata come pezzo stabile del prompt; client smette di iniettare policy engine-like ridondanti (dietro flag).  
**Criterio di uscita:** A/B qualitativo “suona ancora LAIfe” senza regressioni.  
**V1:** fallback mesh ancora attiva.

## Fase 2 — Reviewer unico

**Obiettivo:** sostituire la catena di gate post-draft con un Reviewer unico a checklist, mantenendo max 1 rewrite.  
**Deliverable:** Reviewer in parallelo (shadow) poi cutover flag.  
**Criterio di uscita:** stesso o minor tasso di rewrite; nessun aumento helpdesk-isms.  
**V1:** gate vecchi disattivabili per flag senza deploy di emergenza inverso.

## Fase 3 — Memory Service a 3 livelli

**Obiettivo:** API unica load/save; map + conversational + flow dietro Conversation Memory; permanent resta brain-memory.  
**Deliverable:** Memory Pack standard nel path V2; echo client invariato per compatibilità.  
**Criterio di uscita:** recall pertinente ≥ V1; meno dump; memoryEvent stabile.  
**V1:** retrieve vecchio ancora disponibile.

## Fase 4 — Perception Snapshot

**Obiettivo:** estrarre social/intent/language/emotion/continuation in un unico snapshot.  
**Deliverable:** Perception module; gli engine equivalenti non scrivono più nel prompt direttamente quando flag V2 on.  
**Criterio di uscita:** snapshot completo sui turni di eval esistenti (intent/leadership/social).  
**V1:** engines ancora eseguibili in shadow.

## Fase 5 — Director + Decision Record

**Obiettivo:** un solo decision-maker; Directive Authority assorbita.  
**Deliverable:** Decision Record consumato dal Writer path V2; Coordinator non concatena più brief multipli.  
**Criterio di uscita:** decisioni ask/lead/language coerenti negli eval; prompt Writer drasticamente più corto.  
**V1:** mesh può restare per rollback.

## Fase 6 — Planner corto

**Obiettivo:** Response Plan ≤ N righe/beat al posto di deep-thinking chain.  
**Deliverable:** Planner V2; spegnimento dei thinking engines nel path flaggato.  
**Criterio di uscita:** qualità spiegazione/insegnamento non regressiva; latenza pre-Writer in calo.

## Fase 7 — Writer packaging V2

**Obiettivo:** `buildInstructions` = Foundation + preferences + Decision + Plan + Memory Pack.  
**Deliverable:** cutover Writer; cognitiveBlock legacy non più append-all.  
**Criterio di uscita:** qualità umana ≥ baseline; costi token ↓; fail-soft preservato.

## Fase 8 — Spegnimento mesh e pulizia concettuale

**Obiettivo:** path V2 default; advisor V1 fuori dal critical path.  
**Deliverable:** feature flag default ON; inventario REMOVE effettivo (senza fretta).  
**Criterio di uscita:** V1 richiamabile solo come escape hatch temporaneo.

## Fase 9 — Capabilities on-demand

**Obiettivo:** life/action/device/automation solo se Director li richiede.  
**Deliverable:** niente esecuzione fissa nella pipeline conversazionale tipica.  
**Criterio di uscita:** latenza mediana chat tipica ridotta; capability ancora funzionanti nei casi dedicati.

## Regole di migrazione

1. Nessuna fase richiede il completamento di tutte le altre per portare valore.
2. Rollback = feature flag, non rewrite di emergenza.
3. Eval suite esistente (`scripts/eval-*.mjs`) va ripuntata ai moduli V2 man mano.
4. Divieto di aggiungere nuovi engine V1-style durante la migrazione.

---

# 11. Obiettivo finale

## Come dovrà essere LAIfe V2 (orizzonte di maturità del prodotto)

Non si parla di file o moduli. Si parla di cosa prova una persona usando LAIfe.

### Prima impressione

Aprire una chat con LAIfe dovrà sentirsi subito come incontrare qualcuno di intelligente e calmo, non come aprire un ticket di supporto. Il primo scambio avrà già un filo, una direzione, una presenza. Non chiederà “Come posso aiutarti?” per abitudine.

### Continuare a parlare

Dopo cinque, dieci, venti messaggi, la conversazione dovrà sembrare **la stessa relazione**, non un reset continuo. LAIfe ricorderà i temi giusti al momento giusto, senza sbandierare “come hai detto tre settimane fa”. Se l’utente dice “wow” o “continua”, la storia andrà avanti — non ripartirà da un riassunto da manuale.

### Essere capiti

Quando l’utente è ironico, stanco, euforico, vago o delega (“scegli tu”), LAIfe dovrà rispondere a **ciò che sta succedendo tra due persone**, non solo alle parole letterali. Meno interrogatori. Più contributi. Domande solo quando servono davvero.

### Fiducia

L’utente dovrà sentire che LAIfe non inventa ricordi, non esagera la certezza, non finge emozioni. Se qualcosa non è chiaro, lo dirà in modo semplice. Se può aiutare con un fatto utile della vita o una memoria pertinente, lo farà senza invadenza.

### Leggerezza operativa

Le risposte arriveranno con la stessa calore di oggi, ma con meno sensazione di “motore che pensa troppo”. Meno contraddizioni di tono. Meno chiusure da chatbot. Più coerenza da persona stabile.

### Controllo umano

Nelle impostazioni, personalizzazione e memoria resteranno comprensibili: l’utente sente di poter orientare lo stile senza riscrivere l’anima del prodotto. La memoria gestibile resterà un luogo chiaro, non una scatola magica opaca.

### Promessa di marca

Tra sei mesi, la frase che un utente dovrebbe poter dire senza sforzo è:

> *“Parlare con LAIfe è piacevole, utile, e sembra sempre la stessa presenza — non un assemblaggio di regole.”*

Quella è la definizione di successo della V2.

---

## Appendice A — Glossario

| Termine | Significato |
|---------|-------------|
| Perception Snapshot | Output strutturato della Perception |
| Decision Record | Output immutabile del Director |
| Memory Pack | Fatti filtrati per il turno |
| Response Plan | Piano corto per il Writer |
| Personality Foundation | Identità stabile non comportamentale |
| Reviewer | Unico controllo qualità pre-invio |
| Soft/Hard check | Soft = preferenza qualità; Hard = vincolo che forza rewrite o blocco |

## Appendice B — Criteri di accettazione architetturali (Definition of Done V2)

1. Un solo decision-maker per turno.
2. Un solo package istruzioni Writer (no append-all di advisor).
3. Memoria a tre livelli con API unica.
4. Max una rewrite LLM.
5. Nessun nuovo engine fuori dai sei moduli.
6. V1 spegnibile per flag dopo cutover.
7. Esperienza utente allineata alla Sezione 11.

---

*Fine specifica — nessun codice di implementazione in questo documento.*
