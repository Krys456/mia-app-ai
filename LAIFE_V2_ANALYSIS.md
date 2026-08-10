# LAIfe V2 — Analisi architetturale completa

Documento di sola analisi (nessun refactoring, nessuna modifica al comportamento).  
Basato sul codice presente su `architecture-v2` / `main` al momento dell’analisi.

---

## Panoramica

LAIfe è un companion conversazionale (Vite + React 19 frontend, API Vercel Node `/api/chat`) la cui qualità della risposta non dipende da un singolo prompt, ma da una **mesh di advisor engines** che:

1. pianificano prima della generazione (`cognitive-engine.js`);
2. vengono coordinati e filtrati (`cognitive-coordinator.js`);
3. congelano decisioni immutabili (`directive-authority.js`);
4. alimentano un unico Writer OpenAI (`api/chat.ts`);
5. applicano gate post-draft e al massimo **una** rifinitura LLM.

| Layer | File chiave | Ruolo |
|-------|-------------|--------|
| UI / client | `src/context/ChatContext.tsx`, `src/lib/chatApi.ts`, `src/lib/personality.ts` | Messaggio utente, `systemPrompt`, session echo |
| API shell | `api/chat.ts` (~2314 righe) | Handler HTTP, Writer, gate, memoria post-turn |
| Pre-Writer brain | `lib/server/cognitive-engine.js` (~4563) | Pipeline advisor + tools + context |
| Decision maker | `lib/server/cognitive-coordinator.js` (~12780) | Rank / dedupe / conflict / brief |
| Tool routing | `lib/server/orchestrator.js` | Heuristic tool selection + execute |
| Memoria durable | `lib/server/brain-memory.js` + Supabase | Retrieve pre-Writer, save post-Writer |

---

## 1. Come nasce una risposta (utente → risposta finale)

Flusso end-to-end:

```
[UI] InputBar → ChatContext.sendMessage / runAssistantCompletion
        │
        ├─ buildSystemPrompt(personalization, topicMemory)   // client constitution
        ├─ session echoes: learningSignals, welcomeSession,
        │   conversationMemoryMap, preferenceProfile, pendingAutomation
        └─ POST /api/chat  (requestChatCompletion)
                │
                ▼
[api/chat.ts] CORS → parse/sanitize messages (max 40)
                │
                ├─ runCognitiveEngine(...)                   // fail-soft
                │     ├─ ~90+ advisor engines in sequence
                │     ├─ collectAdvisorSuggestions
                │     ├─ runCognitiveCoordinator
                │     ├─ executeTools(['memory', …])         // retrieve
                │     ├─ runDirectiveAuthority               // WriterDirectives
                │     └─ assemble result.context → cognitiveBlock
                │
                ├─ buildInstructions(systemPrompt | FALLBACK, cognitiveBlock)
                │
                ├─ OpenAI Call A: client.responses.create     // Writer
                │
                ├─ Soft cleanup (strip robotic openers, delight killers,
                │   soften transactional, softEnforceDirectives)
                │
                ├─ Pre-send gates + Self-Critique + Satisfaction
                │     └─ al più UNA OpenAI Call B (refine)
                │
                ├─ runConversationReflection → learningSignals
                ├─ runMemoryPipeline (budget 4s) → memoryEvent
                └─ JSON { content, memoryEvent, learningSignals, session echoes }
                        │
                        ▼
[UI] revealReplyText → ASSISTANT_FINISH → MessageList
     + persist session echoes in localStorage
```

### Dettaglio client

1. L’utente digita in `InputBar`; `ChatContext` aggiunge il messaggio user e avvia la completion.
2. `buildSystemPrompt` in `src/lib/personality.ts` costruisce la costituzione client (base LAIfe + personality bias + length + emoji + custom instructions + diversity addon da `src/lib/diversity/`).
3. `requestChatCompletion` chiama solo `/api/chat` — **mai** OpenAI dal browser.
4. Alla risposta: salva learning signals / welcome / memory map / preference profile / pending automation; aggiorna UI; opzionale toast memoria.

### Dettaglio server

1. Se manca `OPENAI_API_KEY` → 500.
2. Se `runCognitiveEngine` fallisce → `cognitiveBlock = ''` (Writer procede comunque con system prompt).
3. Writer temperature `0.85`; refine `0.7`; max tokens 4096 (testo) / 700 (voce).
4. Nessuno streaming lato API (`stream: false`); il “typing” in UI è reveal client-side.

