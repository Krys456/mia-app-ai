# Writer V2 — Public API Specification

**Documento:** `WRITER_API_SPEC.md`  
**Tipo:** progettazione interfaccia pubblica (nessuna implementazione)  
**Stato:** design-only  
**Allineamento:** `LAIFE_V2_ARCHITECTURE.md`, `V2_DATA_FLOW.md`, `PLANNER_SPEC.md`, `MIND_SPEC.md`  
**Vincolo:** zero dipendenze dalla V1; zero riferimenti a vendor LLM nel cervello (Perception / Mind / Planner).

Questo documento definisce il **contratto stabile** del Writer e del layer provider.  
Non contiene codice runtime.

---

## 1. Responsabilità del Writer

Il Writer è l’**unico modulo della V2 autorizzato a comunicare con un LLM**.

### 1.1 Cosa fa

| Responsabilità | Dettaglio |
|----------------|-----------|
| Consumare il piano | Riceve `PlannerPlan` (+ Decision, Foundation, messages, MemoryPack opzionale) |
| Assemblare la richiesta provider | Traduce il contratto V2 in un `ProviderRequest` neutro |
| Invocare il provider | Tramite `WriterProvider` intercambiabile |
| Gestire streaming / non-streaming | Stessa API pubblica; modalità scelta nella request |
| Normalizzare il risultato | `WriterResponse` unico, indipendente dal vendor |
| Esporre errori tipizzati | `WriterError` con retryability esplicita |
| Supportare rewrite del Reviewer | Stessa API con `mode: 'draft' \| 'rewrite'` |

### 1.2 Cosa NON fa

| Vietato | Motivo |
|---------|--------|
| Prendere decisioni di prodotto | Solo Mind |
| Analizzare / re-classificare il messaggio utente | Solo Perception |
| Modificare la memoria | Solo Memory Service |
| Cambiare il piano | Solo Planner; Writer esegue |
| Decidere tono / askQuestion / teach / comfort | Già in Mind Decision / writerBrief |
| Importare OpenAI/Gemini/… nel brain | I vendor vivono solo dietro `WriterProvider` |
| Auto-rewrite in loop | Solo Reviewer può chiedere **una** rewrite |
| Esporre internals all’utente | Response assembly è dell’orchestratore |

### 1.3 Posizione nel flusso

```
Planner → Writer → Reviewer → Memory → Response
           ▲
           └── unico punto LLM (Call A draft; Call B rewrite opzionale via stessa API)
```

### 1.4 Principio di isolamento provider

```
[Perception] [Mind] [Planner]     ← nessun import vendor
        │
        ▼
   [Writer Facade]                ← API pubblica V2
        │
        ▼
 [WriterProvider]                 ← adapter OpenAI | Gemini | Claude | …
```

Il resto della V2 conosce solo `WriterRequest` / `WriterResponse` / `WriterError`.

---

## 2. Contratto — tipi logici

Tipi logici (non TypeScript definitivo). Nomi stabili; campi minimi.

### 2.1 `WriterMessage`

Messaggio di conversazione già sanitizzato dall’orchestratore.

```
WriterMessage {
  role: "user" | "assistant" | "system"
  content: string
  // future (opzionale, default assente):
  parts?: WriterContentPart[]   // text | image_ref | audio_ref | ...
}
```

### 2.2 `WriterRequest`

Richiesta pubblica al Writer. Il Writer non richiede il testo “da reinterpretare”: richiede **piano + autorità + contesto**.

```
WriterRequest {
  // --- identity & authority ---
  personalityFoundation: string | IdentityBlock
  decision: MindDecision                 // autorità (read-only)
  plan: PlannerPlan                      // objective + conversationPlan + writerBrief + constraints

  // --- conversation ---
  messages: WriterMessage[]              // storia limitata; ultimo user già incluso

  // --- optional context packs (pre-filtered) ---
  preferences?: {
    displayName?: string
    replyLength?: "concise" | "balanced" | "detailed"
    useEmojis?: boolean
    customInstructions?: string
  }
  memoryPack?: MemoryPack | null
  toolFacts?: ToolFact[] | null

  // --- execution ---
  mode: "draft" | "rewrite"
  rewriteBrief?: string                  // obbligatorio se mode == "rewrite"
  stream?: boolean                       // default false
  abortSignal?: AbortSignalLike          // cancellazione cooperativa

  // --- generation hints (infra, non policy di prodotto) ---
  generation?: {
    maxOutputTokens?: number
    temperature?: number                 // hint; provider può clampare
    topP?: number
    seed?: number
    stopSequences?: string[]
    responseFormat?: "text" | "json" | "structured"  // vedi §6
    structuredSchema?: object            // solo se responseFormat == structured
  }

  // --- routing ---
  providerId?: string                    // opzionale; default da config orchestratore
  model?: string                         // opzionale; default del provider
  metadata?: {
    requestId?: string
    turnId?: string
    traceId?: string
  }
}
```

