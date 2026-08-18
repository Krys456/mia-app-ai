/**
 * #303A — Future NL → ReminderProposal extension point (documentation only).
 *
 * Do NOT wire arbitrary reminder detection into Core / responses.create here.
 *
 * Safe future integration sketch (separate PR):
 * 1. User says "Ricordami domani alle 17…"
 * 2. A dedicated propose path (tool or isolated parser) returns ReminderProposal
 * 3. UI shows Confirm / Modifica / Annulla (same as ReminderManage)
 * 4. Only Conferma calls createReminderFromProposal()
 *
 * Never persist from an LLM guess without that confirm step.
 */

export {}
