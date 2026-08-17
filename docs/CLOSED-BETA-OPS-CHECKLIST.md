# ShinkAIdo Closed Beta — Ops checklist (#298D)

Manual gates before inviting external testers.
**Never paste secret values into this file or into chat logs.**

> Revisit `noindex` / `robots.txt` before **public** launch.

---

## A. Environment (Preview + Production)

### REQUIRED

| Variable | Notes |
|----------|--------|
| `OPENAI_API_KEY` | Server only |
| `VITE_SUPABASE_URL` | Client |
| `VITE_SUPABASE_ANON_KEY` | Client anon key |
| `SUPABASE_URL` | Server |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only — never `VITE_` |
| `UPSTASH_REDIS_REST_URL` | Required on Vercel (fail-closed without) |
| `UPSTASH_REDIS_REST_TOKEN` | Required on Vercel |
| `VITE_PRIVACY_CONTACT_EMAIL` | Support mailto (“Segnala un problema”) |

### OPTIONAL

| Variable | Notes |
|----------|--------|
| `OPENAI_MODEL` | Default via `resolveChatModel` |
| `CORS_ALLOWED_ORIGINS` | Extra origins (custom domains) |
| `VITE_MEMORY_MANAGE_UI` | Set `0` to hide Memory Manage |
| `VITE_BUILD_ID` | Optional; prefer auto `VERCEL_GIT_COMMIT_SHA` |

### DEV ONLY / restricted

| Variable | Notes |
|----------|--------|
| `RATE_LIMIT_DEV_INMEMORY` | Never on Vercel |
| `LAIFE_MEMORY_ADMIN_SECRET` | Preview/local memory-test only |
| `VITE_DEV_API_PROXY` | Local Vite → API |
| `VITE_API_BASE_URL` | Leave empty on Vercel (same-origin `/api`) |

---

## B. Vercel closed-beta gate

- [ ] Preview env vars verified
- [ ] Production env vars verified
- [ ] **Deployment Protection / password** enabled for the deployment testers use
- [ ] Production build succeeds
- [ ] Function logs available
- [ ] Custom-domain CORS verified if a custom domain is used
- [ ] `/api/memory-test` returns **404** in Production
- [ ] Beta build ID visible in Privacy e dati
- [ ] Support mailto works (“Segnala un problema”)

Access restriction is **manual via Vercel**. Do not confuse with `noindex`.

---

## C. Supabase

- [ ] Anonymous Auth enabled
- [ ] RLS **enabled** on: `users`, `memories`, `conversations`, `messages`, `settings`
- [ ] **Zero** client policies (deny-by-default PostgREST)
- [ ] Memory list / edit / delete / delete-all work via server APIs

No SQL migration in #298D.

---

## D. Upstash

- [ ] Preview Redis configured
- [ ] Production Redis configured
- [ ] Normal chat works under limit
- [ ] 429 surfaces Italian recovery copy
- [ ] Missing/misconfigured limiter → fail-closed **503**
- [ ] Dashboard checked for unexpected spikes

---

## E. OpenAI

- [ ] Production key configured
- [ ] Usage / spend visibility checked
- [ ] Budget / usage alert capability reviewed
- [ ] Chat works
- [ ] Web search + Fonti works
- [ ] Image generation works
- [ ] TTS / Voice works
- [ ] File upload works

Do not change model or Core for ops checks.

---

## F. Product smoke (manual)

- [ ] First-run HomeHero + hint
- [ ] First message send
- [ ] New Chat confirm mentions Memory preserved
- [ ] Settings → Memoria / Privacy e dati (Italian)
- [ ] Error Riferimento on a failed paid call (when applicable)
- [ ] Washi / Sumi
- [ ] Android Chrome narrow + keyboard
- [ ] #298A / #298B / #298C regressions spot-check

---

## G. GO / NO-GO

After #298D Preview acceptance and this checklist:

1. Internal smoke (2–3 people)
2. Invite external testers with `CLOSED-BETA-INVITE.md`
3. Explicit **GO** or **NO-GO** decision
