---
name: superpowers
description: Agentic development workflow framework — structured brainstorming, planning, execution, debugging, verification, and parallel agent dispatch. Use this for any multi-step development task.
---

# Superpowers — Agentic Development Framework

A complete workflow for turning ideas into production code through structured phases.

## Phase 1: Brainstorming (Design First)

Before any implementation:
1. **Explore** project context — review existing files, docs, recent work
2. **Ask** clarifying questions to understand purpose, constraints, success criteria
3. **Propose** 2-3 approaches with trade-offs and a clear recommendation
4. **Present** design sections scaled to complexity
5. **Write** design spec before any code

**Core Rule**: Break systems into units with single, clear purposes and well-defined interfaces. Prefer smaller, focused components. Follow existing patterns.

## Phase 2: Writing Plans

Create implementation plans that break work into atomic tasks:
- Each task: write test → verify failure → implement → verify pass → commit
- Every code step shows actual implementations, not descriptions
- File paths must be exact, commands need expected outputs
- No placeholder language ("TBD", "etc.", "as needed")

**Self-Review Checklist**: Verify spec coverage, scan for placeholders, check type consistency, identify gaps.

## Phase 3: Execution

### Sequential (Single Agent)
Work through each task, marking progress and running verifications.

### Parallel (Multiple Agents)
When facing 2+ independent tasks:
1. **Identify** independent domains — group by what's broken/needed
2. **Create** focused agent tasks with specific scope, clear goal, constraints
3. **Dispatch** in parallel — one agent per problem domain
4. **Review and integrate** — verify no conflicts, run full suite

**Use parallel when**: Tasks are independent, no shared state, each can be understood alone.
**Don't use when**: Failures are related, need full system context, agents would edit same files.

## Phase 4: Systematic Debugging

**ALWAYS find root cause before attempting fixes.**

1. **Investigate**: Read errors thoroughly, reproduce consistently, check recent changes, trace data flow backward
2. **Analyze patterns**: Find working examples, compare against references, identify differences
3. **Hypothesis & Test**: Form specific hypotheses, make minimal changes, verify results
4. **Implement**: Create failing test, implement fix, verify solution

**If ≥ 3 fix attempts each reveal new problems → STOP and question the architecture.**

**Red flags**: "Quick fix for now", "I don't fully understand but this might work", proposing solutions before tracing data flow.

## Phase 5: Verification Before Completion

**NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE.**

Before claiming ANY status:
1. **IDENTIFY**: What command proves this claim?
2. **RUN**: Execute the FULL command (fresh, complete)
3. **READ**: Full output, check exit code, count failures
4. **VERIFY**: Does output confirm the claim?
5. **ONLY THEN**: Make the claim

| Claim | Requires | Not Sufficient |
|-------|----------|----------------|
| Tests pass | Test output: 0 failures | Previous run, "should pass" |
| Build succeeds | Build: exit 0 | Linter passing |
| Bug fixed | Original symptom passes | Code changed, assumed fixed |
| Requirements met | Line-by-line checklist | Tests passing |

**Never use**: "should", "probably", "seems to", "Great!", "Done!" without evidence.

## Phase 6: Test-Driven Development

**NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.**

Red-Green-Refactor:
1. **RED**: Create one minimal test demonstrating desired behavior
2. **Verify RED**: Confirm test fails because feature is missing
3. **GREEN**: Implement simplest possible solution
4. **Verify GREEN**: Confirm test passes, no other tests broke
5. **REFACTOR**: Clean up while maintaining green

## Agent Prompt Best Practices

Good agent prompts are:
- **Focused** — one clear problem domain
- **Self-contained** — all context needed to understand the problem
- **Specific about output** — what should the agent return?
- **Constrained** — "Don't change other code", "Fix tests only"

Bad: "Fix all the tests" → agent gets lost
Good: "Fix 3 failing tests in file X — here are the error messages: ..."
