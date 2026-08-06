# LAIfe

**Your AI, Your Life.** — a warm, human-like AI companion UI.

## Stack

- Vite + React 19 + TypeScript
- Official **LAIfe Theme** by default (black + neon blue / cyan / purple / pink)
- Full theme personalization: built-in themes + custom theme creator
- Chat shell with sticky header & fixed composer
- **Memory** page with categorized, searchable, database-backed notes
- Slide-out settings drawer (theme + assistant personalization)
- OpenAI chat via Vercel `/api/chat`

## Quick start

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
npm run preview
```

Production output is written to `dist/` (Vite default). Node **20+** required (see `.nvmrc`).

## Deploy

### Vercel

Config file: [`vercel.json`](./vercel.json) (Vite framework, `dist` output, SPA rewrites).

1. Import the GitHub repo in [Vercel](https://vercel.com/new)
2. Framework preset: **Vite** (auto-detected)
3. Build command: `npm run build`
4. Output directory: `dist`
5. Set environment variables:
   - `OPENAI_API_KEY`
   - `DATABASE_URL` (Postgres — required for Memory)
6. Deploy

CLI alternative:

```bash
npx vercel
```

### Netlify

Config file: [`netlify.toml`](./netlify.toml) (build + SPA redirect + asset caching).

1. Import the GitHub repo in [Netlify](https://app.netlify.com/start)
2. Build command: `npm run build`
3. Publish directory: `dist`
4. Deploy

CLI alternative:

```bash
npx netlify deploy --build --prod
```

Optional env vars: copy [`.env.example`](./.env.example) and set the same keys in the host’s Environment Variables UI (`VITE_*` are inlined at build time).

## Themes

Open **Settings → Theme** to:

- Use the official **LAIfe Theme** (default for every new user)
- Switch among built-in themes: Dark, Light, AMOLED Black, Ocean Blue, Forest Green, Sunset Orange, Royal Purple, Cyber Neon, Minimal White, Midnight Blue
- **Create custom themes** — name them, pick every color, preview live, save/edit/delete on this device

Preferences persist in `localStorage` (`laife.settings.v2`).

## Structure

```
src/
  components/     Header, ChatThread, Composer, SettingsDrawer, ThemeSettings
  context/        ChatProvider + ThemeProvider
  lib/            themes, personality / local reply helper
  types.ts
  App.tsx
```

## Controls

- **LAIfe logo** / **+** — new chat
- **Gear** — opens settings drawer (theme + personalization)
- Bottom composer — Enter to send, Shift+Enter for newline

Wire `sendMessage` in `ChatContext` to your LLM API when ready; `buildSystemPrompt()` in `src/lib/personality.ts` builds the assistant personality from settings.