---

## 2. Tutti gli engine coinvolti (ordine di esecuzione)

Ordine reale nella pipeline primaria di `runCognitiveEngine` (pre-Writer), poi Coordinator, tools, Directive Authority, Writer, post-gate.

### A. Pre-Writer — Cognitive Engine (ordine sequenziale)

| # | Engine / modulo | File |
|---|-----------------|------|
| 1 | Conversation Reflection (prior) | `conversation-reflection.js` |
| 2 | Conversation Intelligence | `conversation-intelligence.js` |
| 3 | Conversation Memory Map | `conversation-memory-map.js` |
| 4 | Welcome Engine | `welcome-engine.js` |
| 5 | Voice Conversation Engine | `voice-conversation.js` |
| 6 | Conversation Continuation | `conversation-continuation.js` |
| 7 | Topic Leadership | `topic-leadership.js` |
| 8 | Social Conversation Engine | `social-conversation-engine.js` |
| 9 | Social Context Engine | `social-context-engine.js` |
| 10 | Conversation Intent | `conversation-intent.js` |
| 11 | Conversation Leadership | `conversation-leadership.js` |
| 12 | Language Awareness | `language-awareness.js` |
| 13 | Emotional state (locale) | dentro `cognitive-engine.js` |
| 14 | Conversation Opportunity | `conversation-opportunity-engine.js` |
| 15 | Conversation Planner | `conversation-planner-engine.js` |
| 16 | Conversation Opening | `conversation-opening-engine.js` |
| 17 | Opening Intelligence | `opening-intelligence-engine.js` |
| 18 | Small Talk Intelligence | `small-talk-intelligence-engine.js` |
| 19 | Think Before Speaking | `think-before-speaking.js` |
| 20 | Conversation Director | `conversation-director.js` |
| 21 | Thoughtfulness Engine | `thoughtfulness-engine.js` |
| 22 | Deep Thinking Engine | `deep-thinking-engine.js` |
| 23 | Deep Thinking Writer | `deep-thinking-writer.js` |
| 24 | Reasoning Expansion | `reasoning-expansion-engine.js` |
| 25 | Presence Engine | `presence-engine.js` |
| 26 | Response Mode Engine | `response-mode-engine.js` |
| 27 | Human Conversation Corpus | `human-conversation-corpus.js` |
| 28 | Wisdom Engine | `wisdom-engine.js` |
| 29 | Conversation Taste | `conversation-taste.js` |
| 30 | Conversation Memory Flow | `conversation-memory-flow.js` |
| 31 | Self Reflection Engine | `self-reflection-engine.js` |
| 32 | Human Impact Constitution | `human-impact-constitution.js` |
| 33 | Project Soul | `project-soul.js` |
| 34 | LAIfe Manifesto | `laife-manifesto.js` |
| 35 | Conversation Constitution | `conversation-constitution.js` |
| 36 | Conversation Ownership | `conversation-ownership.js` |
| 37 | Worth Reading Protocol | `worth-reading-protocol.js` |
| 38 | Conversation Quality Gate | `conversation-quality-gate.js` |
| 39 | `buildCognitivePlan` (+ Adaptive / Progressive Reasoning) | `adaptive-reasoning.js`, `progressive-reasoning.js` |
| 40 | Knowledge Level Estimator | `knowledge-level-estimator.js` |
| 41 | Information Value Estimator | `information-value-estimator.js` |
| 42 | Dynamic Behavior Model | `dynamic-behavior.js` |
| 43 | Expert Teacher | `expert-teacher.js` |
| 44 | Task Planner | `task-planner.js` |
| 45 | Next-Ask Prediction | `next-ask-prediction.js` |
| 46 | Curiosity Engine | `curiosity-engine.js` |
| 47 | Conversation Momentum | `conversation-momentum.js` |
| 48 | Intellectual Initiative | `intellectual-initiative.js` |
| 49 | Surprise Without Confusion | `surprise-without-confusion.js` |
| 50 | Plugin Architecture | `plugins/` |
| 51 | Life Intelligence (pre-tools) | `life-intelligence.js` |
| 52 | NL Automation Builder | `nl-automation-builder.js` |
| 53 | Universal Device Manager | `device-manager/` |
| 54 | Multi-Step Task Planner | `multi-step-task-planner.js` |
| 55 | Universal Action Engine | `action-engine/` |
| 56 | Intellectual Honesty (pre-tools) | `intellectual-honesty.js` |
| 57 | Adaptive Self-Awareness / Feedback | `adaptive-self-awareness.js` → `feedback-interpretation.js` |
| 58 | Warm Conversation | `warm-conversation.js` |
| 59 | Conversation Spark | `conversation-spark-engine.js` |
| 60 | Natural Dialogue | `natural-dialogue-engine.js` |
| 61 | Conversational Pragmatics | `conversational-pragmatics-engine.js` |
| 62 | Narrative Conversation | `narrative-conversation-engine.js` |
| 63 | Emotional Momentum | `emotional-momentum-engine.js` |
| 64 | Personality Consistency | `personality-consistency-engine.js` |
| 65 | Personal Voice | `personal-voice-engine.js` |
| 66 | Natural Conversation | `natural-conversation-engine.js` |
| 67 | Cognitive Authority | `cognitive-authority-engine.js` |
| 68 | Conversation Diversity | `conversation-diversity-engine.js` |
| 69 | Human Imperfection | `human-imperfection-engine.js` |
| 70 | Conversational Memory | `conversational-memory-engine.js` |
| 71 | Conversational Presence | `conversational-presence.js` |
| 72 | Question Economy | `question-economy.js` |
| 73 | Genuine Curiosity | `genuine-curiosity-engine.js` |
| 74 | Deep Listening | `deep-listening-engine.js` |
| 75 | Conversation Pace | `conversation-pace-engine.js` |
| 76 | Natural Topic Transition | `natural-topic-transition-engine.js` |
| 77 | Authentic Agreement | `authentic-agreement-engine.js` |
| 78 | Conversation Recovery | `conversation-recovery-engine.js` |
| 79 | Internal Monologue | `internal-monologue-engine.js` |
| 80 | Micro Observation | `micro-observation-engine.js` |
| 81 | Human Conversation Score | `human-conversation-score.js` |
| 82 | Emotional Resonance | `emotional-resonance-engine.js` |
| 83 | Wonder Engine | `wonder-engine.js` |
| 84 | Shared Discovery | `shared-discovery-engine.js` |
| 85 | Conversation Chemistry | `conversation-chemistry-engine.js` |
| 86 | Intelligent Silence | `intelligent-silence-engine.js` |
| 87 | Storytelling | `storytelling-engine.js` |
| 88 | Emotional Continuity | `emotional-continuity-engine.js` |
| 89 | Human Timing | `human-timing-engine.js` |
| 90 | Conversational Creativity | `conversational-creativity-engine.js` |
| 91 | Authentic Opinions | `authentic-opinions-engine.js` |
| 92 | Conversation Mindset | `conversation-mindset.js` |
| 93 | Conversation Delight | `conversation-delight.js` |

