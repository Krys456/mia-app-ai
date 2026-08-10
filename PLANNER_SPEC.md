# Planner V2 — Specifica modulo

**Modulo:** `lib/server/v2/brain/planner.js`  
**Test:** `lib/server/v2/brain/planner.test.mjs`  
**Stato:** implementato, **non collegato** alla pipeline chat  
**Upstream:** Mind Decision (`MIND_SPEC.md`) + Perception Snapshot (`PERCEPTION_SPEC.md`)  
**Downstream previsto:** Writer / Reviewer

---

## 1. Ruolo

Il Planner **traduce** una Mind Decision (e il contesto osservativo già classificato) in un **piano concreto** eseguibile dal Writer.

Risponde solo a:

> *Come organizziamo la risposta di questo turno, dato che Mind ha già deciso?*

Non risponde a:

> *Cosa sta succedendo?* (Perception)  
> *Cosa dovremmo fare?* (Mind)  
> *Quali parole usiamo?* (Writer)

---

## 2. Confini (hard rules)

| Consentito | Vietato |
|------------|---------|
| Derivare struttura (apertura / sviluppo / chiusura) dalla decision | Prendere **nuove** decisioni (ask/teach/comfort/…) |
| Compilare `writerBrief` fedele ai flag Mind | Analizzare/re-interpretare il messaggio utente grezzo |
| Esporre `constraints` come lista hard | Chiamare OpenAI / rete / DB |
| Usare Perception solo come **contesto già osservato** (lingua, knowledgeLevel, stage) | Generare la risposta finale all’utente |
| Fail-soft su input malformati | Modificare memoria |
| | Importare moduli V1 |
| | Invertire o “migliorare” la strategy di Mind |

**Regola d’oro:** se Perception e Decision sembrano in tensione, **vince Decision**. Perception non riapre il caso.

---

## 3. API

```js
import { plan, isPlannerPlan, PLANNER_VERSION } from './planner.js'

const result = plan({
  perception, // PerceptionResult (già calcolato)
  decision,   // MindDecision (già calcolato)
})
```

### Garanzie

- Funzione **pura**: stessi input → stesso output.
- Nessun I/O, nessun side effect, nessuna mutazione degli argomenti.
- Nessuna dipendenza runtime da `perception.js` / `mind.js` (contratto strutturale, non import).

---

## 4. Input

```ts
{
  perception: PerceptionResult, // shape da PERCEPTION_SPEC
  decision: MindDecision        // shape da MIND_SPEC
}
```

Il Planner **non** riceve il testo utente.  
Il Planner **non** riceve ConversationMemory / SessionState (sono già stati consumati da Mind).  
Eventuale Memory Pack futuro potrà essere aggiunto in un campo opzionale senza rompere questo contratto base.

---

## 5. Output — Planner Plan

```ts
{
  objective: string,
  conversationPlan: {
    opening: {
      role: 'opening',
      kind: string,       // es. warm_presence | continue_thread | direct_answer | ...
      purpose: string     // descrizione strutturale, non testo da dire
    },
    development: Array<{
      role: 'development',
      kind: string,
      purpose: string
    }>,                   // 1..4 beat
    closing: {
      role: 'closing',
      kind: string,       // es. none_stop | one_question | one_insight | soft_presence | ...
      purpose: string
    },
    lengthBand: 'minimal' | 'light' | 'balanced' | 'deep',
    beatCount: number
  },
  writerBrief: {
    language: string,
    tone: string,
    depth: string,
    strategy: string,
    need: string,
    moveSummary: string,
    must: string[],         // istruzioni positive ordinate
    mustNot: string[],      // divieti hard
    coda: 'none' | 'question' | 'insight' | 'spark' | 'direction',
    memoryHint: 'omit' | 'weave_soft' | 'allowed',
    teaching: boolean,
    comfort: boolean,
    challenge: boolean,
    continueTopic: boolean
  },
  constraints: string[],    // lista piatta hard, dedotta SOLO dalla decision
  confidence: number        // 0..1
}
```

### Semantica

| Campo | Significato |
|-------|-------------|
| `objective` | Obiettivo operativo del turno (slug/frase corta machine-oriented) |
| `conversationPlan` | Struttura della risposta (ruoli/kind/purpose), **mai** prosa utente |
| `writerBrief` | Pacchetto istruzioni completo: il Writer non deve reinterpretare Mind/Perception |
| `constraints` | Vincoli hard serializzati (es. `no_question`, `comfort_first`) |
| `confidence` | Affidabilità del packing (funzione di decision.confidence + completezza input) |

---

## 6. Mapping Decision → Plan (riassunto)

| Decision | Effetto sul piano |
|----------|-------------------|
| `strategy` | Sceglie template di fasi (connect/continue/explain/…) |
| `responseDepth` | `lengthBand` + numero beat sviluppo |
| `shouldAskQuestion` | closing kind `one_question` **oppure** divieto domanda |
| `initiative` | closing/coda insight\|spark\|direction se non c’è question |
| `shouldTeach` | beat teaching + brief.teaching |
| `shouldComfort` | opening comfort + must/mustNot |
| `shouldChallenge` | beat reframing (solo se comfort false, già garantito da Mind) |
| `shouldContinueTopic` | opening/dev continue_thread |
| `shouldUseMemory` | `memoryHint` allowed/weave_soft vs omit |
| `emotionalTone` | `writerBrief.tone` |
| Perception.language / knowledgeLevel | etichette di contesto nel brief (non nuove decisioni) |

Il Planner **non** può accendere `shouldAskQuestion` se Mind l’ha lasciato `false`.

---

## 7. Relazione pipeline V2

```
Perception → Mind → Memory → Planner → Writer → Reviewer
                              ▲
                              └── questa consegna (isolata)
```

Nota: in architecture la Memory precede il Planner; in questa consegna l’input è solo `{ perception, decision }` come richiesto. `shouldUseMemory` diventa un hint per il Writer/Memory layer futuro senza eseguire retrieve.

---

## 8. Test

```bash
node lib/server/v2/brain/planner.test.mjs
```

Almeno 30 scenari: fedeltà ai flag Mind, strutture per strategy, coda question vs initiative, comfort, teach, close, purezza, fail-soft, no V1 fields.

---

## 9. Non-goals

- Integrazione `api/chat.ts` / mesh V1
- Chiamate LLM
- Generazione risposta utente
- Re-scoring intent / nuove policy decisionali
- Persistenza memoria

---

*Planner esegue la decisione. Non la ridefinisce.*
