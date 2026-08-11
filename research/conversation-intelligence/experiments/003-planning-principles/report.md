# Experiment 003 — Planning Principles

## Setup

- **Scope:** planning only (`usePlanningPrinciples`)
- **Baseline:** `usePlanningPrinciples = false` (existing planning guidance)
- **Treatment:** `usePlanningPrinciples = true` (actionable-plan principles in Planner guidance)
- **Writer / Runtime:** unchanged (same Writer, no Runtime refactors)
- **Prompts:** 27 planning prompts
- **Harness:** Conversation Behavior Harness 0.1.0-conversation-behavior-harness
  - LAIfe slot = principles enabled
  - ChatGPT slot = baseline
- Versions: planner `2.4.3-planner`, writer `3.2.0-writer`, pipeline `2.1.0-pipeline`, model `gpt-4o-mini`

## Metrics

| Metric | Baseline | Principles | Difference (prin − base) |
| --- | ---: | ---: | ---: |
| Practicality | 0.4430 | 0.4941 | 0.0511 |
| Clarity | 0.6478 | 0.6933 | 0.0455 |
| First actionable step latency | 0.7046 | 0.6342 | -0.0704 |
| Avg response length (words) | 34.22 | 23.63 | -10.59 |
| Generic introductions (count) | 0 | 0 | 0 |
| Repeated user goal (count) | 0 | 0 | 0 |
| Recommendation quality | 0.3944 | 0.4389 | 0.0445 |

## Practicality difference

**0.0511** (principles − baseline)

## Clarity difference

**0.0455** (principles − baseline)

## First actionable step latency

- Baseline: **0.7046** (fraction of response before first action; lower is better)
- Principles: **0.6342**
- Difference: **-0.0704**

## Average response length

- Baseline: **34.22** words
- Principles: **23.63** words
- Difference: **-10.59**

## Number of generic introductions

- Baseline: **0**
- Principles: **0**

## Number of repeated user goal

- Baseline: **0**
- Principles: **0**

## Recommendation quality difference

**0.0445** (principles − baseline)

## Harness summary

```
Case                   Winner     Strategy Match  Depth Match  Initiative Match  Overall 
-----------------------------------------------------------------------------------------
plan-01                LAIfe      no              yes          no                0.78    
plan-02                LAIfe      no              yes          no                0.78    
plan-03                LAIfe      no              yes          yes               0.89    
plan-04                Tie        no              yes          no                0.78    
plan-05                ChatGPT    no              yes          yes               0.89    
plan-06                LAIfe      no              yes          no                0.78    
plan-07                ChatGPT    no              yes          yes               0.89    
plan-08                LAIfe      no              yes          no                0.78    
plan-09                Tie        no              yes          no                0.78    
plan-10                ChatGPT    no              yes          yes               0.89    
plan-11                LAIfe      no              yes          no                0.78    
plan-12                Tie        no              yes          no                0.78    
plan-13                Tie        no              yes          no                0.78    
plan-14                LAIfe      no              yes          no                0.78    
plan-15                LAIfe      no              yes          no                0.78    
plan-16                LAIfe      no              yes          no                0.78    
plan-17                ChatGPT    no              yes          no                0.78    
plan-18                LAIfe      no              yes          no                0.78    
plan-19                LAIfe      no              no           yes               0.78    
plan-20                LAIfe      no              yes          no                0.78    
plan-21                LAIfe      no              yes          no                0.78    
plan-22                LAIfe      no              yes          no                0.78    
plan-23                LAIfe      no              yes          yes               0.89    
plan-24                LAIfe      no              yes          yes               0.89    
plan-25                Tie        no              yes          yes               0.89    
plan-26                LAIfe      no              yes          no                0.78    
plan-27                Tie        no              yes          no                0.78    

Wins  LAIfe=17  ChatGPT=4  Tie=6
Match strategy=0 depth=0.963 initiative=0.2963 overall=0.8066
```

Wins: LAIfe(principles)=17  baseline(slot)=4  Tie=6

Overall similarity (label overlap): 0.8066

## Notes

- Scoring for practicality / clarity / latency / recommendation quality is deterministic text analysis (no LLM judge).
- First actionable step latency is the fraction of words before the first action cue; lower is better.
- Flag default remains `false`; enable only when `usePlanningPrinciples: true`.
- Other conversation experiences are untouched.
