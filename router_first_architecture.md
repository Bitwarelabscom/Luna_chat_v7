# Router-First Architecture

## Compute Arbitration for Trustworthy AI Responses

---

## Purpose

This router exists to solve one problem:

> **Do not answer a question cheaply if being wrong has a real cost.**

The router decides:
- Which model is allowed to answer
- Whether tools are mandatory
- What confidence contract applies

The router **never** generates text.
It does **not** help.
It only routes.

If the router fails, the system becomes untrustworthy regardless of model quality.

---

## Core Principles

1. Understanding precedes compute
2. Wrong answers have different costs
3. Cheap models must be prevented from bluffing
4. Escalation must be deterministic
5. Fail safe, not cheap

---

## System Overview

```
User Input
   ↓
[ Router ]
   ↓
[ Execution Layer ]
   ├── Nano model (cheap, fast)
   ├── Pro model (reasoning)
   └── Pro + Tools (verified)
   ↓
Response + Metadata
```

The router runs **once per user message**.

---

## Router Responsibilities

The router outputs a **fixed schema**:

```json
{
  "class": "chat | transform | factual | actionable",
  "needs_fresh_data": true | false,
  "needs_tools": true | false,
  "risk_if_wrong": "low | medium | high",
  "confidence_required": "estimate | verified",
  "route": "nano | pro | pro+tools"
}
```

No free-form text.
No reasoning output.
No ambiguity.

---

## Routing Logic (Authoritative)

### Step 0 — Hard Escalation Rules

These rules bypass all ML and heuristics.

If the query mentions **any** of the following:

- Flights, prices, availability, booking
- Dates, times, schedules
- Weather, traffic, delays
- “Today”, “tomorrow”, “this weekend”, “now”
- Locations tied to real-world action

→ **Immediate route = `pro+tools`**

This rule is non-negotiable.

---

### Step 1 — Task Classification

Classify intent, not wording.

| Class | Definition |
|------|-----------|
| chat | Casual conversation, opinions |
| transform | Rewrite, summarize, format |
| factual | Static explanations |
| actionable | Leads to real-world action |

Implementation:
- Keyword tables
- Regex
- Or a tiny classifier (≤300k params)

Do **not** use a full LLM here.

---

### Step 2 — Freshness Check

Set `needs_fresh_data = true` if:
- The answer changes over time
- The question depends on current state
- The user implies temporal relevance

Examples:
- Weather → true
- Flight prices → true
- Historical explanation → false

---

### Step 3 — Risk Assessment

Ask exactly one question:

> **If this answer is wrong, does the user pay a cost?**

| Cost | Risk |
|-----|-----|
| None / annoyance | low |
| Confusion / wasted time | medium |
| Money / plans / trust | high |

No nuance. No empathy. No guessing.

---

### Step 4 — Route Decision

```text
IF class == actionable AND needs_fresh_data:
    route = pro+tools
    confidence_required = verified

ELSE IF risk_if_wrong == medium:
    route = pro
    confidence_required = estimate

ELSE:
    route = nano
    confidence_required = estimate
```

If uncertain → escalate.

---

## Execution Layer Contract

### Nano Model

Allowed:
- Rewrite
- Summarize
- Style transform
- Low-risk answers

Forbidden:
- Time-sensitive facts
- Actionable answers
- Fake verification

---

### Pro Model

Used when:
- Reasoning depth matters
- Explanation is required
- Data is static

Must **not** invent freshness.

---

### Pro + Tools

Mandatory when:
- Data must be current
- Answer can be acted on
- Wrong answer damages trust

Tools are not optional here.

---

## Metadata (Mandatory)

Every response must include provenance:

```json
{
  "source": "nano | pro | pro+tools",
  "confidence": "estimated | verified",
  "freshness": "assumed | checked"
}
```

Expose this to the UI.

---

## Router Prohibitions

The router must never:
- Answer the user
- Explain itself
- Add context
- Be helpful
- Guess silently

If it starts reasoning, the system is already broken.

---

## Failure Modes

| Failure | Acceptable | Reason |
|-------|------------|-------|
| Over-escalation | Yes | Costly but safe |
| Under-escalation | No | Breaks trust |
| Slower response | Yes | Correct > fast |
| Clarifying question | Yes | Once only |

---

## Why This Works

- Humans reason in **cost of wrongness**
- Most AI systems optimize **token cost**
- This inverts that priority

You are encoding common sense, not intelligence.

---

## Minimal Implementation Stack

- Router: rules + heuristics (+ optional tiny classifier)
- Models: nano, pro
- Tools: weather, travel, search
- Orchestrator: enforces routing
- UI: displays provenance

---

## Final Rule

> **If a cheap model answers a question that required tools, the system is broken — even if the answer is correct.**

Correctness without trust is useless.

