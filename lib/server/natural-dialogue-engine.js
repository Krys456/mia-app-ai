/**
 * LAIfe Natural Dialogue Engine
 *
 * Human conversations are not just exchanges of information.
 * They are sequences of conversational moves.
 *
 * LAIfe should stop reacting only to words.
 * It should recognize what role the user's message plays in the conversation
 * and respond naturally.
 *
 * Runs AFTER: Language Awareness · Social Conversation · Conversation Intent · Conversation Mode
 * Runs BEFORE: WriterDirectives
 *
 * Priority: Reaction → Connection → Conversation → Information
 *
 * Writer check: «What is happening between two people right now?»
 * NOT: «What information is being requested?»
 *
 * Invisible. Fail-soft. Soft advisor — Cognitive Coordinator decides.
 */

import { detectDominantLanguage } from './language-awareness.js'

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'greeting'|'farewell'|'small_talk'|'invitation'|'agreement'|'disagreement'|'shared_excitement'|'shared_curiosity'|'reflection'|'thinking'|'surprise'|'humor'|'laughter'|'playfulness'|'compliment'|'gratitude'|'empathy'|'support'|'encouragement'|'confession'|'storytelling'|'memory_sharing'|'celebration'|'topic_transition'|'silence'|'low_energy'|'high_energy'|'open_conversation'|'conversation_pause'|'informational'|'neutral'} DialogueMove
 */

/**
 * @typedef {'calm'|'warm'|'playful'|'excited'|'reflective'|'supportive'|'low'|'neutral'} DialogueEnergy
 */

/**
 * @typedef {'en'|'it'} DialogueLang
 */

/**
 * @typedef {object} NaturalDialoguePlan
 * @property {boolean} active
 * @property {DialogueMove} move
 * @property {DialogueMove[]} moves
 * @property {DialogueEnergy} energy
 * @property {DialogueEnergy} matchEnergy
 * @property {boolean} reactionFirst
 * @property {boolean} reactionOnly
 * @property {boolean} allowExplain
 * @property {boolean} allowQuestion
 * @property {string} reaction
 * @property {string[]} reactionAlternatives
 * @property {string} writerBrief
 * @property {string | null} structureLine
 * @property {string[]} responseHints
 * @property {string[]} reasons
 * @property {string[]} signals
 * @property {'high'|'medium'|'low'} confidence
 * @property {DialogueLang} language
 * @property {string[]} recentReactionIds
 */

const DISTRESS =
  /\b(panic|ansioso|ansia|depress|suicid|non\s+ce\s+la\s+faccio|aiuto\s+urgente|emergency|grief|lutto)\b/i

