-- #298B — Ownership RLS policies (defense-in-depth)
--
-- LIVE STATE (manually verified before this migration):
--   RLS is ALREADY ENABLED on public.users, memories, conversations,
--   messages, and settings.
--   Zero policies existed (deny-by-default for non-service-role clients).
--
-- This migration:
--   - Does NOT disable RLS
--   - Does NOT run ALTER TABLE ... ENABLE ROW LEVEL SECURITY
--     (already true in live; avoid redundant / noisy production DDL)
--   - Adds owner-scoped policies for authenticated (incl. anonymous) users
--   - Uses DROP POLICY IF EXISTS only for #298B-named policies, then CREATE
--
-- Service-role server APIs bypass RLS and remain the Memory write path
-- (browser → /api/* → JWT → service role). RLS protects direct PostgREST
-- access with the anon/authenticated key.
--
-- DO NOT apply automatically. Manual review + apply required.

-- ---------------------------------------------------------------------------
-- public.memories
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS memories_select_own ON public.memories;
CREATE POLICY memories_select_own
  ON public.memories
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS memories_insert_own ON public.memories;
CREATE POLICY memories_insert_own
  ON public.memories
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS memories_update_own ON public.memories;
CREATE POLICY memories_update_own
  ON public.memories
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS memories_delete_own ON public.memories;
CREATE POLICY memories_delete_own
  ON public.memories
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- public.users
-- Bridge rows are inserted by service-role ensureAuthUserRow (id = auth.uid()).
-- Authenticated clients may only read/update their own row — no client INSERT.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS users_select_own ON public.users;
CREATE POLICY users_select_own
  ON public.users
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS users_update_own ON public.users;
CREATE POLICY users_update_own
  ON public.users
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ---------------------------------------------------------------------------
-- public.conversations (unused by app — defensive)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS conversations_select_own ON public.conversations;
CREATE POLICY conversations_select_own
  ON public.conversations
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS conversations_insert_own ON public.conversations;
CREATE POLICY conversations_insert_own
  ON public.conversations
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS conversations_update_own ON public.conversations;
CREATE POLICY conversations_update_own
  ON public.conversations
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS conversations_delete_own ON public.conversations;
CREATE POLICY conversations_delete_own
  ON public.conversations
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- public.messages (unused by app — defensive)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS messages_select_own ON public.messages;
CREATE POLICY messages_select_own
  ON public.messages
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS messages_insert_own ON public.messages;
CREATE POLICY messages_insert_own
  ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS messages_update_own ON public.messages;
CREATE POLICY messages_update_own
  ON public.messages
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS messages_delete_own ON public.messages;
CREATE POLICY messages_delete_own
  ON public.messages
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- public.settings (unused by app — defensive; app settings use localStorage)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS settings_select_own ON public.settings;
CREATE POLICY settings_select_own
  ON public.settings
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS settings_insert_own ON public.settings;
CREATE POLICY settings_insert_own
  ON public.settings
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS settings_update_own ON public.settings;
CREATE POLICY settings_update_own
  ON public.settings
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS settings_delete_own ON public.settings;
CREATE POLICY settings_delete_own
  ON public.settings
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Residual note: public.mark_memories_used(uuid[]) updates by id only.
-- Server invokes it via service role after owner-scoped search; left unchanged
-- in #298B to avoid Memory semantics risk (service role has no auth.uid()).
