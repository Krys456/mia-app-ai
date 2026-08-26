/**
 * #387B — Privacy-safe worker heartbeat upserts (Edge).
 *
 * Operational metadata only. Never write user content, endpoints, tokens,
 * titles, briefing text, or secrets into worker_heartbeats.
 *
 * Heartbeat write failures must never throw to the caller — workers continue.
 */

export const WORKER_NAME_REMINDER_PUSH = 'reminder-push-dispatch'
export const WORKER_NAME_MORNING_BRIEFING = 'morning-briefing-dispatch'

export type WorkerHeartbeatStatus = 'running' | 'success' | 'failure' | 'disabled'

type HeartbeatClient = {
  from: (table: string) => {
    upsert: (
      values: Record<string, unknown>,
      options?: { onConflict?: string },
    ) => Promise<{ error: { message?: string; code?: string } | null }>
  }
}

type LogFn = (fields: Record<string, unknown>) => void

const ALLOWED_COLUMNS = new Set([
  'worker_name',
  'last_started_at',
  'last_success_at',
  'last_failure_at',
  'last_status',
  'last_duration_ms',
  'last_run_id',
  'last_error_code',
  'updated_at',
])

const FORBIDDEN_KEYS = [
  'userId',
  'user_id',
  'email',
  'title',
  'endpoint',
  'payload',
  'prompt',
  'response',
  'token',
  'authorization',
  'auth',
  'p256dh',
  'calendar',
  'gmail',
  'briefing',
]

/**
 * Strip anything that is not an allowlisted operational column.
 * Defense-in-depth against accidental PII leakage into upsert payloads.
 */
export function sanitizeHeartbeatPatch(
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (!ALLOWED_COLUMNS.has(key)) continue
    if (FORBIDDEN_KEYS.some((f) => key.toLowerCase().includes(f) && key !== 'last_status')) {
      continue
    }
    out[key] = value
  }
  return out
}

/**
 * Upsert current worker health. Never throws.
 */
export async function writeWorkerHeartbeatSafe(
  supabase: HeartbeatClient | null | undefined,
  patch: Record<string, unknown>,
  logSafe?: LogFn,
): Promise<{ ok: boolean }> {
  if (!supabase) {
    logSafe?.({ code: 'heartbeat_write_failed', reason: 'no_client', ok: false })
    return { ok: false }
  }
  try {
    const safe = sanitizeHeartbeatPatch(patch)
    if (typeof safe.worker_name !== 'string' || !safe.worker_name) {
      logSafe?.({ code: 'heartbeat_write_failed', reason: 'missing_worker_name', ok: false })
      return { ok: false }
    }
    safe.updated_at = new Date().toISOString()
    const { error } = await supabase.from('worker_heartbeats').upsert(safe, {
      onConflict: 'worker_name',
    })
    if (error) {
      logSafe?.({
        code: 'heartbeat_write_failed',
        reason: 'db_error',
        errorCode: typeof error.code === 'string' ? error.code.slice(0, 64) : undefined,
        ok: false,
      })
      return { ok: false }
    }
    return { ok: true }
  } catch {
    logSafe?.({ code: 'heartbeat_write_failed', reason: 'exception', ok: false })
    return { ok: false }
  }
}

export async function markWorkerStarted(
  supabase: HeartbeatClient | null | undefined,
  workerName: string,
  runId: string,
  logSafe?: LogFn,
) {
  const now = new Date().toISOString()
  return writeWorkerHeartbeatSafe(
    supabase,
    {
      worker_name: workerName,
      last_started_at: now,
      last_status: 'running' satisfies WorkerHeartbeatStatus,
      last_run_id: runId,
    },
    logSafe,
  )
}

export async function markWorkerSuccess(
  supabase: HeartbeatClient | null | undefined,
  workerName: string,
  runId: string,
  durationMs: number,
  logSafe?: LogFn,
) {
  const now = new Date().toISOString()
  return writeWorkerHeartbeatSafe(
    supabase,
    {
      worker_name: workerName,
      last_success_at: now,
      last_status: 'success' satisfies WorkerHeartbeatStatus,
      last_duration_ms: Math.max(0, Math.floor(durationMs)),
      last_error_code: null,
      last_run_id: runId,
    },
    logSafe,
  )
}

export async function markWorkerFailure(
  supabase: HeartbeatClient | null | undefined,
  workerName: string,
  runId: string,
  durationMs: number,
  errorCode: string,
  logSafe?: LogFn,
) {
  const now = new Date().toISOString()
  const code = String(errorCode || 'worker_failure')
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .slice(0, 64)
  return writeWorkerHeartbeatSafe(
    supabase,
    {
      worker_name: workerName,
      last_failure_at: now,
      last_status: 'failure' satisfies WorkerHeartbeatStatus,
      last_duration_ms: Math.max(0, Math.floor(durationMs)),
      last_error_code: code,
      last_run_id: runId,
    },
    logSafe,
  )
}

export async function markWorkerDisabled(
  supabase: HeartbeatClient | null | undefined,
  workerName: string,
  runId: string,
  durationMs: number,
  logSafe?: LogFn,
) {
  const now = new Date().toISOString()
  return writeWorkerHeartbeatSafe(
    supabase,
    {
      worker_name: workerName,
      last_started_at: now,
      last_status: 'disabled' satisfies WorkerHeartbeatStatus,
      last_duration_ms: Math.max(0, Math.floor(durationMs)),
      last_error_code: null,
      last_run_id: runId,
    },
    logSafe,
  )
}
