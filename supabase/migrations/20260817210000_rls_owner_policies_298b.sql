-- #298B — RLS enablement (deny-by-default for direct PostgREST)
--
-- ARCHITECTURE (closed beta):
--   browser → ShinkAIdo API → server JWT verify → canonical auth.uid()
--   → service-role Supabase client → owner-scoped server queries
--
-- The browser does NOT query public.users / memories / conversations /
-- messages / settings directly. Service role bypasses RLS; application
-- APIs are the ownership boundary (#298A).
--
-- LIVE STATE (manually verified):
--   RLS already ENABLED on all five tables; zero policies.
--   That deny-by-default PostgREST posture is intentional and desired.
--
-- Earlier repository schema migrations do NOT enable RLS. This migration
-- therefore ENABLE ROW LEVEL SECURITY on all five tables so a fresh
-- environment reconstructed from repo migrations matches live.
-- ENABLE is idempotent when RLS is already on (no live behavior change).
--
-- INTENTIONALLY NOT SHIPPED:
--   Authenticated PostgREST owner policies (SELECT/INSERT/UPDATE/DELETE).
--   They are unnecessary for the current server-API architecture and would
--   expand the direct DB attack surface (e.g. messages.user_id = auth.uid()
--   while conversation_id references another user's conversation).
--   Future direct client table access requires a separate security-reviewed
--   migration.
--
-- This migration:
--   - ENABLES RLS on all five tables
--   - Does NOT DISABLE or FORCE RLS
--   - Does NOT CREATE POLICY
--   - Does NOT DROP POLICY (does not touch unknown/operator policies)
--
-- DO NOT apply automatically. Manual review + apply required.

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- Residual (future direct-client policies only — not implemented here):
-- public.messages has user_id and conversation_id. Any future INSERT/UPDATE
-- policy must require BOTH message.user_id = auth.uid() AND that the
-- referenced conversation belongs to auth.uid(). Deferred: table unused.
--
-- Residual: public.mark_memories_used(uuid[]) updates by id only; server
-- invokes it via service role after owner-scoped search (unchanged).
