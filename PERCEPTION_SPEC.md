# Perception V2 — Specifica modulo

**Modulo:** `lib/server/v2/brain/perception.js`  
**Stato:** implementato, **non collegato** alla pipeline chat  
**Fonte:** `LAIFE_V2_ARCHITECTURE.md` §2.2.1, §3  
**Principio:** Perception **osserva**. Non decide. Non scrive. Non chiama modelli.

---

## 1. Ruolo

Perception trasforma il turno corrente in uno **snapshot strutturato** riusabile dal Director.

Risponde solo a:

> *Cosa sta succedendo in questo messaggio e nel contesto recente?*

Non risponde a:

> *Cosa dovremmo fare / dire / chiedere?*

---

## 2. Confini (hard rules)

| Consentito | Vietato |
|------------|---------|
| Classificare segnali dal testo | Prendere decisioni di strategia |
| Stimare confidenza | Scrivere testo utente o bozze |
| Esporre `reasoning` interno strutturato | Generare o mutare prompt |
| Usare memoria pertinente come **contesto osservativo** | Decidere se caricare/salvare memoria |
| Fallire in modo soft con snapshot neutro | Chiamare OpenAI / rete / DB |
| | Importare moduli V1 della pipeline chat |
| | Suggerire aperture, domande, tool, length |

---

## 3. API

```js
import { perceive, PERCEPTION_VERSION } from './perception.js'

const snapshot = perceive({
  userMessage: string,          // obbligatorio (ultimo messaggio utente)
  messages?: Array<{            // storia recente (user/assistant)
    role: 'user' | 'assistant' | 'system',
    content: string
  }>,
  memory?: Array<{              // memoria pertinente opzionale (già filtrata a monte)
    text?: string,
    content?: string,
    type?: string
  }> | null
})
```

### Garanzie

- Funzione **pura**: stessi input → stesso output; nessun I/O.
- Mai throw verso il caller per input malformati: normalizza e produce snapshot sicuro.
- Nessun side effect.

---

## 4. Output — Perception Snapshot

```ts
{
  language: 'it' | 'en' | 'es' | 'fr' | 'de' | 'pt' | 'unknown',
  intent:
    | 'greeting'
    | 'small_talk'
    | 'companionship'
    | 'curiosity'
    | 'learning'
    | 'problem_solving'
    | 'celebration'
    | 'emotional_support'
    | 'reflection'
    | 'exploration'
    | 'advice'
    | 'news'
    | 'life_update'
    | 'project_update'
    | 'entertainment'
    | 'silence'
    | 'boredom'
    | 'continuation'
    | 'feedback_on_assistant'
    | 'meta_language'
    | 'unclear',
  socialIntent:
    | 'none'
    | 'greeting'
    | 'farewell'
    | 'thanks'
    | 'how_are_you'
    | 'compliment'
    | 'agreement'
    | 'laughter'
    | 'teasing'
    | 'presence',
  emotionalState:
    | 'neutral'
    | 'calm'
    | 'curious'
    | 'excited'
    | 'playful'
    | 'happy'
    | 'frustrated'
    | 'angry'
    | 'anxious'
    | 'tired'
    | 'confused'
    | 'urgent',
  conversationStage:
    | 'opening'
    | 'early'
    | 'developing'
    | 'deepening'
    | 'closing'
    | 'repair',
  knowledgeLevel:
    | 'unknown'
    | 'beginner'
    | 'intermediate'
    | 'advanced'
    | 'expert',
  userNeed:
    | 'connection'
    | 'information'
    | 'explanation'
    | 'help_unblocking'
    | 'emotional_care'
    | 'celebration_share'
    | 'direction'
    | 'continuation'
    | 'feedback_ack'
    | 'unclear',
  confidence: number, // 0..1
  reasoning: {
    signals: string[],     // indizi osservati (corti, machine-oriented)
    alternatives: Array<{  // intent candidati scartati / secondari
      intent: string,
      score: number
    }>,
    notes: string[]        // osservazioni neutre, mai istruzioni al Writer
  }
}
```

### Semantica dei campi

