# #355B — Places Edge Stack (operator notes)

Server-side "find nearby / nearest / named place" lookups via the Google
Places API (New), Edge Functions only. Mirrors the #337B Gmail pattern in
shape (JWT-gated POST endpoint, shared Deno helpers, redacted logs) but is a
**separate, self-contained stack**: no shared modules, no shared table, no
shared Vercel route.

**No migration. No database table.** This route is stateless — the verified
JWT (`auth.uid()`) is required only to gate usage; no row is read or written
for any user.

**No new Vercel function.** `api/places.ts` does NOT exist. Vercel function
count stays at **11**.

## What this ships

| File | Role |
|------|------|
| `supabase/functions/_shared/places-edge.ts` | env/CORS/JSON/JWT verify + redacted logging (Places-specific) |
| `supabase/functions/_shared/places-google.ts` | Google Places (New) request builders, HTTP call, category map, haversine, normalize |
| `supabase/functions/places-query/index.ts` | POST-only nearby/nearest/named-place query |

**OUT of #355B:** chat wiring, Settings UX, `openNow` (see decision below),
photos, reviews, ratings, Place Details, DB persistence, Vercel routes.

## openNow: DEFERRED

`currentOpeningHours` / `openNow` is intentionally **NOT** requested in the
FieldMask and **NOT** returned by `normalizePlace`. On the Places API (New),
every additional field widens the billed SKU surface for Nearby Search /
Text Search. Staying on the 5-field mask below keeps every call inside the
minimal **Pro** SKU with no extra per-field cost. This is a deliberate
product/cost decision, not an oversight — revisit only with explicit
budget sign-off.

## FieldMask (Pro Nearby/Text Search SKU)

```
places.id,places.displayName,places.primaryType,places.formattedAddress,places.location
```

No `photos`, no `reviews`, no `rating`, no `currentOpeningHours`/`openNow`,
no `nationalPhoneNumber`, no `websiteUri`. `places-google.ts` exports this
mask as `PLACES_FIELD_MASK` — it is the single source of truth for every
request.

## Secrets (names only — never commit values)

Set identically wherever this function runs (Supabase Edge Secrets):

```
PLACES_ENABLED=                    # Edge kill switch (default off) — "1"/"true"/"yes"
SHINKAIDO_PLACES_API_KEY=          # Edge only — Google Places API (New) server key, restricted to Places API
SUPABASE_URL=                      # Edge only — project URL (usually auto-injected)
SUPABASE_SERVICE_ROLE_KEY=         # Edge only — used ONLY for auth.getUser() JWT verification
```

`SHINKAIDO_PLACES_API_KEY` is the **only** runtime key name read by
`places-google.ts` / `places-query`. No other env var name is accepted as a
fallback.

## Google Cloud setup

1. Enable **Places API (New)** in the same Google Cloud project (APIs &
   Services → Library → "Places API (New)"). Do NOT enable the legacy
   Places API — this stack calls `https://places.googleapis.com/v1/*` only.
2. Create a **server-side API key** (APIs & Services → Credentials → Create
   Credentials → API key). Restrict it:
   - API restriction: Places API (New) only.
   - Application restriction: none needed for a server key called only from
     Supabase Edge (no browser exposure — never ship this key to the
     client).
3. Set the key as `SHINKAIDO_PLACES_API_KEY` (see below). Never put it in
   any `VITE_*` variable.

## Deploy (1 Edge Function)

```bash
supabase functions deploy places-query
```

Set secrets first (per environment):

```bash
supabase secrets set \
  PLACES_ENABLED=true \
  SHINKAIDO_PLACES_API_KEY=<value>
```

`places-query` keeps platform JWT verification **on** (default) — no
`config.toml` change was needed for this feature.

## No DB, no migration

`email_connections`/`calendar_connections`-style persistence does not apply
here: there is nothing to store per user (no OAuth, no tokens, no
connection state). Every request is answered directly from the Google
Places API response.

## Category → Google type mapping (Table A, safe subset)

```
farmacia        → pharmacy
supermercato    → supermarket
bar             → bar
ristorante      → restaurant
benzinaio       → gas_station
palestra        → gym
caffe / caffè   → cafe
banca           → bank
ospedale        → hospital
hotel           → lodging
```

Cuisine-specific phrases (e.g. "ristoranti giapponesi") are **not** in this
map — an unmapped category with a `textQuery` falls through to Text Search
instead of guessing a `type`.

## Query types

- `nearby_category` — maps `category` to an `includedTypes` Nearby Search,
  or falls back to Text Search when `textQuery` is provided and the
  category is unmapped. `no_match` when neither resolves.
- `nearest` — same resolution as `nearby_category`, then sorts results by
  Haversine distance (ascending) from the caller's coordinates.
- `named_place` — always Text Search, with a `locationBias` circle around
  the caller's coordinates.

## Limits

- Radius: default 2000m, max 5000m (server-clamped).
- Results per query: default 5, max 5 (server-clamped).
- Provider timeout: ~9000ms (Edge `AbortController`), surfaced as
  `status: 'timeout'`.

## Response shape

```
{
  ok: boolean,
  status: 'ok' | 'empty' | 'no_match' | 'provider_disabled' | 'provider_error' | 'timeout' | 'error',
  places: Array<{ id, name, category?, address?, latitude, longitude, distanceMeters?, provider: 'google_places' }>,
  fetchedAt: string,
  queryType: 'nearby_category' | 'nearest' | 'named_place' | null,
  runId: string,
}
```

No `openNow` on any place — see decision above.

## Privacy

Never logs `lat`/`lon`/`latitude`/`longitude`/`address`/`name`/`query`/
`destination`/`coords` (or anything token/secret/api-key-shaped).
`places-edge.ts`'s `logSafe` redacts every field whose key matches those
patterns before writing a log line.
