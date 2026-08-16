/**
 * Client-only Web Speech Recognition wrapper (#273).
 * No SSR / module-init access to window — call factories at runtime only.
 */

export type SpeechRecognitionErrorCode =
  | 'not-allowed'
  | 'service-not-allowed'
  | 'audio-capture'
  | 'no-speech'
  | 'network'
  | 'aborted'
  | 'busy'
  | 'language-not-supported'
  | 'unknown'

export interface SpeechRecognitionResultEventLike {
  results: ArrayLike<{
    isFinal: boolean
    0: { transcript: string }
    length: number
  }>
  resultIndex: number
}

export interface SpeechRecognitionErrorEventLike {
  error: string
  message?: string
}

export interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onstart: ((ev: Event) => void) | null
  onend: ((ev: Event) => void) | null
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null
  onresult: ((ev: SpeechRecognitionResultEventLike) => void) | null
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Runtime feature detection — safe to call in browser only. */
export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionConstructor() != null
}

export function createSpeechRecognition(): SpeechRecognitionLike | null {
  const Ctor = getSpeechRecognitionConstructor()
  if (!Ctor) return null
  try {
    return new Ctor()
  } catch {
    return null
  }
}

export function normalizeSpeechErrorCode(raw: string | undefined | null): SpeechRecognitionErrorCode {
  const code = String(raw || '')
    .trim()
    .toLowerCase()
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return code === 'service-not-allowed' ? 'service-not-allowed' : 'not-allowed'
    case 'audio-capture':
      return 'audio-capture'
    case 'no-speech':
      return 'no-speech'
    case 'network':
      return 'network'
    case 'aborted':
      return 'aborted'
    case 'busy':
      return 'busy'
    case 'language-not-supported':
      return 'language-not-supported'
    default:
      return 'unknown'
  }
}

/** User-facing Italian copy — never expose raw vendor errors. */
export function friendlySpeechError(code: SpeechRecognitionErrorCode): string | null {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microfono non autorizzato. Puoi abilitarlo dalle impostazioni del browser.'
    case 'audio-capture':
    case 'busy':
      return 'Microfono non disponibile. Riprova tra un momento.'
    case 'no-speech':
      return 'Non ho sentito nulla. Tocca di nuovo il microfono e riprova.'
    case 'network':
    case 'language-not-supported':
    case 'unknown':
      return 'Dettatura non riuscita. Puoi scrivere il messaggio normalmente.'
    case 'aborted':
      return null
    default:
      return 'Dettatura non riuscita. Puoi scrivere il messaggio normalmente.'
  }
}

/** Append transcript to base text with a single intelligent space. */
export function mergeDictationTranscript(baseText: string, transcript: string): string {
  const base = String(baseText ?? '')
  const next = String(transcript ?? '').trim()
  if (!next) return base
  if (!base.trim()) return next
  if (/\s$/.test(base)) return `${base.replace(/\s+$/g, ' ')}${next}`
  return `${base} ${next}`
}

export interface DictationSessionHandlers {
  onStart?: () => void
  onEnd?: () => void
  onFinalTranscript?: (transcript: string) => void
  onError?: (code: SpeechRecognitionErrorCode) => void
}

/**
 * Bind a one-shot recognition session (continuous=false, interimResults=false).
 * Returns a disposer that aborts and clears handlers.
 */
export function bindDictationSession(
  recognition: SpeechRecognitionLike,
  lang: string,
  handlers: DictationSessionHandlers,
): () => void {
  recognition.lang = lang || 'en-US'
  recognition.continuous = false
  recognition.interimResults = false
  recognition.maxAlternatives = 1

  recognition.onstart = () => {
    handlers.onStart?.()
  }
  recognition.onend = () => {
    handlers.onEnd?.()
  }
  recognition.onerror = (ev) => {
    handlers.onError?.(normalizeSpeechErrorCode(ev?.error))
  }
  recognition.onresult = (ev) => {
    try {
      const results = ev?.results
      if (!results || results.length === 0) return
      let text = ''
      for (let i = ev.resultIndex ?? 0; i < results.length; i += 1) {
        const item = results[i]
        if (!item) continue
        // MVP: only commit finals (interimResults=false, but guard anyway).
        if (item.isFinal === false) continue
        const piece = item[0]?.transcript
        if (typeof piece === 'string' && piece.trim()) {
          text = text ? `${text} ${piece.trim()}` : piece.trim()
        }
      }
      if (text) handlers.onFinalTranscript?.(text)
    } catch {
      handlers.onError?.('unknown')
    }
  }

  return () => {
    recognition.onstart = null
    recognition.onend = null
    recognition.onerror = null
    recognition.onresult = null
    try {
      recognition.abort()
    } catch {
      /* ignore */
    }
  }
}
