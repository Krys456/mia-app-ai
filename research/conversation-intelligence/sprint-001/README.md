# Sprint 001 — Experimental Runtime Profile

## Goals

- Bundle all **validated** Planner principle flags into one experimental profile.
- Keep production behavior unchanged (all validated principles off by default).
- Let Planner read `runtimeProfile` without Writer, Runtime architecture, or API changes.
- Enable no new principles — only Exploration, Learning, and Planning flags already validated in experiments 001–003.

## Validated principles

| Experience | Flag | Experiment | Status |
| --- | --- | --- | --- |
| Exploration | `useExplorationPrinciples` | 001 | Validated |
| Learning | `useLearningPrinciples` | 002 | Validated |
| Planning | `usePlanningPrinciples` | 003 | Validated |

### Left disabled

- Debugging
- Support
- Brainstorming
- Decision
- Conversation

These experiences keep their existing baseline guidance. No principle flags for them in this sprint.

## Runtime profiles

Source: `lib/server/v2/brain/runtime-profile.js`

```js
RuntimeProfiles.production   // all validated flags false (default)
RuntimeProfiles.experimental // exploration + learning + planning true
```

Planner usage:

```js
plan({
  perception,
  decision,
  messages,
  runtimeProfile: 'experimental', // or 'production'
})
```

Explicit flags still override the profile when provided as booleans.

## Expected improvements

Based on experiments 001–003 (principles − baseline):

### Exploration (001)

- Higher curiosity / novelty
- Fewer `"Possiamo parlare di..."` openings
- Shorter, more directed openings

### Learning (002)

- Higher depth and practicality (Concept → Why → Example)
- Fewer definitions without examples
- Clearer progression after the direct answer

### Planning (003)

- Higher practicality and clarity
- Lower first-actionable-step latency
- Shorter responses that lead with an executable step
- Better recommendation quality

### Combined experimental profile

When `runtimeProfile: 'experimental'`, the three validated experiences should show the same directional gains as their isolated experiments, without changing disabled experiences.

## Evaluation checklist

- [ ] `runtime-profile` unit tests pass
- [ ] Planner tests pass (`runtimeProfile: 'experimental'` enables exploration / learning / planning guidance)
- [ ] Default / `production` profile leaves principle guidance off
- [ ] Explicit `use*Principles: false` overrides experimental profile
- [ ] Re-run Experiment 001 with `runtimeProfile: 'experimental'` (exploration subset) — metrics move in the same direction as 001
- [ ] Re-run Experiment 002 with experimental profile — definitions-without-examples drop
- [ ] Re-run Experiment 003 with experimental profile — first-action latency improves
- [ ] Spot-check debugging / support / brainstorming / decision / conversation — guidance unchanged vs production
- [ ] Confirm Writer / Runtime architecture / API were not modified for this sprint
- [ ] No commits until review
