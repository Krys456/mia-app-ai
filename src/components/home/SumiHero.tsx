/**
 * #335B — Composed sumi-e hero scene: Ensō + mountains + vermilion sun.
 * Inline SVG (decorative) so theme ink + vermilion render without mask/img issues.
 */

import './SumiHero.css'

export function SumiHero() {
  return (
    <div className="sumi-hero motion-enso-reveal" aria-hidden="true" data-home="sumi-hero">
      {/* Mountains — behind Ensō */}
      <svg
        className="sumi-hero__mountains"
        viewBox="0 0 640 280"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
      >
        <defs>
          <linearGradient id="sumiMtnFadeL" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="currentColor" stopOpacity="0" />
            <stop offset="0.18" stopColor="currentColor" stopOpacity="1" />
            <stop offset="0.82" stopColor="currentColor" stopOpacity="1" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="sumiMtnFadeV" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="1" />
            <stop offset="0.72" stopColor="currentColor" stopOpacity="0.55" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
          <mask id="sumiMtnEdge">
            <rect width="640" height="280" fill="url(#sumiMtnFadeL)" />
          </mask>
        </defs>
        <g mask="url(#sumiMtnEdge)" fill="url(#sumiMtnFadeV)">
          <path
            opacity="0.32"
            d="M0 168 C48 152 78 128 118 122 C148 117 172 132 198 138 C236 148 268 118 308 112 C348 106 378 128 416 136 C458 146 498 118 540 124 C578 130 610 148 640 158 L640 280 L0 280 Z"
          />
          <path
            opacity="0.48"
            d="M0 196 C42 178 86 148 132 142 C176 136 208 162 248 168 C292 176 328 146 372 140 C416 134 452 158 496 166 C536 174 580 152 640 168 L640 280 L0 280 Z"
          />
          <path
            opacity="0.62"
            d="M0 228 C28 214 56 198 92 194 C124 190 148 206 178 210 C214 216 246 196 282 192 C322 188 352 208 388 214 C428 222 462 204 500 208 C536 212 572 224 608 230 C624 233 640 236 640 236 L640 280 L0 280 Z"
          />
        </g>
      </svg>

      {/* Hero Ensō — organic brush ring, open upper-right */}
      <svg
        className="sumi-hero__enso"
        viewBox="0 0 240 240"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
      >
        <path
          fill="currentColor"
          d="M171.2 54.8c13.4 7.8 24.6 19.8 31.2 33.8 7.2 15.2 9.4 32.4 7.2 48.8-2.2 16.8-9.8 32.6-21.2 44.6-11.2 11.8-25.8 19.8-41.4 23.2-15.8 3.4-32.4 1.8-47.2-4.6-14.6-6.4-27.2-17.4-35.4-31.2-8.4-14.2-12.2-30.8-10.8-47 1.4-16.4 8.6-32 20-44.2 11.2-12 26.2-20.2 42.4-23.2 9.6-1.8 19.6-1.4 29 1.2 4.6 1.2 9 3.2 13 5.8 2 1.4 3.8 2.8 5.4 4.6-1.2 1.6-2.6 3-4.2 4.2-1.4-1.4-3-2.6-4.8-3.6-3.4-2-7.2-3.4-11.2-4.2-8.2-1.8-16.8-1.8-24.8.2-13.2 3.4-24.8 12-32.6 23.4-7.8 11.4-11.4 25.4-10 39.2 1.4 13.6 7.4 26.4 16.6 35.8 9.2 9.4 21.4 15.4 34.4 17.2 13.2 1.8 26.8-.6 38.6-7.2 11.6-6.4 21.2-16.4 27-28.4 5.8-12 7.6-25.6 5.2-38.6-2.4-12.8-9.2-24.4-18.8-33-1.4-1.2-1.6-3.4-.4-4.8 1.2-1.4 3.4-1.6 4.8-.4 2.4 2 4.6 4.2 6.6 6.6z"
        />
        <path
          fill="currentColor"
          opacity="0.32"
          d="M68 152c9.2 15.4 23.4 27.2 39.8 32.6 16.6 5.4 34.8 4.6 50.8-2.2 7.8-3.4 14.8-8.4 20.6-14.4 1-1 .9-2.6-.2-3.5-1.1-1-2.7-.8-3.6.2-5.2 5.2-11.4 9.4-18.4 12.2-14.2 5.6-30.2 6-44.4.8-13.8-5.2-25.2-15.8-32.2-28.8-.8-1.4-2.6-1.8-3.8-.9-1.3.8-1.6 2.5-.8 3.8.1.2.2.4.4.5-.1.1-.1.1-.2.2z"
        />
        <circle cx="176" cy="156" r="1.4" fill="currentColor" opacity="0.4" />
        <circle cx="162" cy="172" r="1" fill="currentColor" opacity="0.28" />
        <circle cx="92" cy="174" r="1.5" fill="currentColor" opacity="0.22" />
      </svg>

      {/* Vermilion sun — small hanko anchor near Ensō opening */}
      <svg
        className="sumi-hero__sun"
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
      >
        <circle cx="23.6" cy="24.4" r="11.2" fill="var(--enso-sun, #C23B2A)" />
        <circle cx="26.1" cy="21.8" r="3.4" fill="var(--hanko-soft, #D45A4A)" opacity="0.28" />
      </svg>
    </div>
  )
}
