# Mind V2 — Specifica modulo

**Modulo:** `lib/server/v2/brain/mind.js`  
**Test:** `lib/server/v2/brain/mind.test.mjs`  
**Stato:** implementato, **non collegato** alla pipeline chat  
**Fonte:** `LAIFE_V2_ARCHITECTURE.md` §4 (Director) — in V2 il nome operativo del decision-maker è **Mind**  
**Upstream:** Perception Snapshot (`PERCEPTION_SPEC.md`)

---

## 1. Ruolo

Mind è l’**unica autorità decisionale** del turno.

Risponde solo a:

> *Cosa facciamo in questo turno?*

Non osserva il testo grezzo (lo fa Perception).  
Non scrive la risposta (lo fa Writer).  
Non carica/salva memoria (lo fa Memory Service).  
Non pianifica i beat frasali (lo fa Planner).

Produce un **Mind Decision** chiuso, tipizzato, consumabile da Memory / Planner / Writer / Reviewer.

---

## 2. Confini (hard rules)

| Consentito | Vietato |
|------------|---------|
| Decidere need/goal/strategy del turno | Chiamare OpenAI / rete / DB |
| Impostare flag booleani di politica | Generare testo utente o prompt |
| Usare Perception + memory/session come input | Modificare ConversationMemory / SessionState |
| Calcolare confidenza decisionale | Importare moduli V1 |
| Fail-soft su input malformati | Rieseguire Perception |
| | Scegliere lessico, metafore, frasi |

---

## 3. API

```js
import { think, MIND_VERSION } from './mind.js'

const decision = think({
  perception,           // PerceptionResult / Perception Snapshot
  conversationMemory,   // ConversationMemory (read-only view)
  sessionState,         // SessionState (read-only view)
})
```

### Garanzie

- Funzione **pura**: stessi input → stesso output.
- Nessun I/O, nessun side effect, nessuna mutazione degli argomenti.
- Mai throw per input malformati: normalizza e decide in modo conservativo.

---

## 4. Input

### 4.1 `perception` (PerceptionResult)

Allineato allo snapshot Perception:

| Campo | Uso in Mind |
|-------|-------------|
| `intent` | Driver principale di strategy/goal |
| `socialIntent` | Bias sociali (greeting, thanks, farewell) |
| `emotionalState` | `emotionalTone`, comfort/challenge |
| `conversationStage` | Continue vs open vs close vs repair |
| `knowledgeLevel` | Depth + teach |
| `userNeed` | Ancora per `need` decisionale |
| `confidence` | Contribuisce a `confidence` Mind |
| `language` | Contesto (non emesso di nuovo qui) |
| `reasoning` | Ignorato per le decisioni (solo osservazione) |

### 4.2 `conversationMemory` (ConversationMemory)

Vista read-only della chat corrente:

```ts
{
  topics?: string[],           // temi già toccati
  openQuestions?: string[],    // domande ancora aperte
  currentTopic?: string | null,
  explained?: string[],        // cose già spiegate
  turnCount?: number,
  lastUserStance?: 'short_ack' | 'engaged' | 'resistant' | 'delegating' | null,
  unresolvedGoal?: string | null
}
```

Usata per: `shouldContinueTopic`, `shouldUseMemory`, anti-ripetizione teach, initiative.

### 4.3 `sessionState` (SessionState)

Vista read-only di sessione/temporanea:

```ts
{
  memoryEnabled?: boolean,     // default true
  isVoice?: boolean,
  questionStreak?: number,     // domande fatte di fila (economy)
  initiativeStreak?: number,
  userAskedToLead?: boolean,   // "scegli tu"
  closingSignal?: boolean,
  preferenceBias?: 'concise' | 'balanced' | 'detailed' | null
}
```

---

## 5. Output — Mind Decision

