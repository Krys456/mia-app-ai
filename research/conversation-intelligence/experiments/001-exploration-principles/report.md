# Experiment 001 — Exploration Principles

## Setup

- **Scope:** exploration only (`useExplorationPrinciples`)
- **Baseline:** `useExplorationPrinciples = false` (existing exploration guidance)
- **Treatment:** `useExplorationPrinciples = true` (research exploration principles in Planner guidance)
- **Writer / Runtime:** unchanged (same Writer, no Runtime refactors)
- **Prompts:** 24 exploration prompts
- **Harness:** Conversation Behavior Harness 0.1.0-conversation-behavior-harness
  - LAIfe slot = principles enabled
  - ChatGPT slot = baseline
- Versions: planner `2.4.1-planner`, writer `3.2.0-writer`, pipeline `2.1.0-pipeline`, model `gpt-4o-mini`

## Metrics

| Metric | Baseline | Principles | Difference (prin − base) |
| --- | ---: | ---: | ---: |
| Curiosity | 0.3425 | 0.3829 | 0.0404 |
| Novelty | 0.4437 | 0.4500 | 0.0063 |
| Practicality | 0.2500 | 0.2500 | 0.0000 |
| Avg response length (words) | 17.71 | 12.29 | -5.42 |
| Generic openings (count) | 0 | 0 | 0 |
| "Possiamo parlare di..." (count) | 1 | 0 | -1 |

## Curiosity difference

**0.0404** (principles − baseline)

## Novelty difference

**0.0063** (principles − baseline)

## Practicality difference

**0.0000** (principles − baseline)

## Average response length

- Baseline: **17.71** words
- Principles: **12.29** words
- Difference: **-5.42**

## Number of generic openings

- Baseline: **0**
- Principles: **0**

## Number of "Possiamo parlare di..."

- Baseline: **1**
- Principles: **0**

## Harness summary

```
Case                   Winner     Strategy Match  Depth Match  Initiative Match  Overall 
-----------------------------------------------------------------------------------------
exp-01                 Tie        no              yes          no                0.44    
exp-02                 Tie        no              yes          no                0.44    
exp-03                 Tie        no              yes          no                0.44    
exp-04                 LAIfe      no              yes          no                0.56    
exp-05                 Tie        no              yes          no                0.44    
exp-06                 LAIfe      no              yes          no                0.44    
exp-07                 Tie        no              yes          no                0.44    
exp-08                 LAIfe      no              yes          no                0.44    
exp-09                 Tie        no              yes          no                0.44    
exp-10                 Tie        no              yes          no                0.44    
exp-11                 LAIfe      no              yes          no                0.22    
exp-12                 LAIfe      no              yes          no                0.44    
exp-13                 LAIfe      no              yes          no                0.22    
exp-14                 Tie        no              yes          no                0.44    
exp-15                 Tie        no              yes          no                0.44    
exp-16                 Tie        no              yes          no                0.44    
exp-17                 Tie        no              yes          no                0.44    
exp-18                 LAIfe      no              yes          no                0.44    
exp-19                 Tie        no              yes          no                0.44    
exp-20                 Tie        no              yes          no                0.44    
exp-21                 Tie        no              yes          no                0.44    
exp-22                 Tie        no              yes          no                0.44    
exp-23                 Tie        no              yes          no                0.44    
exp-24                 LAIfe      no              yes          no                0.44    

Wins  LAIfe=8  ChatGPT=0  Tie=16
Match strategy=0 depth=1 initiative=0 overall=0.4305
```

Wins: LAIfe(principles)=8  baseline(slot)=0  Tie=16

Overall similarity (label overlap): 0.4305

## Notes

- Scoring for curiosity / novelty / practicality is deterministic text analysis (no LLM judge).
- Flag default remains `false`; enable only when `useExplorationPrinciples: true`.
- Other conversation experiences are untouched.
