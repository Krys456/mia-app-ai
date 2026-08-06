# LAIfe

**Your AI, Your Life.** — a warm, human-like AI companion UI.

## Stack

- Vite + React 19 + TypeScript
- Official **LAIfe Theme** by default (black + neon blue / cyan / purple / pink)
- Full theme personalization: built-in themes + custom theme creator
- Chat shell with sticky header & fixed composer
- Slide-out settings drawer (theme + assistant personalization)
- Local demo replies shaped by a configurable system personality prompt

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