| Campo | Significato osservativo |
|-------|-------------------------|
| `language` | Lingua dominante dell’ultimo messaggio utente |
| `intent` | Perché l’utente ha scritto (intento primario) |
| `socialIntent` | Layer sociale del turno (`none` se assente) |
| `emotionalState` | Stato emotivo stimato dal testo/contesto |
| `conversationStage` | Dove siamo nel viaggio della chat |
| `knowledgeLevel` | Livello sul topic se evidenziato; altrimenti `unknown` |
| `userNeed` | Bisogno umano percepito (non la strategia di risposta) |
| `confidence` | Affidabilità complessiva dello snapshot |
| `reasoning` | Traccia ispezionabile; non è un prompt |

---

## 5. Input dettagliato

### `userMessage`

Testo dell’ultimo turno utente. Se vuoto/assente → snapshot `unclear` / `silence` con bassa confidenza.

### `messages`

Storia recente. Perception usa solo segnali strutturali:

- presenza/assenza di turni precedenti
- ultimo assistant message (continuità / “continua”)
- densità della conversazione (stage)

Non riscrive né riassume la storia in prosa destinata al modello.

### `memory` (opzionale)

Item già selezionati a monte (in V2 dal Memory Service / Director).  
Usati solo per:

- rafforzare segnali di topic continuity
- eventuali hint di knowledge/progetto se espliciti nel testo memoria

**Non** decide retrieve/save. Se assente, lo snapshot resta valido.

---

## 6. Algoritmo (alto livello)

1. Normalizza input (trim, limiti lunghezza, filtra ruoli).
2. Rileva `language` (script + lexicon cues IT/EN/…).
3. Estrae segnali lessicali/strutturali (greeting, distress, question shape, continuation, feedback, meta-language, …).
4. Classifica `socialIntent` e `intent` con scoring euristico; tiene `alternatives`.
5. Stima `emotionalState` e `userNeed` come lettura del bisogno, non come azione.
6. Stima `conversationStage` da lunghezza storia + segnali di chiusura/riparazione.
7. Stima `knowledgeLevel` solo con evidenze testuali chiare; default `unknown`.
8. Calcola `confidence` da margine tra candidati + chiarezza segnali.
9. Compila `reasoning` con signals/alternatives/notes.
10. Restituisce snapshot frozen-shape (sempre tutte le chiavi).

Nessun ramo produce testo di risposta o direttive.

---

## 7. Relazione con gli altri moduli V2

```
Perception  →  Director  →  Memory  →  Planner  →  Writer  →  Reviewer
   (ora)         (futuro)
```

| Modulo | Usa Perception così |
|--------|---------------------|
| Director | Come unico input osservativo per il Decision Record |
| Memory | Non chiamata da Perception; al più riceve snapshot in futuro per ranking |
| Planner / Writer / Reviewer | Non leggono Perception direttamente nel design ideale (passano dal Decision Record) |

**Stato integrazione attuale:** nessuno. Il file non è importato da `api/chat.ts` né dalla mesh V1.

---

## 8. Fail-soft

| Caso | Comportamento |
|------|----------------|
| `userMessage` vuoto | `intent: 'silence'`, `userNeed: 'unclear'`, confidence bassa |
| Solo emoji / “…” | `silence` o `small_talk` a bassa confidence |
| Lingua mista | lingua dominante; note su mix |
| Memoria malformata | ignorata |
| Messaggi non array | trattati come `[]` |

---

## 9. Test

File: `lib/server/v2/brain/perception.test.mjs`

Esecuzione (isolata):

```bash
node lib/server/v2/brain/perception.test.mjs
```

I test verificano:

- forma output completa
- greeting / support / learning / continuation
- assenza di campi decisionali (no `askQuestion`, no `tools`, …)
- purezza (stesso input → stesso output)
- nessuna dipendenza dalla pipeline V1

---

## 10. Non-goals (questa consegna)

- Collegamento a `api/chat.ts` / `cognitive-engine.js`
- Chiamate LLM
- Persistenza
- Localizzazione completa di tutte le lingue del mondo (subset euristico IT/EN + hint altre)
- Perfect accuracy su ambiguità estreme — `confidence` e `alternatives` esistono per questo

---

*Specifica allineata a LAIfe V2: un solo osservatore, zero decisioni.*
