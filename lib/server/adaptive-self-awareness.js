/**
 * LAIfe Adaptive Self-Awareness
 *
 * Recognize when the user is giving feedback about the assistant itself
 * instead of discussing the conversation topic — then acknowledge, reflect,
 * and adapt immediately without continuing the previous topic.
 *
 * Builds on Feedback Interpretation (Conversation Preference Profile) with
 * stronger self-awareness categories and response rules.
 *
 * Invisible. Fail-soft. Advisor only — Cognitive Coordinator decides.
 */

export {
  emptyPreferenceProfile,
  sanitizePreferenceProfile,
  isDefaultPreferenceProfile,
  applyFeedbackToProfile,
  buildPreferenceProfileBrief,
  analyzeFeedbackInterpretation as analyzeAdaptiveSelfAwareness,
  formatFeedbackInterpretationForWriter as formatAdaptiveSelfAwarenessForWriter,
  runFeedbackInterpretation as runAdaptiveSelfAwareness,
  runFeedbackInterpretation,
} from './feedback-interpretation.js'