**Regole su `WriterRequest`:**

1. `plan.writerBrief` è la fonte operativa delle istruzioni.
2. `decision` viaggia per fedeltà/audit; il Writer non la rinegozia.
3. `mode: "rewrite"` non può cambiare `decision` o `plan` — solo applicare `rewriteBrief` al draft precedente (passato tipicamente come ultimo contesto o campo dedicato futuro `previousDraft`).
4. Nessun campo `userRawAnalysis` / `perception.reasoning` obbligatorio.

**Estensione minima consigliata per rewrite:**

```
WriterRequest.previousDraft?: string   // bozza da rifinire quando mode == "rewrite"
```

### 2.3 `WriterResponse`

```
WriterResponse {
  text: string                           // bozza (o rewrite) completa in modalità non-stream
  finishReason: FinishReason
  usage: Usage
  model: string                          // modello effettivo usato
  providerId: string
  requestId?: string
  warnings?: string[]                    // soft issues (truncation soft, clamp temperature, …)
}
```

In streaming, `text` può essere omesso sul chunk intermedio e valorizzato solo sull’evento finale (vedi §5), oppure l’orchestratore aggrega i chunk.

### 2.4 `FinishReason`

```
FinishReason =
  | "stop"              // completamento naturale
  | "length"            // hit max tokens
  | "cancelled"         // abort client/orchestratore
  | "content_filter"    // filtro safety provider
  | "error"             // terminato in errore (raro se si usa WriterError)
  | "unknown"
```

### 2.5 `Usage`

Metriche neutre, non legate a un vendor.

```
Usage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  thinkingTokens?: number       // reasoning models, se esposti
  cachedInputTokens?: number
  // vendorRaw vietato nel contratto pubblico; eventuali dettagli restano nel provider adapter
}
```

### 2.6 `StreamingChunk`

```
StreamingChunk {
  type: "delta" | "usage" | "error" | "done"
  textDelta?: string            // type == "delta"
  usage?: Usage                 // type == "usage" o "done"
  finishReason?: FinishReason   // type == "done"
  error?: WriterError           // type == "error"
  index?: number                // ordine monotono
}
```

### 2.7 `WriterError`

```
WriterError {
  code: WriterErrorCode
  message: string               // human/ops, non da mostrare grezzo all’utente finale
  retryable: boolean
  providerId?: string
  model?: string
  requestId?: string
  cause?: string                // dettaglio safe (niente secret)
  httpStatus?: number           // se applicabile
}
```

```
WriterErrorCode =
  | "timeout"
  | "rate_limit"
  | "provider_unavailable"
  | "auth_failed"
  | "malformed_response"
  | "empty_response"
  | "cancelled"
  | "invalid_request"
  | "content_filtered"
  | "unsupported_feature"
  | "internal"
```

### 2.8 `WriterProvider`

Contratto minimo implementato da ogni adapter vendor (vedi §3).

```
WriterProvider {
  id: string                    // "openai" | "gemini" | "claude" | "deepseek" | "local" | ...
  capabilities: ProviderCapabilities

  complete(req: ProviderRequest) -> Promise<ProviderResponse>
  stream(req: ProviderRequest) -> AsyncIterable<ProviderStreamEvent>
}
```

Il **Writer Facade** (API pubblica V2) converte `WriterRequest` → `ProviderRequest` e `ProviderResponse` → `WriterResponse`.

### 2.9 Tipi provider-neutri (interni al Writer layer, non al brain)