### B. Coordinamento

| # | Step | Note |
|---|------|------|
| 94 | `collectAdvisorSuggestions` | Mappa output → suggestion per slot |
| 95 | `runCognitiveCoordinator` | Rank, dedupe, conflict, fail-soft re-run |
| 95a | Insight Discovery | Solo dentro Coordinator |
| 95b | Human Conversation Simulator | Solo dentro Coordinator (emette intent, non testo) |

### C. Tools + Directive Authority

| # | Step | Note |
|---|------|------|
| 96 | `executeTools(['memory'])` poi altri tool | Via `orchestrator.js` |
| 97 | Re-run Life Intelligence + Intellectual Honesty | Con tool results |
| 98 | `runDirectiveAuthority` | WriterDirectives immutabili |
| 99 | Assemble `context` string | → `cognitiveBlock` |

### D. Writer + post-processing (`api/chat.ts`)

| # | Step |
|---|------|
| 100 | `buildInstructions` + OpenAI Call A |
| 101 | Soft strip / enforce |
| 102 | Satisfaction Estimator + Self-Critique |
| 103 | Decine di `draftViolates*` / companion briefs |
| 104 | Gate nominati (Delight, SelfReflection, Constitution, Quality, …) |
| 105 | Conversation Critic Engine | Alias di `conversation-critic.js` |
| 106 | `mergePreSendRefineBudget` → OpenAI Call B (opzionale, 1 sola) |
| 107 | Conversation Reflection (learning signals) |
| 108 | `runMemoryPipeline` (save durable) |

