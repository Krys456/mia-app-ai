/**
 * Alias entry for Conversation Critic Engine.
 * Implementation lives in conversation-critic.js (backward-compatible exports).
 */
export {
  scoreConversationDraft,
  evaluateRewriteThresholds,
  critiqueConversationDraft,
  critiqueAgainstPlanner,
  draftViolatesConversationCritic,
  draftNeedsConversationCriticRewrite,
  runConversationCriticEngine,
  INTERNAL_QUESTIONS,
  REWRITE_GOALS,
  GOLDEN_RULE,
} from './conversation-critic.js'