```
ProviderRequest {
  model: string
  instructions: string          // assemblate dal Writer Facade da Foundation + writerBrief
  input: ProviderMessage[]      // history (+ previousDraft se rewrite)
  stream: boolean
  maxOutputTokens?: number
  temperature?: number
  topP?: number
  seed?: number
  stopSequences?: string[]
  responseFormat?: "text" | "json" | "structured"
  structuredSchema?: object
  abortSignal?: AbortSignalLike
  metadata?: { requestId?, traceId? }
}

ProviderResponse {
  text: string
  finishReason: FinishReason
  usage: Usage
  model: string
  rawWarnings?: string[]
}

ProviderStreamEvent {
  type: "delta" | "usage" | "error" | "done"
  textDelta?: string
  usage?: Usage
  finishReason?: FinishReason
  error?: WriterError
}
```

**Importante:** `ProviderRequest` non è esposto a Perception/Mind/Planner. Solo Writer + adapters.

---

## 3. Provider Interface

### 3.1 Obiettivo

Una sola interfaccia `WriterProvider` per:

| Provider | `id` suggerito |
|----------|----------------|
| OpenAI | `openai` |
| Google Gemini | `gemini` |
| Anthropic Claude | `claude` |
| DeepSeek | `deepseek` |
| Local LLM (llama.cpp / Ollama / vLLM …) | `local` |
| Futuri | `custom:<name>` |

### 3.2 `ProviderCapabilities`

```
ProviderCapabilities {
  streaming: boolean
  jsonMode: boolean
  structuredOutput: boolean
  tools: boolean
  vision: boolean
  audioInput: boolean
  audioOutput: boolean
  reasoning: boolean
  maxContextTokens?: number
}
```

Il Writer Facade interroga `capabilities` prima di abilitare feature in `WriterRequest.generation`.  
Se una feature non è supportata → `WriterError.code = "unsupported_feature"` (non retryable).

### 3.3 Responsabilità adapter

Ogni adapter:

1. Mappa `ProviderRequest` → SDK/HTTP vendor.
2. Mappa risposta vendor → `ProviderResponse` / `ProviderStreamEvent`.
3. Traduce errori vendor → `WriterError` (+ `retryable`).
4. **Non** conosce Mind/Planner/Perception.
5. **Non** applica policy di prodotto (tono, askQuestion, …): riceve già `instructions` pronte.

### 3.4 Writer Facade (API pubblica usata dall’orchestratore)

```
Writer {
  write(request: WriterRequest) -> Promise<WriterResponse>
  writeStream(request: WriterRequest) -> AsyncIterable<StreamingChunk>
}
```

Pseudocomportamento:

```
write(req):
  validate(req)
  instructions = assembleInstructions(req)      // Foundation + formatWriterBrief(plan) + rewriteBrief?
  providerReq = toProviderRequest(req, instructions)
  provider = resolveProvider(req.providerId)
  raw = await provider.complete(providerReq)
  return toWriterResponse(raw, provider.id)
```

`assembleInstructions` è l’unico posto che concatena Identity + writerBrief.  
Non vive nel brain; vive nel Writer layer.

### 3.5 Risoluzione provider

```
Config {
  defaultProviderId: string
  defaultModelByProvider: map
  providers: map<id, WriterProvider>
}
```

L’orchestratore (o il Facade) sceglie il provider; Mind/Planner non vedono `providerId`.

### 3.6 Regola anti-leak

| Layer | Può nominare OpenAI/Gemini/… ? |
|-------|--------------------------------|
| Perception / Mind / Planner | **No** |
| Reviewer (policy) | **No** |
| Writer Facade | Solo come `providerId` opaco |
| WriterProvider adapters | **Sì** (implementazione) |
| `api/chat.ts` V1 | Fuori scope V2; non va esteso per questo design |

---

## 4. Error Model

### 4.1 Tassonomia

| Condizione | `WriterErrorCode` | `retryable` | Note |
|------------|-------------------|-------------|------|
| Timeout rete/provider | `timeout` | **true** | Retry con backoff |
| Rate limit / quota | `rate_limit` | **true** | Rispettare hint retry-after se mappabile in `cause` |
| Provider down / 5xx | `provider_unavailable` | **true** | Eventuale failover provider (orchestratore) |
| Auth / API key | `auth_failed` | **false** | Non ritentare alla cieca |
| Request invalida (schema) | `invalid_request` | **false** | Bug orchestratore/Writer |
| Risposta non parsabile | `malformed_response` | **true** (1 volta) | Poi escalate |
| Testo vuoto | `empty_response` | **true** (1 volta) | Poi fail |
| AbortSignal | `cancelled` | **false** | Non retry |
| Safety filter | `content_filtered` | **false** | Policy; non mascherare con retry |
| Feature non supportata | `unsupported_feature` | **false** | Cambiare provider/model |
| Errore interno adapter | `internal` | **false** (default) | Log + fail-soft orchestratore |