**Supporto dati (non “engine” runtime indipendenti):**  
`conversation-opening-sparks.js` (corpus ~10k righe usato da Opening / Opening Intelligence), `info-prioritization.js`, Trust package, Supabase client.

---

## 3. Punti in cui viene costruito o modificato il prompt

| # | Dove | Cosa succede |
|---|------|--------------|
| 1 | `src/lib/personality.ts` → `buildSystemPrompt` | Costituzione client: base LAIfe + nome + personality + Dynamic Behavior note + length + emoji + custom + **diversity addon** (`src/lib/diversity`) |
| 2 | `api/chat.ts` → `FALLBACK_SYSTEM_PROMPT` | Costituzione server enorme (~65 righe) usata **solo** se il client non manda `systemPrompt` |
| 3 | `api/chat.ts` → `buildInstructions(client, cognitiveBlock)` | Unisce personalization **oppure** fallback + append `cognitiveBlock`. Policy: se c’è personalization client, **non** si prepende il fallback |
| 4 | Ogni engine pre-Writer | Produce `context` / `writerBrief` / plan fields che finiscono in `result.context` |
| 5 | `cognitive-engine.js` → `formatWriterBlock` / assembly (~1800, ~4062) | Blocco piano coordinato + dozzine di context engine concatenati in un’unica stringa |
| 6 | `cognitive-coordinator.js` → `writerDirective` / `coordinatorBrief` / `formatCoordinatorForWriter` | Direttive filtrate (budget `MAX_DIRECTIVE_BRIEFS = 4`, `MAX_STYLE_BRIEFS = 2`) + brief narrativo |
| 7 | `directive-authority.js` | Serializza WriterDirectives obbligatorie (language, mode, social, lead, askQ, tone, length, initiative, …) |
| 8 | `orchestrator.js` → `buildOrchestratorContext` | Contesto tool (memoria/web/…) “invisibile” per il modello |
| 9 | OpenAI Call A | `instructions` = output di `buildInstructions`; `input` = storia messaggi |
| 10 | Soft transforms post-draft | Non cambiano il prompt; mutano il testo (`stripRoboticOpeners`, `stripDelightKillers`, `softenTransactionalOpening`, `softEnforceDirectives`) |
| 11 | Gate + `mergePreSendRefineBudget` (`self-critique.js`) | Costruiscono istruzioni di rifinitura (“UNA sola rifinitura”) + draft tra `---` |
| 12 | OpenAI Call B | Nuove `instructions` refine; `input` = singolo messaggio user di rifinitura (non la chat completa) |

**Osservazione architetturale:** il prompt Writer finale è tipicamente **molto lungo**: costituzione client (già densa) + `cognitiveBlock` che concatena decine di blocchi advisor, molti dei quali ripetono policy già presenti nel fallback / client. Il Coordinator limita i brief “direttivi” a 4, ma i **context block grezzi** degli engine vengono comunque concatenati in `context` quasi tutti.

---

## 4. Dove viene chiamata OpenAI

Solo in `api/chat.ts` (il client non chiama OpenAI).

| Call | Linee (approx) | Quando | Parametri rilevanti |
|------|----------------|--------|---------------------|
| **A — Writer** | ~1335–1347 | Dopo Cognitive Engine | `client.responses.create`, model `OPENAI_MODEL` o `gpt-4o-mini`, `temperature: 0.85`, `max_output_tokens: 700|4096`, `stream: false`, `instructions` + history |
| **B — Refine** | ~2177–2191 | Se `mergePreSendRefineBudget` → `shouldRefine` | Stesso model, `temperature: 0.7`, instructions di rifinitura, input mono-messaggio |

Altro:

- Import dinamico `openai` package (~357 e catch errori ~2293).
- Nessuna altra call embedding / chat.completions / tool-loop LLM nel path chat analizzato.
- Orchestrator tool selection è **euristica** (nessun round-trip modello per pianificare i tool).

---

## 5. Dove viene caricata la memoria

Ci sono **quattro livelli** distinti (più session echoes client):

### 5.1 Memoria durable (Supabase) — `brain-memory.js`

