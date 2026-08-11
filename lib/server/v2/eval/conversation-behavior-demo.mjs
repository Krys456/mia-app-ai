#!/usr/bin/env node
/**
 * Conversation Behavior Harness — demo (offline, manual examples)
 *
 * Compares conversational *decisions* LAIfe vs ChatGPT on 10+ fixed cases.
 * No LLM. No Writer / Planner / Runtime / Pipeline / API wiring.
 *
 * Usage:
 *   node lib/server/v2/eval/conversation-behavior-demo.mjs
 */

import { writeFileSync } from 'fs'
import {
  createConversationBehaviorHarness,
  CONVERSATION_BEHAVIOR_HARNESS_VERSION,
} from './conversation-behavior-harness.js'

const harness = createConversationBehaviorHarness()

/**
 * @typedef {import('./conversation-behavior-harness.js').BehaviorRating} BehaviorRating
 */

/** @type {Array<{ case: object, rating: BehaviorRating }>} */
const EXAMPLES = [
  {
    case: {
      id: '01-ciao',
      input: 'Ciao',
      laifeResponse: 'Ciao! Bentornato.',
      chatgptResponse: 'Ciao! Come posso aiutarti oggi?',
    },
    rating: {
      turnType: 'conversation',
      strategy: 'expand',
      move: 'reflection',
      initiative: 'low',
      question: false,
      opening: 'warm',
      closing: 'statement',
      depth: 'minimal',
      energy: 'low',
      winner: 'LAIfe',
      chatgpt: {
        turnType: 'conversation',
        strategy: 'expand',
        move: 'question',
        initiative: 'medium',
        question: true,
        opening: 'friendly',
        closing: 'question',
        depth: 'short',
        energy: 'medium',
      },
    },
  },
  {
    case: {
      id: '02-ok-neuroscience',
      input: 'Ok',
      laifeResponse:
        'Un dettaglio curioso: il cervello consuma circa il 20% dell\'energia del corpo a riposo.',
      chatgptResponse:
        'Perfetto. Continuando sulla neuroscienza, i neuroni comunicano tramite sinapsi e neurotrasmettitori…',
    },
    rating: {
      turnType: 'learning',
      strategy: 'surprise',
      move: 'unexpected_fact',
      initiative: 'high',
      question: false,
      opening: 'direct',
      closing: 'statement',
      depth: 'short',
      energy: 'high',
      winner: 'LAIfe',
      chatgpt: {
        turnType: 'learning',
        strategy: 'expand',
        move: 'scientific_explanation',
        initiative: 'medium',
        question: false,
        opening: 'friendly',
        closing: 'statement',
        depth: 'deep',
        energy: 'medium',
      },
    },
  },
  {
    case: {
      id: '03-interessante-space',
      input: 'Interessante',
      laifeResponse:
        'Per esempio: sulla ISS gli astronauti vedono 16 albe al giorno perché orbitano così in fretta.',
      chatgptResponse:
        'Sì, lo spazio è affascinante. Vuoi che approfondisca l\'orbita terrestre o i pianeti?',
    },
    rating: {
      turnType: 'learning',
      strategy: 'example',
      move: 'real_world_example',
      initiative: 'high',
      question: false,
      opening: 'direct',
      closing: 'statement',
      depth: 'short',
      energy: 'high',
      winner: 'LAIfe',
      chatgpt: {
        turnType: 'exploration',
        strategy: 'expand',
        move: 'question',
        initiative: 'medium',
        question: true,
        opening: 'friendly',
        closing: 'question',
        depth: 'short',
        energy: 'medium',
      },
    },
  },
  {
    case: {
      id: '04-continua',
      input: 'Continua',
      laifeResponse:
        'La fotosintesi parte dalla luce: i cloroplasti catturano fotoni e avviamo la catena che produce zuccheri.',
      chatgptResponse:
        'Certo. Come dicevo, la fotosintesi si divide in fase luce e fase buio; nella fase luce…',
    },
    rating: {
      turnType: 'learning',
      strategy: 'expand',
      move: 'scientific_explanation',
      initiative: 'medium',
      question: false,
      opening: 'direct',
      closing: 'statement',
      depth: 'medium',
      energy: 'medium',
      winner: 'Tie',
      chatgpt: {
        turnType: 'learning',
        strategy: 'expand',
        move: 'scientific_explanation',
        initiative: 'medium',
        question: false,
        opening: 'friendly',
        closing: 'statement',
        depth: 'deep',
        energy: 'medium',
      },
    },
  },
  {
    case: {
      id: '05-bug',
      input: 'Ho un bug',
      laifeResponse:
        'Partiamo dal punto di fallimento: dove crasha esattamente e quale errore vedi?',
      chatgptResponse:
        'Capisco. Ti guido passo passo: 1) riproduci 2) leggi lo stack 3) isola il modulo…',
    },
    rating: {
      turnType: 'debugging',
      strategy: 'diagnose',
      move: 'next_step',
      initiative: 'medium',
      question: true,
      opening: 'direct',
      closing: 'question',
      depth: 'short',
      energy: 'medium',
      winner: 'ChatGPT',
      chatgpt: {
        turnType: 'debugging',
        strategy: 'diagnose',
        move: 'practical_step',
        initiative: 'high',
        question: false,
        opening: 'technical',
        closing: 'proposal',
        depth: 'medium',
        energy: 'high',
      },
    },
  },
  {
    case: {
      id: '06-idea',
      input: "Vorrei un'idea",
      laifeResponse:
        'Tre angoli: tono più corto, esempi di vita reale, e ripresa del contesto senza riassumere tutto.',
      chatgptResponse:
        'Un\'idea: potresti migliorare LAIfe aggiungendo personalizzazione avanzata basata sulle preferenze utente.',
    },
    rating: {
      turnType: 'brainstorming',
      strategy: 'surprise',
      move: 'practical_step',
      initiative: 'high',
      question: false,
      opening: 'direct',
      closing: 'proposal',
      depth: 'medium',
      energy: 'high',
      winner: 'LAIfe',
      chatgpt: {
        turnType: 'brainstorming',
        strategy: 'example',
        move: 'definition',
        initiative: 'medium',
        question: false,
        opening: 'friendly',
        closing: 'proposal',
        depth: 'short',
        energy: 'medium',
      },
    },
  },
  {
    case: {
      id: '07-non-so-decidere',
      input: 'Non so decidere',
      laifeResponse:
        'Due strade: velocità ora, o robustezza dopo. Se ti serve momentum, scegli la prima.',
      chatgptResponse:
        'È normale essere indecisi. Elenca pro e contro, poi scegli in base alle tue priorità. Vuoi che lo facciamo insieme?',
    },
    rating: {
      turnType: 'decision',
      strategy: 'contrast',
      move: 'next_step',
      initiative: 'high',
      question: false,
      opening: 'direct',
      closing: 'proposal',
      depth: 'short',
      energy: 'medium',
      winner: 'LAIfe',
      chatgpt: {
        turnType: 'support',
        strategy: 'simplify',
        move: 'question',
        initiative: 'medium',
        question: true,
        opening: 'friendly',
        closing: 'question',
        depth: 'medium',
        energy: 'low',
      },
    },
  },
  {
    case: {
      id: '08-spiegami',
      input: 'Spiegami',
      laifeResponse: 'Di cosa? Dammi il concetto e parto dalla definizione corta.',
      chatgptResponse:
        'Certo! Dimmi pure l\'argomento e te lo spiego in modo chiaro, con esempi e analogie.',
    },
    rating: {
      turnType: 'learning',
      strategy: 'simplify',
      move: 'question',
      initiative: 'low',
      question: true,
      opening: 'direct',
      closing: 'question',
      depth: 'minimal',
      energy: 'low',
      winner: 'Tie',
      chatgpt: {
        turnType: 'learning',
        strategy: 'expand',
        move: 'question',
        initiative: 'medium',
        question: true,
        opening: 'friendly',
        closing: 'question',
        depth: 'short',
        energy: 'medium',
      },
    },
  },
  {
    case: {
      id: '09-sono-triste',
      input: 'Sono triste.',
      laifeResponse:
        'Mi dispiace leggerlo. A volte ci sono giornate che pesano di più delle altre.',
      chatgptResponse:
        'Mi dispiace che tu ti senta così. Sono qui per ascoltarti: vuoi parlarne?',
    },
    rating: {
      turnType: 'support',
      strategy: 'expand',
      move: 'reflection',
      initiative: 'low',
      question: false,
      opening: 'warm',
      closing: 'statement',
      depth: 'short',
      energy: 'low',
      winner: 'LAIfe',
      chatgpt: {
        turnType: 'support',
        strategy: 'expand',
        move: 'question',
        initiative: 'medium',
        question: true,
        opening: 'warm',
        closing: 'question',
        depth: 'short',
        energy: 'low',
      },
    },
  },
  {
    case: {
      id: '10-riprendiamo',
      input: 'Riprendiamo da dove avevamo lasciato.',
      laifeResponse:
        'Possiamo continuare con LAIfe: la V2 è già più naturale sul filo del discorso.',
      chatgptResponse:
        'Certo! Riassumendo: stavate lavorando su V2. Da quale punto preferisci ripartire?',
    },
    rating: {
      turnType: 'resume',
      strategy: 'resume',
      move: 'next_step',
      initiative: 'medium',
      question: false,
      opening: 'direct',
      closing: 'statement',
      depth: 'short',
      energy: 'medium',
      winner: 'LAIfe',
      chatgpt: {
        turnType: 'resume',
        strategy: 'summarize',
        move: 'question',
        initiative: 'medium',
        question: true,
        opening: 'friendly',
        closing: 'question',
        depth: 'medium',
        energy: 'medium',
      },
    },
  },
  {
    case: {
      id: '11-di-cosa-parlare',
      input: 'Di cosa possiamo parlare?',
      laifeResponse:
        'Possiamo andare su LAIfe, su un bug concreto, o su un\'idea laterale tipo tono conversazionale.',
      chatgptResponse:
        'Possiamo parlare di qualsiasi cosa ti interessi: tecnologia, scienza, hobby… Cosa preferisci?',
    },
    rating: {
      turnType: 'exploration',
      strategy: 'surprise',
      move: 'thought_experiment',
      initiative: 'high',
      question: false,
      opening: 'direct',
      closing: 'proposal',
      depth: 'short',
      energy: 'high',
      winner: 'LAIfe',
      chatgpt: {
        turnType: 'exploration',
        strategy: 'expand',
        move: 'question',
        initiative: 'medium',
        question: true,
        opening: 'friendly',
        closing: 'question',
        depth: 'short',
        energy: 'medium',
      },
    },
  },
  {
    case: {
      id: '12-minimal-ok',
      input: 'ok',
      laifeResponse: 'Perfetto.',
      chatgptResponse: 'Ottimo! Dimmi pure come vuoi procedere.',
    },
    rating: {
      turnType: 'conversation',
      strategy: 'simplify',
      move: 'reflection',
      initiative: 'none',
      question: false,
      opening: 'none',
      closing: 'none',
      depth: 'minimal',
      energy: 'low',
      winner: 'LAIfe',
      chatgpt: {
        turnType: 'conversation',
        strategy: 'expand',
        move: 'question',
        initiative: 'medium',
        question: true,
        opening: 'friendly',
        closing: 'question',
        depth: 'short',
        energy: 'medium',
      },
    },
  },
]

for (const ex of EXAMPLES) {
  const id = harness.addCase(ex.case)
  harness.rate(id, ex.rating)
}

const summary = harness.summary()
const table = harness.printTable()
const outPath = '/tmp/v2-conversation-behavior-demo.json'
writeFileSync(outPath, harness.toJSON())

console.log(`Conversation Behavior Demo (${CONVERSATION_BEHAVIOR_HARNESS_VERSION})`)
console.log(`cases: ${summary.cases}  rated: ${summary.rated}  paired: ${summary.paired}`)
console.log('')
console.log(table)
console.log('')
console.log('=== SUMMARY ===')
console.log(
  `wins: LAIfe=${summary.wins.LAIfe} ChatGPT=${summary.wins.ChatGPT} Tie=${summary.wins.Tie}`,
)
console.log(`strategyMatch:    ${summary.strategyMatch}`)
console.log(`depthMatch:       ${summary.depthMatch}`)
console.log(`initiativeMatch:  ${summary.initiativeMatch}`)
console.log(`openingMatch:     ${summary.openingMatch}`)
console.log(`closingMatch:     ${summary.closingMatch}`)
console.log(`overallSimilarity:${summary.overallSimilarity}`)
console.log(`saved ${outPath}`)
