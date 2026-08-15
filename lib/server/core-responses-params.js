/**
 * Build the single-shot Core `responses.create` payload.
 *
 * Capability rule (verified against OpenAI API):
 * GPT-5.6 family rejects `temperature: 0.85` unless `reasoning.effort` is `"none"`.
 * GPT-5.4 accepts `temperature: 0.85` with no reasoning parameter (default effort none).
 *
 * Keep this capability-based so Sol / alias / Terra / Luna share one path.
 */

/**
 * @param {string} model
 * @returns {boolean}
 */
export function modelNeedsReasoningNoneForTemperature(model) {
  const id = String(model || '')
    .trim()
    .toLowerCase()
  // gpt-5.6, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, dated snapshots…
  return /^gpt-5\.6(\b|-|$)/.test(id)
}

/**
 * @param {{
 *   model: string
 *   instructions: string
 *   maxOutputTokens: number
 *   input: unknown
 *   temperature?: number
 * }} options
 */
export function buildCoreResponsesCreateParams({
  model,
  instructions,
  maxOutputTokens,
  input,
  temperature = 0.85,
}) {
  /** @type {Record<string, unknown>} */
  const params = {
    model,
    instructions,
    temperature,
    max_output_tokens: maxOutputTokens,
    stream: false,
    input,
  }

  if (modelNeedsReasoningNoneForTemperature(model)) {
    params.reasoning = { effort: 'none' }
  }

  return params
}