| Fase | Dove | Come |
|------|------|------|
| **Load / retrieve** | `cognitive-engine` → `executeTools(['memory'])` → `orchestrator` → `searchMemories(userMessage, { limit: 3 })` | Solo se `memory` è in `toolOrder` e `memoryEnabled !== false` |
| **Welcome** | `welcome-engine.js` può leggere brain-memory per returning user | Pre-Writer |
| **Save** | Post-risposta: `api/chat.ts` → `runMemoryWithBudget` → `runMemoryPipeline({ userMessage, assistantMessage })` | Timeout hard 4s; fail-soft |
| **CRUD UI** | `api/memories/index.ts`, `api/memories/[id].ts`, pagina `MemoryManage` | Gestione manuale |

### 5.2 Conversation Memory Map (sessione strutturata)

- Evoluta da `runConversationMemoryMap` in Cognitive Engine.
- Echo client ↔ server (`conversationMemoryMap` in request/response).
- Temi, domande aperte, progetti, goal, spiegazioni già date — **non** è Supabase.

### 5.3 Conversational Memory Engine (callback stessa chat)

- `conversational-memory-engine.js`: temi ricorrenti, battute, idee in sospeso.
- Contesto pre-Writer + gate post-draft.

### 5.4 Conversation Memory Flow (tessitura narrativa)

- `conversation-memory-flow.js`: come richiamare temi passati in modo naturale (no dump).

### 5.5 Altri “memory-like” store (non factual brain)

| Store | Persistenza | Uso |
|-------|-------------|-----|
| Learning signals | localStorage client | Calibrazione stile da reflection |
| Conversation Preference Profile | localStorage | Feedback stile (Adaptive Self-Awareness) |
| Welcome / voice / pending automation sessions | localStorage | Stato engine |
| TopicMemory client (`src/lib/diversity`) | in-memory React | Diversity addon nel system prompt client |
| Conversation Intelligence short-term | in-process plan | topic/goal della sessione server |

---

## 6. Quali engine sembrano duplicati

### Duplicato vero (alias)

| Pair | Verdetto |
|------|----------|
| `conversation-critic-engine.js` ↔ `conversation-critic.js` | **Alias**: il file `*-engine` re-esporta solo l’implementazione. Un solo comportamento, due entrypoint. |

### Quasi-duplicati / layering ridondante (stesso obiettivo, due+ moduli)

| Gruppo | Moduli | Perché sembrano duplicati |
|--------|--------|---------------------------|
| **Presence** | `presence-engine.js`, `conversational-presence.js`, parti di `natural-conversation-engine.js` / `natural-dialogue-engine.js` | Tutti spingono “sembra una persona presente, non un Q&A bot” |
| **Curiosity / questions** | `curiosity-engine.js`, `genuine-curiosity-engine.js`, `question-economy.js`, `wonder-engine.js`, `next-ask-prediction.js` | Controllano se/come chiedere o estendere con curiosità |
| **Openings / initiative** | `welcome-engine.js`, `conversation-opening-engine.js`, `opening-intelligence-engine.js`, `conversation-spark-engine.js`, `conversation-opportunity-engine.js`, corpus `conversation-opening-sparks.js` | Tutti governano il “primo movimento” / iniziativa |
| **Emotional stack** | `emotional-momentum-engine.js`, `emotional-continuity-engine.js`, `emotional-resonance-engine.js`, `conversation-chemistry-engine.js` | Traiettoria / atmosfera / match intensità / chimica — overlap forte |
| **Natural / social talk** | `social-conversation-engine.js`, `social-context-engine.js`, `natural-dialogue-engine.js`, `natural-conversation-engine.js`, `small-talk-intelligence-engine.js`, `warm-conversation.js` | Framing sociale + mossa dialogica + naturalità + small talk |
| **Thinking depth** | `think-before-speaking.js`, `thoughtfulness-engine.js`, `deep-thinking-engine.js`, `deep-thinking-writer.js`, `reasoning-expansion-engine.js`, `wisdom-engine.js` | Catena “pensa meglio prima di scrivere” molto lunga |
| **Identity / law / quality** | Constitution, Human Impact, Project Soul, Manifesto, Ownership, Worth Reading, Quality Gate, Cognitive Authority | Molte “costituzioni” immutabili con checklist sovrapposte |
| **Momentum** | `conversation-momentum.js` vs `emotional-momentum-engine.js` | Nomi simili; uno sul flusso conversazionale, uno sull’emozione — confusione nominale |
| **Diversity dualismo** | `src/lib/diversity/*` (client) vs `conversation-diversity-engine.js` (server) | Stesso goal anti-ripetizione, zero codice condiviso |
| **Self quality** | `self-critique.js` (post) vs `self-reflection-engine.js` (pre + gate) | Due checklist qualità con timing diverso |
| **Coordinator re-run** | Molti engine girano **due volte** (Engine primario + fail-soft Coordinator) | Duplicazione di esecuzione, non di file |

