# Brand artwork (Washi Dojo Home)

## #335B2 — Reference-locked Home hero (primary)

| File | Role | Budget |
|------|------|--------|
| `shinkaido-home-hero.webp` | Washi decorative scene (Ensō + fire + sun + mountains) | ≤300KB |
| `shinkaido-home-hero-sumi.webp` | Sumi-compatible tint of the same scene | ≤300KB |

Notes:

- Decorative only — no UI, text, cards, or composer baked in
- Transparent edges + CSS mask so art dissolves into Home paper
- Served locally from `/brand/*` (no external URL)

## Legacy SVG pieces (#335B)

Kept for other surfaces / mark pipeline; Home hero no longer composites them live.

| File | Role | Budget |
|------|------|--------|
| `shinkaido-enso-hero.svg` | Ensō mark asset | ≤20KB |
| `shinkaido-sumi-mountains.svg` | Landscape wash asset | ≤30KB |
| `shinkaido-vermilion-sun.svg` | Sun / hanko accent | ≤6KB |

Also keep:

- `/public/shinkaido-mark.svg` — favicon / PWA mark
- `/public/shinkaido-logo.svg` — lockup
- `src/components/EnsoMark.tsx` — compact in-app mark (header)
