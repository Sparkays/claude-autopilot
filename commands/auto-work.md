---
name: auto-work
description: Describe what you want built. Auto-onboards the project, plans phases, and grinds through them until done.
argument-hint: '"what you want done" [--quick] [--no-loop] [--resume] [--max-iterations N]'
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - Task
  - Agent
  - Skill
  - AskUserQuestion
---

<objective>
Unified entry point: describe work in plain English, auto-onboard if needed, classify scope, and either quick-execute or launch a loop that iterates through GSD phases until all work is complete.
</objective>

<execution_context>
@~/.claude/skills/claude-autopilot/SKILL.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
Follow the SKILL.md orchestration end-to-end:
Phase A (Orient) -> Phase B (Classify) -> Phase C (Confirm and Launch)
</process>