---

## 7. Quali engine sembrano inutilizzati

### Strict unused (zero import nel grafo chat)

**Nessun file engine è orfano**: tutti i moduli sotto `lib/server/` risultano raggiungibili da `api/chat.ts` → `cognitive-engine.js` / `cognitive-coordinator.js` (o package interni).

### “Inutilizzati in pratica” / low-impact / dead-path candidates

Questi **sono wired**, ma il loro impatto effettivo sul testo finale è dubbio o fragile:

| Candidato | Motivo |
|-----------|--------|
| Molti advisor context block | Entrano in `cognitiveBlock`, ma con `MAX_DIRECTIVE_BRIEFS = 4` i brief direttivi perdono la gara; restano come rumore contestuale |
| Fail-soft re-runs nel Coordinator | Girano solo se plan/brief mancanti; in happy path sono dead code path |
| `runHumanConversationScoreGate` import nel Coordinator | Importato ma **non referenziato**; il codice chiama invece `runHumanConversationScoreEngine` (naming mismatch → path fail-soft potenzialmente rotto) |
| Action / Device / Plugin / Multi-step / NL Automation | Attivi solo su intent specifici; nella chat tipica restano silenti |
| Voice Conversation Engine | Solo con `modality=voice` / `voice=true` |
| Client `generateLocalReply` / diversity engine offline | Path demo/offline; la chat live usa il server |
| Eval scripts in `scripts/eval-*.mjs` | Non nel path runtime utente |

**Conclusione:** non ci sono engine “morti” da file isolato; ci sono engine **sempre eseguiti ma spesso senza effetto osservabile** (soprattutto coda “texture” umana e tool domain-specific).

---

## 8. Quali engine hanno responsabilità sovrapposte

Raggruppamento per responsabilità condivisa:

### 8.1 Identità / legge conversazionale
`conversation-constitution`, `human-impact-constitution`, `project-soul`, `laife-manifesto`, `conversation-ownership`, `worth-reading-protocol`, `conversation-quality-gate`, `cognitive-authority-engine`  
→ Tutti definiscono “cosa è permesso / cosa è una buona risposta”. Priorità dichiarata alta; testo normativo ripetuto anche nel FALLBACK e nel client prompt.

### 8.2 Apertura e leadership del turno
`welcome-engine`, `topic-leadership`, `conversation-leadership`, `conversation-opening-engine`, `opening-intelligence-engine`, `conversation-spark-engine`, `conversation-opportunity-engine`, `small-talk-intelligence-engine`  
→ Decidono chi guida e come iniziare. Slot `opening` è esclusivo nel Coordinator, ma i brief e i context restano multipli.

### 8.3 Presenza e naturalità
`presence-engine`, `conversational-presence`, `natural-dialogue-engine`, `natural-conversation-engine`, `human-imperfection-engine`, `personal-voice-engine`, `human-conversation-corpus`, `warm-conversation`  
→ Stesso asse “non sembrare un bot”.

### 8.4 Domande e curiosità
`question-economy`, `curiosity-engine`, `genuine-curiosity-engine`, `wonder-engine`, `next-ask-prediction`, `shared-discovery-engine`  
→ Controllano coda interrogativa / estensione curiosità; policy spesso contraddittorie se non coordinate (chiedi vs non chiedere).

### 8.5 Profondità di ragionamento
`think-before-speaking`, `thoughtfulness-engine`, `deep-thinking-engine`, `deep-thinking-writer`, `reasoning-expansion-engine`, `wisdom-engine`, `insight-discovery`, `progressive-reasoning`, `adaptive-reasoning`  
→ Pianificano “come pensare”; il Writer vede molti brief che dicono cose simili.

### 8.6 Memoria conversazionale
`brain-memory` (durable), `conversation-memory-map`, `conversational-memory-engine`, `conversation-memory-flow`, più session Intelligence  
→ Quattro meccanismi di recall con contratti diversi ma surface prompt spesso analoga (“ricorda / non ripetere / tessi”).

