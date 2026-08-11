# Experiment 002 — Learning Principles

## Setup

- **Scope:** learning only (`useLearningPrinciples`)
- **Baseline:** `useLearningPrinciples = false` (existing learning guidance)
- **Treatment:** `useLearningPrinciples = true` (Concept → Why → Example principles in Planner guidance)
- **Writer / Runtime / API:** unchanged (same Writer, no Runtime/API refactors)
- **Prompts:** 27 learning prompts
- **Harness:** Conversation Behavior Harness 0.1.0-conversation-behavior-harness
  - LAIfe slot = principles enabled
  - ChatGPT slot = baseline
- Versions: planner `2.4.2-planner`, writer `3.2.0-writer`, pipeline `2.1.0-pipeline`, model `gpt-4o-mini`

## Principles (treatment)

- Start by answering the user's question directly.
- Explain the core concept in simple language.
- Explain why it matters.
- Give one concrete real-world example.
- Only then ask a follow-up question if it genuinely helps.

### Avoid

- Long introductions.
- Definitions without examples.
- Multiple examples.
- Asking questions before answering.

## Metrics

| Metric | Baseline | Principles | Difference (prin − base) |
| --- | ---: | ---: | ---: |
| Clarity | 0.7822 | 0.7822 | 0.0000 |
| Depth | 0.3500 | 0.4852 | 0.1352 |
| Curiosity | 0.3037 | 0.3444 | 0.0407 |
| Practicality | 0.2248 | 0.3956 | 0.1708 |
| Avg response length (words) | 70.74 | 72.89 | 2.15 |
| Generic openings (count) | 0 | 0 | 0 |
| Definitions without examples (count) | 19 | 11 | -8 |

## Clarity difference

**0.0000** (principles − baseline)

## Depth difference

**0.1352** (principles − baseline)

## Curiosity difference

**0.0407** (principles − baseline)

## Practicality difference

**0.1708** (principles − baseline)

## Average response length

- Baseline: **70.74** words
- Principles: **72.89** words
- Difference: **2.15**

## Number of generic openings

- Baseline: **0**
- Principles: **0**

## Number of definitions without examples

- Baseline: **19**
- Principles: **11**

## Harness summary

```
Case                   Winner     Strategy Match  Depth Match  Initiative Match  Overall 
-----------------------------------------------------------------------------------------
learn-01               LAIfe      no              no           yes               0.67    
learn-02               Tie        no              yes          yes               0.89    
learn-03               LAIfe      no              yes          yes               0.89    
learn-04               ChatGPT    no              yes          yes               0.89    
learn-05               Tie        no              yes          yes               0.89    
learn-06               LAIfe      no              yes          yes               0.89    
learn-07               LAIfe      no              no           yes               0.67    
learn-08               Tie        no              yes          yes               0.89    
learn-09               LAIfe      no              no           yes               0.67    
learn-10               LAIfe      no              yes          yes               0.89    
learn-11               LAIfe      no              no           yes               0.67    
learn-12               LAIfe      no              no           yes               0.67    
learn-13               ChatGPT    no              no           yes               0.67    
learn-14               LAIfe      no              no           yes               0.67    
learn-15               LAIfe      no              no           yes               0.67    
learn-16               LAIfe      no              yes          yes               0.89    
learn-17               LAIfe      no              no           yes               0.67    
learn-18               ChatGPT    no              yes          yes               0.89    
learn-19               Tie        no              yes          yes               0.89    
learn-20               LAIfe      no              no           yes               0.67    
learn-21               LAIfe      no              no           yes               0.67    
learn-22               LAIfe      no              no           yes               0.67    
learn-23               ChatGPT    no              yes          yes               0.89    
learn-24               LAIfe      no              yes          yes               0.89    
learn-25               LAIfe      no              yes          yes               0.89    
learn-26               Tie        no              yes          yes               0.89    
learn-27               LAIfe      no              no           yes               0.67    

Wins  LAIfe=18  ChatGPT=4  Tie=5
Match strategy=0 depth=0.5185 initiative=1 overall=0.7819
```

Wins: LAIfe(principles)=18  baseline(slot)=4  Tie=5

Overall similarity (label overlap): 0.7819

## Notes

- Scoring for clarity / depth / curiosity / practicality is deterministic text analysis (no LLM judge).
- Flag default remains `false`; enable only when `useLearningPrinciples: true`.
- Other conversation experiences are untouched.
