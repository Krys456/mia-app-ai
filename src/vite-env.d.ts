/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_API_BASE_URL?: string
  readonly VITE_PRIVACY_CONTACT_EMAIL?: string
  readonly VITE_MEMORY_MANAGE_UI?: string
  readonly VITE_BUILD_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Injected by vite.config.ts from VERCEL_GIT_COMMIT_SHA (short) or "dev". */
declare const __SHINKAIDO_BUILD_ID__: string