### 4.2 Retryable vs Non-retryable

```
retryable == true  → orchestratore PUÒ ritentare (max N, backoff, stesso o altro provider)
retryable == false → orchestratore NON ritenta lo stesso call; può solo fallire o degradare UX
```

**Il Writer non implementa retry policy di prodotto** (quanti tentativi, quale failover): espone solo `retryable`.  
La policy di retry è dell’orchestratore.

### 4.3 Propagazione

- Modalità `write()`: reject Promise con `WriterError` (o Result type `Ok|Err` — scelta implementativa futura; semanticamente equivalente).
- Modalità stream: emettere `{ type: "error", error }` e chiudere l’iterable; non continuare delta dopo error.

### 4.4 Cosa non fare sugli errori

- Non inventare una bozza di fallback “gentile” dentro il Writer (nasconderebbe il guasto).
- Non richiamare Mind/Planner.
- Non scrivere in Memory.

---

## 5. Streaming

### 5.1 Contratto

```
writeStream(request: WriterRequest) -> AsyncIterable<StreamingChunk>
```

Requisiti:

- `request.stream` è trattato come `true`.
- I chunk `delta` portano solo `textDelta` incrementale (UTF-8 safe; niente partial surrogate esposti se evitabile).
- L’ordine è monotono (`index` crescente consigliato).
- Nessun chunk `delta` dopo `done` o `error`.

### 5.2 Sequenza tipica (successo)

```
delta { textDelta: "Ciao" }
delta { textDelta: "!" }
usage { usage: {...} }          // opzionale mid-stream
done  { finishReason: "stop", usage: {...} }
```

### 5.3 Come terminare lo stream

| Caso | Evento finale |
|------|----------------|
| Completato | `type: "done"` + `finishReason` |
| Cancellato | `type: "error"` con `code: "cancelled"` **oppure** `done` + `finishReason: "cancelled"` (sceglierne **uno** in implementazione e mantenerlo stabile; raccomandazione: **error cancelled** per uniformità col modello errori) |
| Errore provider | `type: "error"` + `WriterError` |
| Length hit | `type: "done"` + `finishReason: "length"` |

**Raccomandazione stabile:**  
- Successo (anche truncato per length/filter esplicito) → `done`  
- Fallimento / cancel → `error`  
Poi l’iterable termina (return).

### 5.4 Aggregazione

L’orchestratore (o un helper `collectStream`) concatena i `textDelta` in `text` finale per il Reviewer.

Il Reviewer **non** deve consumare lo stream direttamente nel design ideale: riceve testo completo (draft aggregato).  
Streaming è un dettaglio di trasporto verso UI; la qualità resta sul testo finale.

### 5.5 Propagazione errori in stream

1. Adapter cattura eccezione vendor.
2. Mappa a `WriterError`.
3. Emette `StreamingChunk{ type:"error", error }`.
4. Chiude lo stream.
5. Nessun retry automatico dentro lo stream mid-flight (retry = nuova `writeStream` dall’orchestratore).

### 5.6 UI

Il client può mostrare i delta; la Response HTTP finale della pipeline V2 resta comunque il testo post-Reviewer (coerente con `V2_DATA_FLOW.md`).  
Eventuale “stream fino al Reviewer” è un’ottimizzazione futura e non cambia i contratti brain.

---

## 6. Estensioni future

Tutte le estensioni passano da `ProviderCapabilities` + campi opzionali su `WriterRequest.generation` / `WriterMessage.parts`.  
**Default V2 core:** testo in / testo out.

| Feature | Come entra nel contratto | Impatto brain |
|---------|--------------------------|---------------|
| **JSON Mode** | `responseFormat: "json"` | Nessuno; solo Writer/Reviewer se serve parse |
| **Structured Output** | `responseFormat: "structured"` + `structuredSchema` | Nessuno sul Mind; schema ownership = caller |
| **Tool Calling / Function Calling** | Estensione futura `tools?: ToolSpec[]` su request + eventi `tool_call` nello stream | Mind dovrà decidere *se* autorizzare tool; Writer esegue solo |
| **Vision** | `WriterContentPart{ type:"image_ref", uri|blobRef }` | Perception multimodale futura; Writer non “vede” policy |
| **Audio** | `audio_ref` in/out capabilities | Voice mode; Writer depth già deciso da Mind |
| **Reasoning Models** | `generation.reasoningEffort?` + `Usage.thinkingTokens` | Mind non espone chain-of-thought all’utente |
| **Function Calling** | Alias/sottoinsieme di Tool Calling sopra | Stesso confine: Decision ≠ esecuzione |