### 8.7 Emozione e ritmo
`emotional-momentum`, `emotional-continuity`, `emotional-resonance`, `conversation-chemistry`, `conversation-pace`, `human-timing`, `intelligent-silence`, `conversation-momentum`  
→ Calibrano tono, velocità, silenzio.

### 8.8 Qualità post-generazione
`self-critique`, `satisfaction-estimator`, `self-reflection` gate, `conversation-delight` gate, `conversation-critic`, Quality / Constitution / Ownership / Worth Reading / Cognitive Authority gates  
→ Tutti possono chiedere la stessa unica rewrite.

### 8.9 Planning strutturale
`conversation-planner-engine`, `conversation-director`, `response-mode-engine`, `task-planner`, `multi-step-task-planner`, Coordinator structure slot  
→ Chi decide la struttura della risposta.

---

## 9. File più importanti dell’intera architettura

Ordinati per criticità strutturale (non per sole LOC):

| Priorità | File | Perché |
|----------|------|--------|
| 1 | `api/chat.ts` | Unico entrypoint chat server: Writer, refine, memoria, risposta client |
| 2 | `lib/server/cognitive-engine.js` | Orchestrazione pre-Writer di quasi tutti gli advisor + tools + context assembly |
| 3 | `lib/server/cognitive-coordinator.js` | Decision maker: rank/dedupe/conflict; il file più grande del repo |
| 4 | `lib/server/directive-authority.js` | Congela WriterDirectives obbligatorie (ultimo step soft prima del modello) |
| 5 | `lib/server/orchestrator.js` | Selezione/esecuzione tool (memory retrieve incluso) |
| 6 | `lib/server/brain-memory.js` | Persistenza e retrieval memoria fattuale |
| 7 | `src/context/ChatContext.tsx` | Ciclo vita messaggio UI + session echoes |
| 8 | `src/lib/personality.ts` | Costituzione system prompt client (spesso batte il FALLBACK) |
| 9 | `src/lib/chatApi.ts` | Contratto HTTP client↔API |
| 10 | `lib/server/self-critique.js` | Merge budget unica rifinitura pre-send |
| 11 | `lib/server/conversation-quality-gate.js` | Gate priorità massima sul draft |
| 12 | `lib/server/conversation-intent.js` + `conversation-leadership.js` | Intent + ownership del turno (molto ad alto baseValue) |
| 13 | `lib/server/social-context-engine.js` / `social-conversation-engine.js` | Routing SOCIAL vs INFORMATIONAL precoce |
| 14 | `lib/server/conversation-opening-sparks.js` | Corpus dati aperture (~10k LOC) |
| 15 | `lib/server/supabase.js` | Accesso DB memoria |

**Secondari ma rilevanti:** `warm-conversation.js`, `conversation-delight.js`, `worth-reading-protocol.js`, `conversation-constitution.js`, `cognitive-authority-engine.js`, `src/lib/diversity/engine.ts` (parallel client path).

---

## Sintesi architetturale

```
Client constitution ──┐
                      ├──► buildInstructions ──► OpenAI Writer ──► gates ──► (1 refine) ──► client
90+ advisor engines ──┤         ▲
   → Coordinator      │         │
   → Tools/memory     │         │
   → Directive Auth ──┘         │
                                └── cognitiveBlock (context concatenation)
```

**Caratteristiche strutturali rilevanti per una futura V2:**

1. **Pipeline a mesh**: qualità cercata tramite molti advisor soft, non tramite un unico policy module.
2. **Doppio (a volte triplo) encoding delle regole**: client prompt + FALLBACK + engine contexts + Coordinator briefs + Directive Authority + post-gates.
3. **Budget direttivo stretto (4)** vs **concatenazione context larga**: il Coordinator decide poco in superficie, ma il Writer riceve comunque moltissimo testo advisor.
4. **OpenAI = 1–2 call**; tutto il resto è euristica/deterministico Node.
5. **Memoria a strati** (durable + map + conversational + flow + client diversity) con confini dichiarati ma surface prompt sovrapposte.
6. **Nessun engine file-orphan**, ma forte densità di responsabilità sovrapposte (presence, curiosity, openings, constitutions, emotional).

---

*Fine analisi — nessuna modifica al codice runtime oltre a questo documento.*
