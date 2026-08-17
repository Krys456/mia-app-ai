/**
 * Build the single-shot Core `responses.create` payload.
 *
 * Capability mapping (verified against OpenAI + Preview failure mode):
 * - GPT-5.4: `temperature: 0.85`, no `reasoning` (API default effort none).
 * - GPT-5.6 family (sol / alias / terra / luna): omit `temperature` entirely
 *   (non-default temperature is rejected), and set `reasoning: { effort: "none" }`
 *   so A/B stays comparable to GPT-5.4's default none effort.
 *
 * Do not set `temperature: undefined` — omit the key so the SDK cannot serialize it.
 */

/**
 * @param {string} model
 * @returns {boolean}
 */
export function isGpt56FamilyModel(model) {
  const id = String(model || '')
    .trim()
    .toLowerCase()
  // gpt-5.6, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, dated snapshots…
  return /^gpt-5\.6(\b|-|$)/.test(id)
}

/** @deprecated use isGpt56FamilyModel */
export function modelNeedsReasoningNoneForTemperature(model) {
  return isGpt56FamilyModel(model)
}

/**
 * @param {{
 *   model: string
 *   instructions: string
 *   maxOutputTokens: number
 *   input: unknown
 *   temperature?: number
 *   tools?: unknown[]
 *   toolChoice?: unknown
 * }} options
 */
export function buildCoreResponsesCreateParams({
  model,
  instructions,
  maxOutputTokens,
  input,
  temperature = 0.85,
  tools,
  toolChoice,
}) {
  /** @type {Record<string, unknown>} */
  const params = {
    model,
    instructions,
    max_output_tokens: maxOutputTokens,
    stream: false,
    input,
  }

  if (isGpt56FamilyModel(model)) {
    // Omit temperature entirely — do not assign undefined.
    params.reasoning = { effort: 'none' }
  } else {
    params.temperature = temperature
  }

  // Optional hosted tools (e.g. image_generation / web_search). Never invent a second conversational model.
  if (Array.isArray(tools) && tools.length > 0) {
    params.tools = tools
  }

  // Optional tool_choice (e.g. force web_search on explicit "Cerca sul web").
  if (toolChoice != null) {
    params.tool_choice = toolChoice
  }

  return params
}
