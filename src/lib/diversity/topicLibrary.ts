/** Large internal topic library for LAIfe diversity steering. */

export type TopicCategory =
  | 'science'
  | 'history'
  | 'technology'
  | 'psychology'
  | 'nature'
  | 'space'
  | 'music'
  | 'cinema'
  | 'books'
  | 'business'
  | 'creativity'
  | 'language'
  | 'sports'
  | 'food'
  | 'travel'
  | 'architecture'
  | 'economics'
  | 'philosophy'
  | 'curiosities'
  | 'future'
  | 'culture'
  | 'relationships'
  | 'humor'
  | 'ai'
  | 'human-behavior'
  | 'random-facts'

/** Topics the engine actively avoids looping on when user signals boredom. */
export const COMFORT_TRAP_TOPICS = [
  'habits',
  'routines',
  'productivity',
  'wellness',
  'daily-choices',
  'small-steps',
  'self-care',
  'morning-routine',
] as const

export interface TopicSeed {
  id: string
  category: TopicCategory
  label: string
  /** Concepts / keywords associated with this topic */
  concepts: string[]
  /** Metaphor banks — rotate, never reuse consecutively */
  metaphors: string[]
  /** Short angles the assistant can open with */
  angles: string[]
  /** Local demo reply snippets (markdown-friendly) */
  sparks: string[]
}