### 6.1 Regola di estensione

1. Aggiungere campi **opzionali** con default backward-compatible.
2. Aggiornare `ProviderCapabilities`.
3. Se la feature implica una scelta di prodotto (“posso usare un tool?”), la scelta nasce in **Mind**, non nel Writer.
4. Nessuna estensione può forzare import vendor nel brain.

### 6.2 Fuori scope della prima implementazione Writer

- Multi-agent fan-out
- Provider ensemble voting
- Prompt cache policy avanzata (può arrivare dopo come hint `metadata`)

---

## 7. Design Principles

1. **Massima semplicità** — due metodi pubblici (`write`, `writeStream`), pochi tipi.
2. **Contratti piccoli** — niente dump di Perception reasoning; niente cognitiveBlock V1.
3. **Provider intercambiabili** — un `WriterProvider`, tanti adapter.
4. **Zero dipendenze dalla V1** — niente import da `cognitive-engine`, `api/chat.ts`, mesh advisor.
5. **Zero riferimenti vendor nel cervello** — Perception/Mind/Planner ignari di OpenAI/Gemini/Claude.
6. **Writer = esecuzione** — non decide tono, non cambia piano, non tocca memoria.
7. **Errori espliciti** — `retryable` chiaro; niente silent success su risposta vuota.
8. **Streaming come trasporto** — la qualità conversazionale si valuta sul testo aggregato.
9. **Istruzioni assemblate una volta** — Foundation + writerBrief (+ rewriteBrief) nel Facade.
10. **Fail visible** — meglio `WriterError` che una risposta inventata dall’adapter.

---

## 8. Assemblaggio istruzioni (contratto semantico)

Il Writer Facade costruisce `ProviderRequest.instructions` così:

```
[Personality Foundation]
+ [User preferences non confliggenti]
+ [formatWriterBrief(plan)  OR  plan.writerBrief serializzato]
+ [constraints come checklist hard]
+ [se mode == rewrite: rewriteBrief + previousDraft rules]
+ [regola: scrivi solo la risposta finale; non citare moduli]
```

Non include:

- `perception.reasoning`
- advisor V1
- Decision Record in forma narrativa ridondante (i flag sono già nel brief; Decision resta disponibile come struttura se serve audit, non come saggio)

---

## 9. Compatibility matrix (target)

| Capability | OpenAI | Gemini | Claude | DeepSeek | Local |
|------------|--------|--------|--------|----------|-------|
| complete | ✓ | ✓ | ✓ | ✓ | ✓ |
| stream | ✓ | ✓ | ✓ | ✓ | ✓/△ |
| jsonMode | ✓ | ✓ | △ | ✓ | △ |
| structuredOutput | ✓/△ | ✓/△ | △ | △ | △ |
| tools | ✓ | ✓ | ✓ | ✓ | △ |
| vision | ✓ | ✓ | ✓ | △ | △ |
| audio | △ | △ | △ | ✗ | △ |
| reasoning | ✓/△ | △ | ✓/△ | ✓/△ | △ |

✓ supportato · △ parziale/varia per modello · ✗ non previsto  
La matrice guida `capabilities`, non il brain.

---

## 10. Non-goals di questo documento

- Implementare `writer.js` / adapter
- Modificare `api/chat.ts` o la mesh V1
- Definire Prompt exact wording finale
- Scegliere il modello di default di produzione

---

## 11. Acceptance criteria (quando si implementerà)

L’API Writer V2 è conforme se:

1. L’orchestratore può sostituire `openai` con `local` cambiando solo config/provider registry.
2. Perception/Mind/Planner non importano SDK LLM.
3. `write` e `writeStream` condividono validazione e assemblaggio istruzioni.
4. Errori espongono `code` + `retryable`.
5. Una rewrite del Reviewer riusa la stessa API (`mode: "rewrite"`).
6. Nessun campo obbligatorio lega il contratto a un vendor.

---

*Fine specifica API — nessuna implementazione in questo documento.*
