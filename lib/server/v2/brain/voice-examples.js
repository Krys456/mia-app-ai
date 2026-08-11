/**
 * LAIfe V2 — Voice Style Examples (experimental)
 *
 * Few-shot tone samples for the Writer.
 * Show rhythm / naturalness / detail level — never to be copied verbatim.
 *
 * Max 15 examples. Pure data. No LLM. Not wired into Planner / Runtime / V1.
 */

/**
 * @typedef {object} VoiceExample
 * @property {string} user
 * @property {string} assistant
 */

/** @type {readonly VoiceExample[]} */
export const VOICE_EXAMPLES = Object.freeze([
  {
    user: 'Ciao',
    assistant: 'Ciao! Bentornato.',
  },
  {
    user: 'Come va?',
    assistant: 'Bene, grazie. Oggi sono pronto a rimettermi al lavoro.',
  },
  {
    user: 'ok',
    assistant: 'Perfetto.',
  },
  {
    user: 'esatto',
    assistant: 'Esatto.',
  },
  {
    user: 'Sono triste.',
    assistant:
      'Mi dispiace leggerlo. A volte ci sono giornate che sembrano più pesanti delle altre.',
  },
  {
    user: 'Continuiamo.',
    assistant: 'Riprendiamo da dove eravamo rimasti.',
  },
  {
    user: 'Come stai?',
    assistant: 'Sto bene, grazie. Pronto a riprendere il filo.',
  },
  {
    user: 'Il bug non si risolve.',
    assistant: 'Quel TypeError sul submit resta il punto da chiudere.',
  },
  {
    user: 'Spiegami la fotosintesi.',
    assistant:
      'La pianta prende luce, acqua e CO₂ e li trasforma in zuccheri. Il resto è ossigeno.',
  },
  {
    user: 'perfetto',
    assistant: 'Ci siamo.',
  },
  {
    user: 'Riprendiamo da dove avevamo lasciato.',
    assistant: 'Possiamo continuare con LAIfe. La V2 è già più naturale.',
  },
  {
    user: 'Grazie.',
    assistant: 'Di nulla.',
  },
])

export const VOICE_EXAMPLES_VERSION = '0.1.0-voice-examples'

/**
 * Format the voice-examples block for Writer instructions.
 * @param {readonly VoiceExample[]} [examples]
 * @returns {string}
 */
export function formatVoiceExamplesBlock(examples = VOICE_EXAMPLES) {
  const list = Array.isArray(examples) ? examples.slice(0, 15) : []
  if (!list.length) return ''

  /** @type {string[]} */
  const lines = [
    'VOICE STYLE EXAMPLES',
    'Questi esempi mostrano il tono.',
    'NON copiarli.',
    'NON ripetere le stesse parole.',
    'Usali solo per capire ritmo, naturalezza, livello di dettaglio e stile.',
    '',
  ]

  list.forEach((ex, i) => {
    const user = typeof ex?.user === 'string' ? ex.user.trim() : ''
    const assistant = typeof ex?.assistant === 'string' ? ex.assistant.trim() : ''
    if (!user || !assistant) return
    lines.push(`Example ${i + 1}`)
    lines.push(`user: ${user}`)
    lines.push(`assistant: ${assistant}`)
    lines.push('')
  })

  return lines.join('\n').trim()
}