export const TOPIC_LIBRARY: TopicSeed[] = [
  {
    id: 'science-light',
    category: 'science',
    label: 'Science',
    concepts: ['experiment', 'atom', 'gravity', 'dna', 'entropy', 'hypothesis'],
    metaphors: ['like light through a prism', 'like a chain reaction', 'like a silent laboratory'],
    angles: [
      'Wild science detour?',
      'Here’s a tiny fact that rewires how you see ordinary things:',
    ],
    sparks: [
      'Octopuses have three hearts — and two of them stop when they swim. Biology is weirdly dramatic.',
      'Your bones are constantly remodeling — you’re not a statue, you’re a renovation site.',
    ],
  },
  {
    id: 'history-echo',
    category: 'history',
    label: 'History',
    concepts: ['empire', 'archive', 'revolution', 'trade-route', 'artifact', 'timeline'],
    metaphors: ['like dust on an old map', 'like an echo in a stone hall', 'like a letter never sent'],
    angles: ['History side-quest?', 'A moment from the past that still feels current:'],
    sparks: [
      'In 1911, the Mona Lisa was stolen — and more people visited the empty wall than the painting itself.',
      'Coffeehouses in 17th-century London were called “penny universities” — ideas for the price of a cup.',
    ],
  },
  {
    id: 'tech-edge',
    category: 'technology',
    label: 'Technology',
    concepts: ['protocol', 'chip', 'network', 'firmware', 'latency', 'interface'],
    metaphors: ['like a city of switches', 'like invisible scaffolding', 'like a quiet engine under glass'],
    angles: ['Tech rabbit hole?', 'A small tech lens on something bigger:'],
    sparks: [
      'The first computer bug was literal — a moth stuck in a Harvard Mark II relay in 1947.',
      'Bluetooth is named after a Viking king who united Denmark — the logo is his initials in runes.',
    ],
  },
  {
    id: 'psych-depth',
    category: 'psychology',
    label: 'Psychology',
    concepts: ['bias', 'memory', 'attention', 'identity', 'narrative', 'emotion'],
    metaphors: ['like a spotlight with a mind of its own', 'like two radio stations at once', 'like a story editing itself'],
    angles: ['Psych angle for a second?', 'A mind-quirk that explains a lot:'],
    sparks: [
      'We remember unfinished tasks better than finished ones — the Zeigarnik effect. Open loops cling.',
      'Your brain predicts reality faster than it “sees” it — perception is half forecast.',
    ],
  },
  {
    id: 'nature-pulse',
    category: 'nature',
    label: 'Nature',
    concepts: ['forest', 'tide', 'migration', 'mycelium', 'weather', 'ecosystem'],
    metaphors: ['like roots trading secrets', 'like a tide deciding', 'like a canopy breathing'],
    angles: ['Nature break?', 'Something wild and real:'],
    sparks: [
      'Trees can share sugar through fungal networks — forests are more communal than they look.',
      'A single teaspoon of soil can hold more organisms than there are people on Earth.',
    ],
  },
  {
    id: 'space-wide',
    category: 'space',
    label: 'Space',
    concepts: ['orbit', 'nebula', 'light-year', 'planet', 'silence', 'horizon'],
    metaphors: ['like a lighthouse with no shore', 'like ink spilled across forever', 'like a clock that never ticks the same'],
    angles: ['Look up for a sec?', 'A space thought:'],
    sparks: [
      'There are more stars in the observable universe than grains of sand on every Earth beach — probably.',
      'On Venus a day is longer than a year. Time gets weird when you leave home.',
    ],
  },
  {
    id: 'music-wave',
    category: 'music',
    label: 'Music',
    concepts: ['tempo', 'harmony', 'silence', 'riff', 'melody', 'rhythm'],
    metaphors: ['like weather you can hear', 'like a door unlocking in the chest', 'like color made of air'],
    angles: ['Music detour?', 'A sonic thought:'],
    sparks: [
      'Silence in music isn’t empty — rests are part of the architecture.',
      'Your heartbeat syncs a little with strong rhythm. Bodies eavesdrop on songs.',
    ],
  },
  {
    id: 'cinema-frame',
    category: 'cinema',
    label: 'Cinema',
    concepts: ['frame', 'cut', 'arc', 'close-up', 'motif', 'score'],
    metaphors: ['like light trapped in a rectangle', 'like a dream with editing', 'like memory with better lighting'],
    angles: ['Cinema lens?', 'A film-shaped idea:'],
    sparks: [
      'The “Wilhelm scream” shows up in hundreds of movies — one yell became cinema folklore.',
      'Black-and-white isn’t less — it just asks your brain to paint.',
    ],
  },
  {
    id: 'books-page',
    category: 'books',
    label: 'Books',
    concepts: ['chapter', 'voice', 'plot', 'margin', 'library', 'sentence'],
    metaphors: ['like a room you carry', 'like time folded into paper', 'like a conversation that waits'],
    angles: ['Bookish turn?', 'A page-shaped spark:'],
    sparks: [
      'Some books change you not because of plot — because of the *permission* they give.',
      'Reading fiction trains empathy like a gym for other minds.',
    ],
  },
  {
    id: 'business-game',
    category: 'business',
    label: 'Business',
    concepts: ['leverage', 'incentive', 'market', 'brand', 'risk', 'signal'],
    metaphors: ['like a chessboard that keeps reshuffling', 'like weather for money', 'like a story sold at scale'],
    angles: ['Business angle?', 'A market-shaped thought:'],
    sparks: [
      'Most “overnight successes” are ten years of invisible compounding.',
      'Pricing is psychology wearing a spreadsheet costume.',
    ],
  },
  {
    id: 'creativity-spark',
    category: 'creativity',
    label: 'Creativity',
    concepts: ['draft', 'constraint', 'improv', 'collage', 'play', 'original'],
    metaphors: ['like sparks looking for dry grass', 'like remixing the weather', 'like building with borrowed light'],
    angles: ['Creative pivot?', 'A make-something thought:'],
    sparks: [
      'Constraints aren’t cages — they’re trampolines. Limits force invention.',
      'Bad first drafts are compost. Nothing grows without the messy layer.',
    ],
  },
  {
    id: 'language-play',
    category: 'language',
    label: 'Language',
    concepts: ['etymology', 'idiom', 'tone', 'dialect', 'metaphor', 'translation'],
    metaphors: ['like keys that open different rooms', 'like music made of meaning', 'like a map drawn in sound'],
    angles: ['Language rabbit hole?', 'A word-shaped curiosity:'],
    sparks: [
      '“Serendipity” comes from a Persian fairy tale — accident with good manners.',
      'In Italian, *abbiocco* is that soft sleepiness after a meal. English needs that word.',
    ],
  },
  {
    id: 'sports-motion',
    category: 'sports',
    label: 'Sports',
    concepts: ['momentum', 'team', 'form', 'endurance', 'play', 'focus'],
    metaphors: ['like geometry at full speed', 'like a storm with rules', 'like practice wearing a jersey'],
    angles: ['Sports energy?', 'A motion-shaped idea:'],
    sparks: [
      'Elite athletes rehearse failure so the body stops panicking mid-play.',
      'Flow isn’t magic — it’s skill meeting a challenge that fits just right.',
    ],
  },
  {
    id: 'food-craft',
    category: 'food',
    label: 'Food',
    concepts: ['flavor', 'ferment', 'recipe', 'spice', 'texture', 'table'],
    metaphors: ['like chemistry you can taste', 'like memory served warm', 'like culture on a plate'],
    angles: ['Food thought?', 'A flavor-shaped detour:'],
    sparks: [
      'Fermentation is controlled decay that becomes delicious — patience with microbes.',
      'Smell is ~80% of flavor. Dinner is half nostalgia.',
    ],
  },
  {
    id: 'travel-map',
    category: 'travel',
    label: 'Travel',
    concepts: ['border', 'city', 'stranger', 'horizon', 'passport', 'arrival'],
    metaphors: ['like resetting the camera lens', 'like borrowing someone else’s weather', 'like a story with new streets'],
    angles: ['Travel itch?', 'A elsewhere-shaped spark:'],
    sparks: [
      'Getting lost on purpose is a skill — cities teach better when you stop navigating every second.',
      'The best souvenirs are often sentences you didn’t expect to say.',
    ],
  },
  {
    id: 'architecture-form',
    category: 'architecture',
    label: 'Architecture',
    concepts: ['space', 'light', 'structure', 'threshold', 'skyline', 'material'],
    metaphors: ['like frozen music', 'like a body made of rooms', 'like intention you can walk through'],
    angles: ['Architecture glance?', 'A space-shaped idea:'],
    sparks: [
      'Good buildings choreograph how you feel before you notice why.',
      'Windows aren’t just glass — they’re negotiations with the outside world.',
    ],
  },
  {
    id: 'economics-flow',
    category: 'economics',
    label: 'Economics',
    concepts: ['scarcity', 'tradeoff', 'incentive', 'bubble', 'value', 'supply'],
    metaphors: ['like weather for choices', 'like a river of incentives', 'like a game with hidden rules'],
    angles: ['Economics lens?', 'A value-shaped thought:'],
    sparks: [
      'Opportunity cost is the quiet tax on every yes — what you didn’t choose still matters.',
      'Trust is an economic technology. Without it, every deal gets expensive.',
    ],
  },
  {
    id: 'philosophy-ask',
    category: 'philosophy',
    label: 'Philosophy',
    concepts: ['meaning', 'freedom', 'truth', 'self', 'ethics', 'doubt'],
    metaphors: ['like standing at the edge of a question', 'like a mirror that argues back', 'like light with opinions'],
    angles: ['Philosophy sip?', 'A question worth holding:'],
    sparks: [
      'Maybe the point isn’t answering every big question — it’s learning which ones are yours.',
      'Stoics practiced “premeditatio malorum” — imagining loss so reality hurts less. Oddly kind.',
    ],
  },
  {
    id: 'curiosities-odd',
    category: 'curiosities',
    label: 'Curiosities',
    concepts: ['oddity', 'quirk', 'anomaly', 'trivia', 'surprise', 'glitch'],
    metaphors: ['like a pebble in the shoe of reality', 'like a wink from the universe', 'like a footnote that stole the book'],
    angles: ['Random curiosity?', 'An odd little gem:'],
    sparks: [
      'Wombats produce cube-shaped poop. Evolution has a sense of humor.',
      'A jiffy is an actual unit of time — about 1/100th of a second in computing slang.',
    ],
  },
  {
    id: 'future-horizon',
    category: 'future',
    label: 'Future',
    concepts: ['forecast', 'invention', 'scenario', 'shift', 'frontier', 'tomorrow'],
    metaphors: ['like fog with headlights', 'like a door that isn’t built yet', 'like a draft of tomorrow'],
    angles: ['Future glance?', 'A tomorrow-shaped thought:'],
    sparks: [
      'The future rarely arrives as a headline — it sneaks in as a tool you stop noticing.',
      'Most “impossible” things were just early. Timing wears a disguise.',
    ],
  },
  {
    id: 'culture-weave',
    category: 'culture',
    label: 'Culture',
    concepts: ['ritual', 'symbol', 'trend', 'myth', 'style', 'belonging'],
    metaphors: ['like shared weather', 'like a costume party that never ends', 'like a language of gestures'],
    angles: ['Culture lens?', 'A culture-shaped spark:'],
    sparks: [
      'Trends are crowds teaching themselves what to want next.',
      'Every culture invents ways to say “we’re here” without words — food, clothes, jokes.',
    ],
  },
  {
    id: 'relationships-human',
    category: 'relationships',
    label: 'Relationships',
    concepts: ['trust', 'boundary', 'repair', 'presence', 'conflict', 'care'],
    metaphors: ['like two gardens sharing a fence', 'like a duet learning tempo', 'like a bridge you rebuild mid-walk'],
    angles: ['People-stuff angle?', 'A human-connection thought:'],
    sparks: [
      'Repair beats perfection. Relationships survive on how you come back, not how you never mess up.',
      'Listening is a form of generosity that costs attention, not advice.',
    ],
  },
  {
    id: 'humor-spark',
    category: 'humor',
    label: 'Humor',
    concepts: ['irony', 'timing', 'absurd', 'punchline', 'wit', 'play'],
    metaphors: ['like a sneeze of truth', 'like gravity taking a day off', 'like a plot twist in a sentence'],
    angles: ['Humor hit?', 'A lighter cut:'],
    sparks: [
      'Humor is surprise wearing comfortable shoes.',
      'If the universe has a joke, it’s that confidence and competence are only loosely related.',
    ],
  },
  {
    id: 'ai-mirror',
    category: 'ai',
    label: 'AI',
    concepts: ['model', 'pattern', 'prompt', 'alignment', 'tool', 'intelligence'],
    metaphors: ['like a mirror that improvises', 'like a library that talks back', 'like weather made of text'],
    angles: ['AI meta for a beat?', 'A machine-mind thought:'],
    sparks: [
      'I’m patterns with manners — useful, but still hungry for *your* specifics.',
      'Good AI chat isn’t magic answers — it’s collaborative thinking with better recall.',
    ],
  },
  {
    id: 'human-behavior',
    category: 'human-behavior',
    label: 'Human behavior',
    concepts: ['habit-loop', 'status', 'storytelling', 'imitation', 'impulse', 'tribe'],
    metaphors: ['like scripts we didn’t audition for', 'like gravity for social animals', 'like a dance we pretend is improvised'],
    angles: ['Human-behavior lens?', 'A people-pattern thought:'],
    sparks: [
      'We copy before we choose — imitation is the original social algorithm.',
      'Status games hide inside compliments, silence, and who speaks first.',
    ],
  },
  {
    id: 'random-facts',
    category: 'random-facts',
    label: 'Random facts',
    concepts: ['trivia', 'surprise', 'detail', 'odd-fact', 'world', 'glitch'],
    metaphors: ['like confetti from reality', 'like a side quest in plain sight', 'like a footnote that became the plot'],
    angles: ['Random fact?', 'A pocket-sized wow:'],
    sparks: [
      'Honey never spoils — archaeologists have found edible honey in ancient tombs.',
      'Bananas are berries. Strawberries aren’t. Botany loves plot twists.',
    ],
  },
]

export function getTopicById(id: string): TopicSeed | undefined {
  return TOPIC_LIBRARY.find((t) => t.id === id)
}

export function getTopicsByCategory(category: TopicCategory): TopicSeed[] {
  return TOPIC_LIBRARY.filter((t) => t.category === category)
}

export function allTopicIds(): string[] {
  return TOPIC_LIBRARY.map((t) => t.id)
}
