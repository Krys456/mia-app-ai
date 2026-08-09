export { TOPIC_LIBRARY, COMFORT_TRAP_TOPICS, type TopicSeed, type TopicCategory } from './topicLibrary'
export {
  createEmptyMemory,
  rememberAssistantMessage,
  rebuildMemoryFromMessages,
  applyPivotSuppression,
  recentTopicIds,
  type TopicMemory,
  type TopicMemoryEntry,
  MEMORY_WINDOW,
} from './topicMemory'
export {
  scoreNovelty,
  hasTalkedAboutSimilarRecently,
  SIMILARITY_REWRITE_THRESHOLD,
  NOVELTY_FLOOR,
  type NoveltyReport,
} from './novelty'
export { detectRepetitionSignals, type RepetitionSignalMatch } from './userSignals'
export {
  generateDiverseReply,
  buildDiversitySystemAddon,
  type DiversityEngineResult,
  type DiversityGenerateInput,
} from './engine'