const INFO_ASK =
  /\b(aiutami|help\s+me|come\s+(?:si\s+fa|posso|fare)|how\s+(?:do|can|to|does|did)\b|perch[eé]\b|why\b|fix|debug|bug|errore|error|spiegami|explain|crea|build|scriv[ia]|write|calcola|piano|plan|codice|code|implement|deploy|cos'?è|what\s+is|quanto|differenza|tutorial|documentaz|api\b|install|configur)\b/i

/** @type {Record<DialogueMove, { en: RegExp[], it: RegExp[], energy: DialogueEnergy, reactionOnlyBias: number }>} */
const MOVE_PATTERNS = {
  greeting: {
    en: [/^(hi|hey|hello|yo|good\s+(morning|afternoon|evening))([\s!,.🥰😊🙏]*)$/i],
    it: [/^(ciao|ehi|salve|buongiorno|buonasera|buon\s+pomeriggio)([\s!,.🥰😊🙏]*)$/i],
    energy: 'warm',
    reactionOnlyBias: 0.55,
  },
  farewell: {
    en: [/\b(bye|goodbye|see\s+you|see\s+ya|talk\s+soon|gotta\s+go|good\s+night)\b/i],
    it: [/\b(ciao\s+ciao|arrivederci|a\s+presto|a\s+dopo|ci\s+vediamo|buonanotte|me\s+ne\s+vado)\b/i],
    energy: 'warm',
    reactionOnlyBias: 0.7,
  },
  laughter: {
    en: [/^(haha+|hehe+|lol+|lmao|😂+|😄+|😆+|🤣+|ahah+)([\s!,.]*)$/i, /\b(haha+|lol+|😂|🤣)\b/i],
    it: [/^(ahah+|hah+|😂+|😄+|🤣+)([\s!,.]*)$/i, /\b(ahah+|😂|🤣)\b/i],
    energy: 'playful',
    reactionOnlyBias: 0.95,
  },
  humor: {
    en: [/\b(joking|just\s+kidding|jk\b|funny|hilarious|that'?s\s+funny)\b/i],
    it: [/\b(scherz[oa]|sto\s+scherzando|divertente|esilarante)\b/i],
    energy: 'playful',
    reactionOnlyBias: 0.7,
  },
  playfulness: {
    en: [/\b(hehe|cheeky|naughty|teasing|gotcha|oopsie)\b/i],
    it: [/\b(hehe|birichin|prendi\s+in\s+giro|ti\s+è\s+scappata)\b/i],
    energy: 'playful',
    reactionOnlyBias: 0.65,
  },
  shared_excitement: {
    en: [
      /^(that'?s\s+(awesome|amazing|incredible|great|fantastic|cool)|so\s+cool|love\s+(it|this|that)|yay|woo+|yes[!]+)([\s!,.🥰😊🔥✨]*)$/i,
      /\b(that'?s\s+(awesome|amazing|incredible)|so\s+excited)\b/i,
    ],
    it: [
      /^(che\s+(bello|figo|forte)|fantastico|incredibile|evviva|troppo\s+forte|bellissimo)([\s!,.🥰😊🔥✨]*)$/i,
      /\b(che\s+(bello|figo|forte)|fantastico|incredibile)\b/i,
    ],
    energy: 'excited',
    reactionOnlyBias: 0.85,
  },
  celebration: {
    en: [/\b(we\s+did\s+it|i\s+did\s+it|finally|celebrat|won|promoted|passed)\b/i],
    it: [/\b(ce\s+l'?ho\s+fatta|ce\s+l'?abbiamo\s+fatta|finalmente|vinto|assunto|promosso)\b/i],
    energy: 'excited',
    reactionOnlyBias: 0.6,
  },
  agreement: {
    en: [
      /^(same|exactly|true|right|agreed|absolutely|definitely|fair\s+enough|you'?re\s+right|yep|yeah|yes)([\s!,.🥰😊💯]*)$/i,
      /\b(i\s+agree|same\s+here|couldn'?t\s+agree)\b/i,
    ],
    it: [
      /^(esatto|vero|d['’]?accordo|assolutamente|certo|s[iì]|già|uguale|stessa\s+cosa)([\s!,.🥰😊💯]*)$/i,
      /\b(sono\s+d['’]?accordo|hai\s+ragione)\b/i,
    ],
    energy: 'warm',
    reactionOnlyBias: 0.9,
  },
  disagreement: {
    en: [/^(not\s+really|i\s+disagree|hmm\s+no|nah|nope)([\s!,.]*)$/i, /\b(i\s+don'?t\s+think\s+so|not\s+sure\s+about\s+that)\b/i],
    it: [/^(non\s+proprio|non\s+sono\s+d['’]?accordo|mah\s+no|nope)([\s!,.]*)$/i, /\b(non\s+mi\s+convince|la\s+vedo\s+diversa)\b/i],
    energy: 'calm',
    reactionOnlyBias: 0.55,
  },
  gratitude: {
    en: [/^(thanks|thank\s+you|thx|ty)([\s!,.🥰😊🙏]*)$/i, /\b(thanks\s+a\s+lot|appreciate\s+(it|that))\b/i],
    it: [/^(grazie|grazie\s+mille|ti\s+ringrazio)([\s!,.🥰😊🙏]*)$/i],
    energy: 'warm',
    reactionOnlyBias: 0.9,
  },
  compliment: {
    en: [/\b(you(?:'re|\s+are)\s+(?:great|awesome|amazing|the\s+best|brilliant|smart|kind)|nice\s+(?:one|chat)|love\s+(?:talking|chatting)\s+with\s+you)\b/i],
    it: [/\b(sei\s+(?:fantastico|fantastica|grande|speciale|brav[oa]|genial[ei])|ti\s+adoro|mi\s+piace\s+parlare\s+con\s+te)\b/i],
    energy: 'warm',
    reactionOnlyBias: 0.7,
  },
  invitation: {
    en: [/\b(we\s+should\s+(?:talk|chat)|let'?s\s+(?:talk|chat|catch\s+up)|want\s+to\s+(?:talk|chat)|shall\s+we\s+talk)\b/i],
    it: [/\b(dovremmo\s+parlare|parliamone|chiacchieriamo|vorrei\s+parlare|facciamo\s+due\s+chiacchiere)\b/i],
    energy: 'warm',
    reactionOnlyBias: 0.75,
  },
  reflection: {
    en: [/^(hmm+|mm+|uhm+|uh+|huh)([\s.…]*)?$/i, /^(interesting\.?|makes\s+sense\.?|i\s+see\.?)([\s!,.]*)$/i],
    it: [/^(hmm+|mm+|uhm+|boh\.+\.?|mah\.+\.?)([\s.…]*)?$/i, /^(interessante\.?|ha\s+senso\.?|capisco\.?)([\s!,.]*)$/i],
    energy: 'reflective',
    reactionOnlyBias: 0.85,
  },
  thinking: {
    en: [/\b(let\s+me\s+think|i'?m\s+thinking|not\s+sure\s+yet|give\s+me\s+a\s+(sec|second|moment))\b/i],
    it: [/\b(fammi\s+pensare|sto\s+pensando|non\s+sono\s+(ancora\s+)?sicur[oa]|un\s+attimo)\b/i],
    energy: 'reflective',
    reactionOnlyBias: 0.8,
  },
  surprise: {
    en: [/^(wow|whoa|oh+|no\s+way|wait\s+what|seriously\??)([\s!,.]*)$/i, /\b(i\s+didn'?t\s+expect|unexpected)\b/i],
    it: [/^(wow|whoa|oh+|davvero\??|no\s+way|aspetta\s+cosa)([\s!,.]*)$/i, /\b(non\s+me\s+l'?aspettavo|inaspettato)\b/i],
    energy: 'excited',
    reactionOnlyBias: 0.8,
  },
  shared_curiosity: {
    en: [/\b(i\s+wonder|curious|makes\s+me\s+wonder|what\s+if)\b/i],
    it: [/\b(mi\s+chiedo|curios[oa]|chissà|e\s+se\b)\b/i],
    energy: 'warm',
    reactionOnlyBias: 0.4,
  },
  empathy: {
    en: [/\b(i\s+(?:feel|know)\s+(?:that|you)|that\s+(?:sucks|hurts|must\s+be\s+hard)|i'?m\s+sorry\s+(?:you|to\s+hear))\b/i],
    it: [/\b(ti\s+capisco|mi\s+dispiace|deve\s+essere\s+dur[oa]|capisco\s+come\s+ti\s+senti)\b/i],
    energy: 'supportive',
    reactionOnlyBias: 0.5,
  },
  support: {
    en: [/\b(i'?m\s+here|you(?:'re|\s+are)\s+not\s+alone|lean\s+on\s+me|here\s+for\s+you)\b/i],
    it: [/\b(ci\s+sono|non\s+sei\s+sol[oa]|sono\s+qui|conta\s+su\s+di\s+me)\b/i],
    energy: 'supportive',
    reactionOnlyBias: 0.55,
  },
  encouragement: {
    en: [/\b(you\s+got\s+this|keep\s+(?:going|it\s+up)|don'?t\s+give\s+up|you\s+can\s+do\s+it)\b/i],
    it: [/\b(forza|dai\s+che\s+ce\s+la\s+fai|non\s+mollare|in\s+bocca\s+al\s+lupo|coraggio)\b/i],
    energy: 'warm',
    reactionOnlyBias: 0.6,
  },
  confession: {
    en: [/\b(honestly|to\s+be\s+honest|i\s+have\s+to\s+admit|confession|i'?ve\s+never\s+told)\b/i],
    it: [/\b(a\s+dire\s+il\s+vero|devo\s+ammettere|confesso|non\s+l'?ho\s+mai\s+detto)\b/i],
    energy: 'reflective',
    reactionOnlyBias: 0.35,
  },
  storytelling: {
    en: [/\b(so\s+(?:basically|there\s+i\s+was)|long\s+story|the\s+other\s+day|once\s+upon|let\s+me\s+tell\s+you)\b/i],
    it: [/\b(allora|l'?altra\s+volta|ti\s+racconto|c'?era\s+una\s+volta|ieri\s+mi\s+[eè]\s+successo)\b/i],
    energy: 'warm',
    reactionOnlyBias: 0.25,
  },
  memory_sharing: {
    en: [/\b(i\s+remember|reminds\s+me|back\s+when|years\s+ago|when\s+i\s+was)\b/i],
    it: [/\b(mi\s+ricordo|mi\s+fa\s+pensare|anni\s+fa|quando\s+ero|una\s+volta)\b/i],
    energy: 'reflective',
    reactionOnlyBias: 0.3,
  },
  topic_transition: {
    en: [/\b(anyway|by\s+the\s+way|btw|changing\s+(?:the\s+)?(?:subject|topic)|speaking\s+of)\b/i],
    it: [/\b(comunque|a\s+proposito|cambiando\s+(?:argomento|disco)|tra\s+l'?altro)\b/i],
    energy: 'neutral',
    reactionOnlyBias: 0.2,
  },
  silence: {
    en: [/^\.+$|^…+$|^-+$|^\s*$/],
    it: [/^\.+$|^…+$|^-+$/],
    energy: 'low',
    reactionOnlyBias: 0.9,
  },
  low_energy: {
    en: [/\b(tired|exhausted|drained|meh|blah|not\s+feeling\s+(it|great)|low\s+energy)\b/i],
    it: [/\b(stanc[oa]|esaust[oa]|svuotat[oa]|meh|non\s+ho\s+energie|giù)\b/i],
    energy: 'low',
    reactionOnlyBias: 0.55,
  },
  high_energy: {
    en: [/\b(pumped|hyped|energized|let'?s\s+go+|so\s+ready|fired\s+up)\b/i],
    it: [/\b(caric[oa]|pien[oa]\s+di\s+energia|andiamo+|pront[oa]\s+a\s+tutto)\b/i],
    energy: 'excited',
    reactionOnlyBias: 0.55,
  },
  open_conversation: {
    en: [/\b(let'?s\s+(?:talk|chat)|what\s+do\s+you\s+(?:want\s+to\s+talk|think)|tell\s+me\s+(?:something|more))\b/i],
    it: [/\b(parliamo|chiacchieriamo|dimmi\s+(?:qualcosa|di\s+pi[uù])|di\s+cosa\s+parliamo)\b/i],
    energy: 'warm',
    reactionOnlyBias: 0.35,
  },
  conversation_pause: {
    en: [/\b(one\s+(?:sec|second|moment)|brb|hold\s+on|give\s+me\s+a\s+minute)\b/i],
    it: [/\b(un\s+attimo|torno\s+subito|aspetta\s+un\s+secondo|dammi\s+un\s+minuto)\b/i],
    energy: 'calm',
    reactionOnlyBias: 0.9,
  },
  small_talk: {
    en: [/\b(how(?:'s|\s+is)\s+it\s+going|what'?s\s+up|nice\s+(?:weather|day)|how\s+was\s+your)\b/i],
    it: [/\b(come\s+(?:va|stai)|che\s+si\s+dice|bella\s+giornata|come\s+[eè]\s+andata)\b/i],
    energy: 'warm',
    reactionOnlyBias: 0.45,
  },
  informational: {
    en: [],
    it: [],
    energy: 'neutral',
    reactionOnlyBias: 0,
  },
  neutral: {
    en: [],
    it: [],
    energy: 'neutral',
    reactionOnlyBias: 0,
  },
}

/**
 * Core reaction seeds per move (EN / IT). Expanded into hundreds of variations.
 * @type {Record<string, { en: string[], it: string[] }>}
 */
const REACTION_SEEDS = {
  greeting: {
    en: ['Hey!', 'Hi there', 'Hello', 'Hey — nice to see you', 'Hi', 'Hey hey'],
    it: ['Ciao!', 'Ehi', 'Ciao ciao', 'Ciao — che bello', 'Hey', 'Salve'],
  },
  farewell: {
    en: ['Take care', 'Talk soon', 'Bye for now', 'Sleep well', 'Catch you later', 'Until next time'],
    it: ['A presto', 'Ci sentiamo', 'Alla prossima', 'Dormi bene', 'A dopo', 'Un abbraccio'],
  },
  laughter: {
    en: [
      'Haha',
      'Hahaha',
      'Hehe',
      '😂',
      '😄',
      'That made me laugh too',
      'Okay that got me',
      'Lol',
      'I needed that',
      'You got me',
    ],
    it: [
      'Ahah',
      'Ahahah',
      'Hehe',
      '😂',
      '😄',
      'Mi hai fatto ridere anche a me',
      'Ok questa mi ha preso',
      'Ahah vero',
      'Mi serviva',
      'Mi hai beccato',
    ],
  },
  humor: {
    en: ['Haha nice', 'That’s funny', 'Okay I like that', 'Clever', 'Well played', 'You got me there'],
    it: ['Ahah bella', 'Divertente', 'Ok questa mi piace', 'Furbo', 'Ben giocato', 'Mi hai beccato'],
  },
  playfulness: {
    en: ['Hehe', 'Oh you’re trouble', 'Okay then', 'Cheeky', 'I see what you did there', 'Noted 😏'],
    it: ['Hehe', 'Oh sei pericoloso', 'Va bene così', 'Birichino', 'Ho visto cosa hai fatto', 'Annotato 😏'],
  },
  shared_excitement: {
    en: [
      'I know!',
      'Right?!',
      'Exactly!',
      'So good',
      'I love that',
      'Yes!',
      'This is great',
      'Same energy',
      'I’m with you',
      'Honestly yes',
    ],
    it: [
      'Lo so!',
      'Vero?!',
      'Esatto!',
      'Troppo bello',
      'Lo adoro',
      'Sì!',
      'È stupendo',
      'Stessa vibrazione',
      'Sono con te',
      'Davvero sì',
    ],
  },
  celebration: {
    en: ['Yes!', 'That’s huge', 'Proud of that', 'Well deserved', 'Let’s go', 'Amazing news'],
    it: ['Sì!', 'È enorme', 'Che soddisfazione', 'Te lo meritavi', 'Forza', 'Che notizia'],
  },
  agreement: {
    en: [
      'Exactly',
      'True',
      'Same',
      'Fair enough',
      'You’ve got a point',
      'I agree',
      'Right',
      'Couldn’t agree more',
      'I had the feeling we’d agree on that',
      'Yep',
    ],
    it: [
      'Esatto',
      'Vero',
      'Uguale',
      'Giusto',
      'Hai un punto',
      'Concordo',
      'Già',
      'Non potrei essere più d’accordo',
      'Avevo la sensazione che saremmo stati d’accordo',
      'Sì',
    ],
  },
  disagreement: {
    en: ['Fair — I see it differently', 'Hmm, not sure', 'Interesting take', 'I hear you, though I’d nudge it a bit', 'Respectfully… maybe not'],
    it: ['Giusto — io la vedo un po’ diversa', 'Mah, non so', 'Punto di vista interessante', 'Ti ascolto, però sposterei un filo', 'Con rispetto… forse no'],
  },
  gratitude: {
    en: ['You’re welcome', 'Anytime', 'Happy to', 'Of course', 'Glad it helped', 'My pleasure'],
    it: ['Prego', 'Quando vuoi', 'Volentieri', 'Certo', 'Contento che abbia aiutato', 'Di niente'],
  },
  compliment: {
    en: ['That’s kind of you', 'Means a lot', 'Thank you', 'You’re sweet', 'I’ll take that', 'Appreciate it'],
    it: ['Che gentile', 'Significa molto', 'Grazie', 'Che carino', 'Lo accetto', 'Ti ringrazio'],
  },
  invitation: {
    en: ['I’d really like that', 'Absolutely', 'Yes — I’m in', 'Let’s', 'Sounds good to me', 'I’m here for it'],
    it: ['Mi piacerebbe davvero', 'Assolutamente', 'Sì — ci sto', 'Facciamolo', 'Mi sta bene', 'Ci sono'],
  },
  reflection: {
    en: [
      'Take your time',
      'Hmm',
      'Sometimes a small pause says more than a long answer',
      'I’m with you in that pause',
      'No rush',
      'Sitting with that',
    ],
    it: [
      'Prenditi il tempo',
      'Hmm',
      'A volte una piccola pausa dice più di una lunga risposta',
      'Resto con te in questa pausa',
      'Niente fretta',
      'Ci resto un attimo sopra',
    ],
  },
  thinking: {
    en: ['Take your time', 'No rush', 'Thinking with you', 'I’m here', 'Whenever you’re ready'],
    it: ['Prenditi il tempo', 'Niente fretta', 'Penso con te', 'Ci sono', 'Quando sei pronto'],
  },
  surprise: {
    en: ['I didn’t expect that', 'Whoa', 'Wait — really?', 'That’s unexpected', 'Oh', 'Now I’m curious'],
    it: ['Non me l’aspettavo', 'Whoa', 'Aspetta — davvero?', 'Inaspettato', 'Oh', 'Ora sono curioso'],
  },
  shared_curiosity: {
    en: ['Now you’ve made me curious', 'Same — I wonder too', 'Oh I like where this is going', 'That’s a fun thought', 'Hmm, interesting'],
    it: ['Ora mi hai reso curioso', 'Anch’io me lo chiedo', 'Oh mi piace dove sta andando', 'Bel pensiero', 'Hmm, interessante'],
  },
  empathy: {
    en: ['I hear you', 'That sounds hard', 'Makes sense you’d feel that', 'I’m with you', 'Yeah… that lands'],
    it: ['Ti ascolto', 'Sembra dura', 'Ha senso che tu ti senta così', 'Sono con te', 'Sì… arriva'],
  },
  support: {
    en: ['I’m here', 'You’re not alone in this', 'I’ve got you', 'We can take it slow', 'Side by side'],
    it: ['Ci sono', 'Non sei solo in questo', 'Ti sto vicino', 'Possiamo andarci piano', 'Fianco a fianco'],
  },
  encouragement: {
    en: ['You’ve got this', 'Keep going', 'One step is enough', 'I believe in that', 'Steady'],
    it: ['Ce la fai', 'Continua così', 'Un passo basta', 'Ci credo', 'Piano e costante'],
  },
  confession: {
    en: ['Thank you for saying that', 'That’s brave', 'I appreciate the honesty', 'I’m listening', 'That means something'],
    it: ['Grazie per averlo detto', 'È coraggioso', 'Apprezzo l’onestà', 'Ti ascolto', 'Vuol dire qualcosa'],
  },
  storytelling: {
    en: ['I’m listening', 'Go on', 'I’m hooked', 'Tell me more of that', 'I can picture it'],
    it: ['Ti ascolto', 'Continua', 'Sono preso', 'Dimmi ancora', 'Me lo immagino'],
  },
  memory_sharing: {
    en: ['That memory feels vivid', 'I can almost see it', 'Those stick for a reason', 'Beautiful', 'Thanks for sharing that'],
    it: ['Quel ricordo sembra vivo', 'Quasi lo vedo', 'Restano per un motivo', 'Bello', 'Grazie per averlo condiviso'],
  },
  topic_transition: {
    en: ['Alright', 'Okay — shifting with you', 'I’m following', 'Sure', 'Onward'],
    it: ['Va bene', 'Ok — mi sposto con te', 'Ti seguo', 'Certo', 'Avanti'],
  },
  silence: {
    en: ['…', 'I’m here', 'No rush', 'Whenever', 'Still with you'],
    it: ['…', 'Ci sono', 'Niente fretta', 'Quando vuoi', 'Sono ancora qui'],
  },
  low_energy: {
    en: ['Soft day — noted', 'We can keep it light', 'No pressure', 'I’m here quietly', 'Rest is allowed'],
    it: ['Giornata soft — annotato', 'Possiamo tenerla leggera', 'Niente pressione', 'Resto in silenzio con te', 'Riposare è permesso'],
  },
  high_energy: {
    en: ['Love the energy', 'Let’s ride that', 'I’m in', 'Yes — that spark', 'Matching you a bit'],
    it: ['Che energia', 'Andiamo su quella', 'Ci sto', 'Sì — quella scintilla', 'Ti seguo un filo'],
  },
  open_conversation: {
    en: ['I’d like that', 'I’m here for a real chat', 'Yes', 'Let’s', 'Happy to'],
    it: ['Mi piacerebbe', 'Ci sto per una chiacchiera vera', 'Sì', 'Facciamolo', 'Volentieri'],
  },
  conversation_pause: {
    en: ['Sure — take a sec', 'No rush', 'I’ll be here', 'Whenever you’re back', 'Okay'],
    it: ['Certo — prenditi un attimo', 'Niente fretta', 'Resto qui', 'Quando torni', 'Ok'],
  },
  small_talk: {
    en: ['Pretty good', 'Doing alright', 'Nice and steady', 'All good here', 'Glad you asked'],
    it: ['Abbastanza bene', 'Tutto ok', 'Tranquillo', 'Tutto bene da qui', 'Contento che tu abbia chiesto'],
  },
  // Generic connective tissue reactions (usable across moves)
  general: {
    en: [
      'Haha…',
      'Exactly',
      'True',
      'Fair enough',
      'I like that',
      'That’s interesting',
      'I didn’t expect that',
      'You’ve got a point',
      'I’ve thought about that too',
      'That’s actually a really good question',
      'Hmm…',
      'Now you’ve made me curious',
      'Oh, I like where this is going',
      'I wasn’t expecting that answer',
      'That’s a fun thought',
      'That’s surprisingly true',
      'That’s a great observation',
      'Okay',
      'Nice',
      'Makes sense',
      'I see',
      'Got it',
      'Interesting',
      'Oh?',
      'Really?',
      'Huh',
      'Alright',
      'Noted',
      'Good point',
      'That tracks',
    ],
    it: [
      'Ahah…',
      'Esatto',
      'Vero',
      'Giusto',
      'Mi piace',
      'Interessante',
      'Non me l’aspettavo',
      'Hai un punto',
      'Ci avevo pensato anch’io',
      'In realtà è una domanda davvero buona',
      'Hmm…',
      'Ora mi hai reso curioso',
      'Oh, mi piace dove sta andando',
      'Non mi aspettavo questa risposta',
      'Bel pensiero',
      'Sorprendentemente vero',
      'Ottima osservazione',
      'Ok',
      'Bello',
      'Ha senso',
      'Capisco',
      'Ricevuto',
      'Interessante',
      'Oh?',
      'Davvero?',
      'Mh',
      'Va bene',
      'Annotato',
      'Bel punto',
      'Torna',
    ],
  },
}

const EN_SUFFIXES = ['', '.', '!', '…', ' 😄', ' 😊', ' 😂', ' — yeah', ' for sure']
const IT_SUFFIXES = ['', '.', '!', '…', ' 😄', ' 😊', ' 😂', ' — sì', ' davvero']
const SOFT_EN_SUFFIXES = ['', '.', '…', ' 😊']
const SOFT_IT_SUFFIXES = ['', '.', '…', ' 😊']
const SOFT_MOVES = new Set([
  'reflection',
  'thinking',
  'silence',
  'low_energy',
  'empathy',
  'support',
  'confession',
  'conversation_pause',
  'farewell',
])

/**
 * Expand seeds into a large reaction library with controlled variation.
 * @param {string[]} seeds
 * @param {string[]} suffixes
 * @param {string} moveKey
 * @returns {{ id: string, text: string }[]}
 */
function expandReactions(seeds, suffixes, moveKey) {
  /** @type {{ id: string, text: string }[]} */
  const out = []
  const seen = new Set()
  let i = 0
  for (const seed of seeds) {
    for (const suf of suffixes) {
      // Skip emoji stacking on seeds that already end with emoji
      if (/\p{Extended_Pictographic}\s*$/u.test(seed) && /^\s*\p{Extended_Pictographic}/u.test(suf)) {
        continue
      }
      const text = `${seed}${suf}`.replace(/\s+/g, ' ').trim()
      if (!text || seen.has(text.toLowerCase())) continue
      seen.add(text.toLowerCase())
      out.push({ id: `${moveKey}-${i++}`, text })
    }
  }
  return out
}

/**
 * Build full reaction library once.
 * @returns {Record<string, { en: { id: string, text: string }[], it: { id: string, text: string }[] }>}
 */
function buildReactionLibrary() {
  /** @type {Record<string, { en: { id: string, text: string }[], it: { id: string, text: string }[] }>} */
  const lib = {}
  for (const [move, seeds] of Object.entries(REACTION_SEEDS)) {
    const soft = SOFT_MOVES.has(move)
    const enSuf = soft ? SOFT_EN_SUFFIXES : EN_SUFFIXES
    const itSuf = soft ? SOFT_IT_SUFFIXES : IT_SUFFIXES
    const en = expandReactions(seeds.en, enSuf, `${move}-en`)
    const it = expandReactions(seeds.it, itSuf, `${move}-it`)
    // Mix in general connective reactions for non-general moves
    if (move !== 'general') {
      const genEn = expandReactions(
        REACTION_SEEDS.general.en.slice(0, soft ? 8 : 12),
        soft ? SOFT_EN_SUFFIXES : ['', '.', '!', ' 😄'],
        `${move}-gen-en`,
      )
      const genIt = expandReactions(
        REACTION_SEEDS.general.it.slice(0, soft ? 8 : 12),
        soft ? SOFT_IT_SUFFIXES : ['', '.', '!', ' 😄'],
        `${move}-gen-it`,
      )
      lib[move] = {
        en: [...en, ...genEn.slice(0, soft ? 10 : 18)],
        it: [...it, ...genIt.slice(0, soft ? 10 : 18)],
      }
    } else {
      lib[move] = { en, it }
    }
  }
  return lib
}

export const REACTION_LIBRARY = buildReactionLibrary()

/** Total reaction variants across the library. */
export const REACTION_LIBRARY_COUNT = Object.values(REACTION_LIBRARY).reduce(
  (n, pack) => n + pack.en.length + pack.it.length,
  0,
)

/**
 * @param {string} text
 */
function normalize(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {ChatTurn[]|undefined|null} messages
 */
function normalizeTurns(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: normalize(m.content) }))
    .filter((m) => m.content.length > 0)
}

/**
 * @param {string} s
 */
function hashStr(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/**
 * @param {object} input
 * @returns {DialogueLang}
 */
function resolveLang(input) {
  const la =
    input.languageAwareness?.plan?.replyLanguage ||
    input.languageAwareness?.replyLanguage ||
    input.writerDirectives?.language ||
    input.plan?.understanding?.language ||
    ''
  if (la === 'en' || la === 'english') return 'en'
  if (la === 'it' || la === 'italian' || la === 'italiano') return 'it'
  const detected = detectDominantLanguage(input.userMessage || '')
  if (detected === 'en') return 'en'
  if (detected === 'it') return 'it'
  return 'en'
}

/**
 * Map conversation mode / behavior into energy bias.
 * @param {object} input
 * @returns {DialogueEnergy | null}
 */
function modeEnergy(input) {
  const mode = String(
    input.writerDirectives?.mode ||
      input.conversationMode ||
      input.behavior?.behavior ||
      input.behavior?.plan?.behavior ||
      input.conversationIntent?.inference?.expects ||
      input.conversationIntent?.plan?.inference?.expects ||
      '',
  ).toLowerCase()
  if (/companionship|presence|social|conversation/.test(mode)) return 'warm'
  if (/emotional|support/.test(mode)) return 'supportive'
  if (/exploration|curious/.test(mode)) return 'warm'
  if (/information|teaching|problem|technical|planning/.test(mode)) return 'calm'
  return null
}

/**
 * Classify conversational moves for a message.
 * @param {string} msg
 * @param {DialogueLang} lang
 * @returns {{ moves: DialogueMove[], signals: string[], score: number }}
 */
export function classifyDialogueMoves(msg, lang = 'en') {
  const text = normalize(msg)
  /** @type {DialogueMove[]} */
  const moves = []
  /** @type {string[]} */
  const signals = []
  let score = 0

  if (!text) {
    return { moves: ['silence'], signals: ['empty'], score: 2 }
  }

  /** @type {DialogueMove[]} */
  const order = [
    'laughter',
    'shared_excitement',
    'agreement',
    'disagreement',
    'gratitude',
    'reflection',
    'thinking',
    'surprise',
    'invitation',
    'farewell',
    'greeting',
    'compliment',
    'celebration',
    'humor',
    'playfulness',
    'encouragement',
    'empathy',
    'support',
    'confession',
    'memory_sharing',
    'storytelling',
    'shared_curiosity',
    'topic_transition',
    'conversation_pause',
    'low_energy',
    'high_energy',
    'open_conversation',
    'small_talk',
    'silence',
  ]

  for (const move of order) {
    const def = MOVE_PATTERNS[move]
    if (!def) continue
    const patterns = lang === 'it' ? [...def.it, ...def.en] : [...def.en, ...def.it]
    if (patterns.some((re) => re.test(text))) {
      moves.push(move)
      signals.push(`move_${move}`)
      score += move === 'laughter' || move === 'agreement' || move === 'shared_excitement' ? 3.5 : 2.2
    }
  }

  if (moves.length === 0) {
    if (INFO_ASK.test(text) || text.split(/\s+/).length >= 18) {
      return { moves: ['informational'], signals: ['info_or_long'], score: 0 }
    }
    if (text.split(/\s+/).length <= 6) {
      moves.push('small_talk')
      signals.push('short_socialish')
      score += 1.2
    } else {
      return { moves: ['neutral'], signals: ['neutral'], score: 0.5 }
    }
  }

  return { moves: [...new Set(moves)], signals, score }
}

/**
 * Primary move with priority for pure dialogue beats.
 * @param {DialogueMove[]} moves
 */
function primaryMove(moves) {
  const priority = [
    'laughter',
    'shared_excitement',
    'agreement',
    'gratitude',
    'invitation',
    'reflection',
    'thinking',
    'surprise',
    'farewell',
    'greeting',
    'compliment',
    'celebration',
    'disagreement',
    'humor',
    'playfulness',
    'encouragement',
    'empathy',
    'support',
    'confession',
    'memory_sharing',
    'storytelling',
    'shared_curiosity',
    'conversation_pause',
    'silence',
    'low_energy',
    'high_energy',
    'topic_transition',
    'open_conversation',
    'small_talk',
    'informational',
    'neutral',
  ]
  for (const p of priority) {
    if (moves.includes(/** @type {DialogueMove} */ (p))) return /** @type {DialogueMove} */ (p)
  }
  return moves[0] || 'neutral'
}

/**
 * Gentle energy matching — mirror without exaggeration.
 * @param {DialogueEnergy} userEnergy
 * @param {DialogueEnergy | null} modeBias
 */
function matchEnergy(userEnergy, modeBias) {
  /** Soften extreme excitement */
  if (userEnergy === 'excited') return 'warm'
  if (userEnergy === 'playful') return 'playful'
  if (userEnergy === 'low') return 'low'
  if (userEnergy === 'reflective') return 'reflective'
  if (userEnergy === 'supportive') return 'supportive'
  if (modeBias && modeBias !== 'excited') return modeBias
  return userEnergy === 'neutral' ? 'warm' : userEnergy
}

/**
 * Pick a reaction with anti-repetition.
 * @param {object} args
 */
export function selectReaction(args) {
  const {
    move,
    lang = 'en',
    recentReactionIds = [],
    salt = '',
  } = args
  const pack = REACTION_LIBRARY[move] || REACTION_LIBRARY.general
  const pool = lang === 'it' ? pack.it : pack.en
  const recent = new Set(recentReactionIds.map(String))
  const ranked = pool
    .map((r) => {
      let score = 1 + (hashStr(r.id + salt) % 40) / 100
      if (recent.has(r.id)) score -= 5
      if (recent.has(r.text.toLowerCase())) score -= 4
      return { ...r, score }
    })
    .sort((a, b) => b.score - a.score)

  const top = ranked.slice(0, 5)
  return {
    chosen: top[0] || pool[0] || { id: 'fallback', text: lang === 'it' ? 'Hmm…' : 'Hmm…' },
    alternatives: top.slice(1, 4).map((t) => t.text),
  }
}

/**
 * @returns {NaturalDialoguePlan}
 */
function inactivePlan(reasons = ['inactive'], signals = []) {
  return {
    active: false,
    move: 'neutral',
    moves: [],
    energy: 'neutral',
    matchEnergy: 'neutral',
    reactionFirst: false,
    reactionOnly: false,
    allowExplain: true,
    allowQuestion: false,
    reaction: '',
    reactionAlternatives: [],
    writerBrief: '',
    structureLine: null,
    responseHints: [],
    reasons,
    signals,
    confidence: 'low',
    language: 'en',
    recentReactionIds: [],
  }
}

/**
 * Forbidden stiff assistant reactions.
 */
export const FORBIDDEN_DIALOGUE_TONES =
  /\b(i'?m\s+glad\s+you\s+(?:found\s+that\s+amusing|think\s+so)|i'?m\s+glad\s+to\s+hear|let'?s\s+explore\s+this\s+topic|how\s+can\s+i\s+help|what\s+would\s+you\s+like\s+to\s+(?:discuss|talk)|is\s+there\s+anything\s+else|thank\s+you\s+for\s+sharing\s+your\s+(?:feedback|thoughts)|i\s+appreciate\s+your\s+(?:enthusiasm|input))\b/i

/**
 * Build writer brief for the dialogue move.
 * @param {NaturalDialoguePlan} plan
 */
function buildWriterBrief(plan) {
  if (!plan.active) return ''
  const alts = (plan.reactionAlternatives || []).slice(0, 3).map((a) => `«${a}»`).join(' · ')
  return [
    'NATURAL DIALOGUE ENGINE (dopo Intent/Mode, prima di WriterDirectives): le conversazioni sono mosse, non solo informazioni.',
    `Move=${plan.move} · Energy=${plan.energy} → match=${plan.matchEnergy} · ReactionOnly=${plan.reactionOnly ? 'yes' : 'no'}.`,
    'Check interno: «What is happening between two people right now?» — NON «What information is being requested?»',
    'Priorità: Reaction → Connection → Conversation → Information.',
    `Reagisci PRIMA (tono tipo: «${plan.reaction}»)${alts ? ` · alternative: ${alts}` : ''}.`,
    plan.reactionOnly
      ? 'A volte basta UNA reazione genuina. Niente spiegazione, niente lezione, niente domanda obbligatoria.'
      : 'Apri con la reazione; poi connessione; solo dopo, se serve, conversazione/informazione.',
    `Specchia l’energia con delicatezza (${plan.matchEnergy}) — mai esagerare, mai fingere entusiasmo.`,
    'VIETATO: “I’m glad you found that amusing.” / “I’m glad you think so.” / “Let’s explore this topic.” / helpdesk.',
    plan.language === 'en' ? 'Reply in English.' : 'Rispondi in italiano.',
    'NON citare Natural Dialogue Engine / lo stage.',
  ].join(' ')
}

/**
 * @param {NaturalDialoguePlan} plan
 */
function structureLineFor(plan) {
  if (!plan.active) return null
  if (plan.reactionOnly) {
    return `Natural Dialogue → move=${plan.move}: reazione genuina (basta così)`
  }
  return `Natural Dialogue → move=${plan.move}: Reaction → Connection → Conversation → Info`
}

/**
 * Build Natural Dialogue plan.
 * @param {object} [input]
 * @returns {NaturalDialoguePlan}
 */
export function buildNaturalDialoguePlan(input = {}) {
  const msg = normalize(input.userMessage || '')
  const turns = normalizeTurns(input.messages)
  const lang = resolveLang(input)
  const session = input.session || null
  const recentReactionIds = Array.isArray(session?.recentReactionIds)
    ? session.recentReactionIds.map(String).slice(-12)
    : Array.isArray(input.recentReactionIds)
      ? input.recentReactionIds.map(String).slice(-12)
      : []

  if (DISTRESS.test(msg)) {
    return inactivePlan(['distress'], ['distress'])
  }

  const classified = classifyDialogueMoves(msg, lang)
  const move = primaryMove(classified.moves)
  const social = input.socialConversation?.plan || input.socialConversation || null
  const intent = input.conversationIntent?.plan || input.conversationIntent || null
  const expects = intent?.inference?.expects || intent?.expects || ''

  // Pure info asks without dialogue cues → inactive (WriterDirectives / info path)
  if (
    (move === 'informational' || move === 'neutral') &&
    INFO_ASK.test(msg) &&
    !social?.isSocial
  ) {
    return inactivePlan(['informational'], ['info_ask'])
  }

  if (classified.score < 1.0 && move === 'neutral' && !social?.isSocial) {
    return inactivePlan(['low_signal'], classified.signals)
  }

  const energy = MOVE_PATTERNS[move]?.energy || 'neutral'
  const matched = matchEnergy(energy, modeEnergy(input))
  const bias = MOVE_PATTERNS[move]?.reactionOnlyBias ?? 0.3
  const words = msg.split(/\s+/).filter(Boolean).length
  const shortBeat = words <= 6
  const reactionOnly =
    bias >= 0.75 ||
    (shortBeat && bias >= 0.55) ||
    move === 'laughter' ||
    move === 'agreement' ||
    move === 'gratitude' ||
    move === 'reflection' ||
    move === 'silence' ||
    move === 'conversation_pause'

  // Companionship / presence modes favor reaction-first even more
  const companionship =
    expects === 'companionship' ||
    expects === 'presence' ||
    social?.isSocial ||
    /companionship|presence|social|conversation/i.test(
      String(input.behavior?.behavior || input.behavior?.plan?.behavior || ''),
    )

  const salt = [msg, move, recentReactionIds.join(','), String(turns.length)].join('|')
  const picked = selectReaction({ move, lang, recentReactionIds, salt })

  /** @type {NaturalDialoguePlan} */
  const plan = {
    active: true,
    move,
    moves: classified.moves,
    energy,
    matchEnergy: matched,
    reactionFirst: true,
    reactionOnly: Boolean(reactionOnly || (companionship && shortBeat && bias >= 0.45)),
    allowExplain: !(reactionOnly || (companionship && shortBeat && bias >= 0.45)),
    allowQuestion: false,
    reaction: picked.chosen.text,
    reactionAlternatives: picked.alternatives,
    writerBrief: '',
    structureLine: null,
    responseHints: [
      'Reagisci prima di spiegare.',
      'Reaction → Connection → Conversation → Information.',
      reactionOnly || (companionship && shortBeat)
        ? 'A volte basta una sola reazione genuina.'
        : 'Dopo la reazione, connetti — non fare lezione.',
      'Specchia l’energia senza esagerare.',
      'Check: what is happening between two people right now?',
    ],
    reasons: [
      `move_${move}`,
      `energy_${energy}`,
      `match_${matched}`,
      reactionOnly ? 'reaction_only' : 'reaction_first',
      `lang_${lang}`,
      ...classified.signals.slice(0, 3),
    ],
    signals: classified.signals,
    confidence: classified.score >= 3 ? 'high' : classified.score >= 1.5 ? 'medium' : 'low',
    language: lang,
    recentReactionIds: [...recentReactionIds, picked.chosen.id].slice(-12),
  }

  plan.writerBrief = buildWriterBrief(plan)
  plan.structureLine = structureLineFor(plan)
  return plan
}

/**
 * Persist recent reactions for anti-repetition.
 * @param {object | null | undefined} session
 * @param {NaturalDialoguePlan | null | undefined} plan
 */
export function persistRecentReactions(session, plan) {
  if (!session || !plan?.active || !plan.reaction) return
  const prev = Array.isArray(session.recentReactionIds) ? session.recentReactionIds : []
  const id = plan.recentReactionIds?.[plan.recentReactionIds.length - 1]
  session.recentReactionIds = [...prev, id || plan.reaction].filter(Boolean).slice(-12)
}

/**
 * @param {NaturalDialoguePlan | null | undefined} plan
 */
export function formatNaturalDialogueForWriter(plan) {
  if (!plan?.active || !plan.writerBrief) return ''
  const hints = (plan.responseHints || []).map((h) => `- ${h}`).join('\n')
  return `══════════════════════════════════════
NATURAL DIALOGUE ENGINE (PRE-DIRECTIVES, INVISIBILE)
══════════════════════════════════════
Move=${plan.move} · Moves=${(plan.moves || []).join(', ') || '—'}
Energy=${plan.energy} → match=${plan.matchEnergy}
ReactionFirst=${plan.reactionFirst ? 'yes' : 'no'} · ReactionOnly=${plan.reactionOnly ? 'yes' : 'no'}
Suggested reaction: «${plan.reaction}»

${plan.writerBrief}

Hints:
${hints}

Regole: mosse conversazionali · reazione prima dell’info · ritmo umano · non citare lo stage.`.trim()
}

/**
 * @param {NaturalDialoguePlan | null | undefined} plan
 * @returns {string[]}
 */
export function naturalDialogueStructureHints(plan) {
  if (!plan?.active) return []
  /** @type {string[]} */
  const lines = [
    plan.structureLine || 'Natural Dialogue → Reaction → Connection → Conversation → Information',
  ]
  if (plan.reactionOnly) {
    lines.push('Basta una reazione genuina — niente lezione/domanda')
  } else {
    lines.push('Apri con reazione umana; info solo se serve dopo')
  }
  lines.push(`Move=${plan.move}; match energy=${plan.matchEnergy}`)
  return lines
}

/**
 * Soft draft check for stiff assistant tones when dialogue is active.
 * @param {string} draft
 * @param {NaturalDialoguePlan | null | undefined} plan
 */
export function draftViolatesNaturalDialogue(draft, plan) {
  if (!plan?.active) return false
  const text = String(draft || '')
  if (FORBIDDEN_DIALOGUE_TONES.test(text)) return true
  if (plan.reactionOnly && text.split(/\s+/).length > 40) return true
  if (plan.reactionOnly && /[?？]\s*$/.test(text.trim())) return true
  return false
}

/**
 * List of supported dialogue moves (docs / validation).
 */
export const DIALOGUE_MOVES = Object.keys(MOVE_PATTERNS).filter(
  (m) => m !== 'informational' && m !== 'neutral',
)

/**
 * @param {object} [input]
 * @returns {{ plan: NaturalDialoguePlan, context: string }}
 */
export function runNaturalDialogueEngine(input = {}) {
  try {
    const plan = buildNaturalDialoguePlan(input)
    persistRecentReactions(input.session, plan)
    return {
      plan,
      context: formatNaturalDialogueForWriter(plan),
    }
  } catch {
    return {
      plan: inactivePlan(['fail_soft'], ['fail_soft']),
      context: '',
    }
  }
}
