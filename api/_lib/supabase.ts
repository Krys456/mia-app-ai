/**
 * Compatibility re-export — runtime source of truth is lib/server/supabase.js
 * (plain JS so Vercel ESM can resolve the module at runtime).
 */

export {
  getServiceSupabase,
  validateSupabaseStartupEnv,
} from '../../lib/server/supabase.js'