```ts
{
  need:
    | 'connection'
    | 'information'
    | 'explanation'
    | 'help_unblocking'
    | 'emotional_care'
    | 'celebration_share'
    | 'direction'
    | 'continuation'
    | 'feedback_ack'
    | 'closure'
    | 'unclear',
  goal: string,                 // goal operativo corto (machine-oriented, non prosa utente)
  strategy:
    | 'connect'
    | 'continue'
    | 'answer'
    | 'explain'
    | 'guide'
    | 'support'
    | 'celebrate'
    | 'recover'
    | 'close'
    | 'entertain'
    | 'explore',
  initiative:
    | 'none'
    | 'one_insight'
    | 'one_spark'
    | 'one_direction',
  emotionalTone:
    | 'neutral'
    | 'warm'
    | 'calm'
    | 'playful'
    | 'serious'
    | 'supportive'
    | 'encouraging'
    | 'curious',
  responseDepth:
    | 'minimal'
    | 'light'
    | 'balanced'
    | 'deep',
  shouldUseMemory: boolean,
  shouldContinueTopic: boolean,
  shouldAskQuestion: boolean,
  shouldTeach: boolean,
  shouldComfort: boolean,
  shouldChallenge: boolean,
  confidence: number            // 0..1
}
```

### Semantica

| Campo | Significato |
|-------|-------------|
| `need` | Bisogno a cui rispondere **scelto** (può raffinare `userNeed` percepito) |
| `goal` | Obiettivo del turno in una riga, per Planner/Writer |
| `strategy` | Famiglia di mossa conversazionale |
| `initiative` | Se/come LAIfe porta qualcosa di nuovo (max uno) |
| `emotionalTone` | Tono deciso per il turno |
| `responseDepth` | Quanto andare in profondità |
| `shouldUseMemory` | Autorizzazione di policy: Memory **può** caricare pack pertinente |
| `shouldContinueTopic` | Restare sul filo corrente |
| `shouldAskQuestion` | Esattamente se una domanda è ammessa |
| `shouldTeach` | Modalità insegnamento progressivo |
| `shouldComfort` | Priorità cura emotiva |
| `shouldChallenge` | Spinta rispettosa / reframing (mai in distress acuto) |
| `confidence` | Affidabilità della decisione |

---

## 6. Policy decisionali (riassunto)

1. **Distress / emotional_support** → `support` + comfort; no challenge; no question salvo chiarimento bloccante raro (default: nessuna domanda).
2. **Greeting / opening social** → `connect`; initiative `one_spark` o `one_direction` se non c’è topic; question economy stretta (spesso `false`).
3. **Continuation / short ack + history** → `continue`; continue topic; initiative spesso `none` o `one_insight`.
4. **Learning** → `explain` + `shouldTeach`; depth da knowledgeLevel + preferenceBias.
5. **Problem solving** → `guide` / `answer`; memory se topic/project in map; challenge soft solo se utente engaged e non frustrato-arrabbiato.
6. **Feedback on assistant / repair** → `recover`; no teach dump; no memory force; no challenge.
7. **Farewell / closing** → `close`; no question; no initiative.
8. **Delegating (“scegli tu”) / boredom** → initiative `one_direction`; continue o explore.
9. **Question streak ≥ 2** → `shouldAskQuestion = false` (economy).
10. **Memory** → solo se `memoryEnabled !== false` e c’è utilità (topic/project/life/personal continuity), mai “per abitudine”.
11. **Al più una iniziativa** non banale: insight **oppure** spark **oppure** direction.
12. **Challenge** incompatibile con comfort forte: se `shouldComfort`, allora `shouldChallenge = false`.

`goal` è sempre una stringa corta tipo `continue_topic_with_one_insight`, mai una frase destinata all’utente.

---

## 7. Relazione con la pipeline V2

```
Perception → Mind → Memory → Planner → Writer → Reviewer
               ▲
               └── questa consegna (isolata)
```

Mind corrisponde al **Director** della architecture spec.  
Non è ancora importato da `api/chat.ts` né dalla mesh V1.

---

## 8. Test

```bash
node lib/server/v2/brain/mind.test.mjs
```

Almeno 20 scenari realistici (greeting, support, learning, continuation, closing, feedback, boredom, memory policy, question economy, challenge vs comfort, …).

---

## 9. Non-goals

- Integrazione pipeline
- Generazione testo / prompt packaging
- Retrieve/save memoria
- Chiamate LLM
- Dipendenze V1

---

*Mind decide una volta. Tutto il resto esegue.*
