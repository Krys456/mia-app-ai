# #335A — Brand artwork slots (Washi Dojo)

Reserved filenames for authored assets (do **not** invent placeholders):

| File | Role | Approx budget |
|------|------|----------------|
| `shinkaido-enso-hero.svg` | Large sumi Ensō for Home | ≤20KB |
| `shinkaido-sumi-mountains.svg` | Landscape wash behind Ensō | ≤25KB |
| `shinkaido-vermilion-sun.svg` | Restrained sun / hanko accent | ≤6KB |

Until authored files land, `HomeAtmosphere` keeps empty `data-slot` nodes and
reuses the existing compact `EnsoMark` in chrome / current Home.

Existing assets to keep:

- `/public/shinkaido-mark.svg` — favicon / PWA mark
- `/public/shinkaido-logo.svg` — lockup
- `src/components/EnsoMark.tsx` — in-app mark
