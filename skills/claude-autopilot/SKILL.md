---
name: claude-autopilot
description: Self-driving GSD orchestrator. Describe work in plain English, auto-onboard, classify scope, parallelize independent phases, and loop until done.
version: 1.0.0
---

<objective>
Single entry point for substantial work. Takes a natural language description and:
1. Orients - checks if the project has GSD infrastructure, onboards if not
2. Classifies - quick task vs milestone-level work
3. Launches - either runs /gsd:quick directly or starts a loop that iterates through GSD phases until all work is complete
4. Parallelizes - detects independent phases and fans out subagents for concurrent execution
5. Isolates - prevents multiple instances from corrupting shared state
</objective>

<context>
User request: $ARGUMENTS
</context>

<process>

## Phase A - Orient

### A1. Check dependencies

Before anything else, verify that GSD is available:

1. Check GSD: Run `ls ~/.claude/get-shit-done/bin/gsd-tools.cjs 2>/dev/null || ls ~/.claude/plugins/cache/*/get-shit-done/*/bin/gsd-tools.cjs 2>/dev/null`
   - Store the first found path as GSD_TOOLS_PATH
   - If neither path exists, tell the user: "claude-autopilot requires GSD. Install it: `npx get-shit-done-cc@latest --claude --global`" and exit.

### A2. Parse arguments

Extract from $ARGUMENTS:
- **description**: The natural language work description (everything not a flag)
- **--quick**: Force quick-task routing (skip classification)
- **--no-loop**: Plan and execute once, do NOT start the loop
- **--max-iterations N**: Cap loop iterations (default: 25)
- **--resume**: Resume an existing session (skip onboarding/classification, go straight to loop prompt)

If description is empty AND --resume was not passed, use AskUserQuestion to ask what they want to build/fix/change.

### A3. Handle --resume flag

If --resume was passed:
1. Check if .claude/ralph-loop.local.md exists
   - If yes: Tell the user "Resuming autopilot loop" and jump directly to C4 (execute the loop prompt for this iteration)
   - If no: Run init progress. If phases remain incomplete, jump to C3 to recreate the state file and start fresh. If all complete, tell user "Nothing to resume - all phases complete."

### A4. Acquire instance lock

Before touching any shared state, acquire a lock:

```bash
LOCK_FILE=".planning/.auto-work.lock"
if [ -f "$LOCK_FILE" ]; then
  LOCK_PID=$(head -1 "$LOCK_FILE" 2>/dev/null)
  LOCK_STARTED=$(sed -n '2p' "$LOCK_FILE" 2>/dev/null)
  # Check if lock is stale (PID dead or lock older than 2 hours)
  if ! kill -0 "$LOCK_PID" 2>/dev/null; then
    echo "Stale lock (PID $LOCK_PID dead). Reclaiming."
    rm -f "$LOCK_FILE"
  else
    LOCK_AGE=$(( $(date +%s) - $(date -d "$LOCK_STARTED" +%s 2>/dev/null || echo 0) ))
    if [ "$LOCK_AGE" -gt 7200 ]; then
      echo "Stale lock (>2h old). Reclaiming."
      rm -f "$LOCK_FILE"
    else
      echo "Another autopilot instance is running (PID $LOCK_PID, started $LOCK_STARTED)."
      echo "Wait for it to finish, or remove .planning/.auto-work.lock manually."
    fi
  fi
fi

# Write lock
mkdir -p .planning
echo "$$" > "$LOCK_FILE"
date -u +%Y-%m-%dT%H:%M:%SZ >> "$LOCK_FILE"
```

If the lock was held by a live process, inform the user and EXIT. Do not proceed.

The lock file is released when the loop completes (promise fulfilled) or on error exit.
Always release with: `rm -f .planning/.auto-work.lock`

### A5. Check project state

Run this command to check GSD infrastructure (use GSD_TOOLS_PATH from A1):

    node [GSD_TOOLS_PATH] init progress 2>/dev/null

Parse the JSON output. Key fields:
- project_exists - has .planning/PROJECT.md
- roadmap_exists - has .planning/ROADMAP.md
- phases - array of phase objects with status field
- current_phase - phase currently in progress (or null)
- next_phase - next pending phase (or null)
- completed_count / phase_count - progress numbers

If the command fails or returns invalid JSON, tell the user: "GSD state is broken. Run /gsd:health to diagnose." and exit.

### A6. Onboard if needed

**If project_exists is false:**
1. Tell the user: "No GSD project found. Setting up now."
2. Invoke /gsd:map-codebase via Skill tool to analyze the codebase
3. Invoke /gsd:new-project via Skill tool with the user description as context
4. After onboarding completes, re-run init progress to get fresh state

**If project_exists is true but roadmap_exists is false:**
1. Tell the user: "Project exists but no active milestone. Creating one."
2. Invoke /gsd:new-milestone via Skill tool
3. Re-run init progress

## Phase B - Classify Scope

### B1. Quick signals (route to /gsd:quick)

If ANY of these are true, route to quick:
- --quick flag was passed
- Description contains words like: "fix", "tweak", "rename", "update", "change", "small", "typo", "bump"
  AND does NOT also contain: "feature", "system", "redesign", "refactor", "implement", "build", "create"

**Quick path:**
1. Invoke /gsd:quick via Skill tool, passing the description
2. Release lock. Done. No loop needed. Exit.

### B2. Milestone signals (continue to launch)

If ANY of these are true, this is milestone work:
- Description mentions: "feature", "system", "redesign", "implement", "build", "create", "add", "milestone", "phase"
- Description is 15+ words with technical specifics
- The roadmap already has phases matching this description

### B3. Ambiguous

If neither quick nor milestone signals are clear:
Use AskUserQuestion with options:
- **Quick task** - "Small, self-contained change. Done in one shot."
- **Full milestone** - "Multi-phase work. Will plan, execute, and verify iteratively."

Route based on answer.

## Phase C - Confirm and Launch

### C1. Show the plan

Display to the user:

    ## Autopilot: [short description]

    **Progress:** [completed_count]/[phase_count] phases complete
    **Current phase:** [current_phase.name or "None - will plan first"]
    **Next phase:** [next_phase.name or "N/A"]

    **Mode:** [Loop (max N iterations) | Plan only (--no-loop)]

### C2. Get confirmation

**If --no-loop flag was passed:** Skip this question, behave as "Plan only".

Otherwise, use AskUserQuestion:
- **Launch** - "Start grinding through phases automatically"
- **Plan only** - "Just plan the next phase, do not loop"
- **Cancel** - "Nevermind"

**If "Plan only" (or --no-loop):**
- Determine the phase to plan (current_phase if researched/pending, or next_phase)
- Invoke /gsd:plan-phase [phase_number] via Skill tool
- If the plan was created successfully, invoke /gsd:execute-phase [phase_number] via Skill tool
- Release lock. Done. Exit.

**If "Cancel":** Release lock. Exit with message "Cancelled."

**If "Launch":** Continue to C3.

### C3. Write loop state file and begin

Determine max_iterations from flag or default 25.
Generate ISO8601 UTC timestamp via Bash: date -u +%Y-%m-%dT%H:%M:%SZ

Find GSD_TOOLS_PATH again (same logic as A1) and embed it in the prompt below.

Write the file .claude/ralph-loop.local.md using the Bash tool with a heredoc. Use this exact format:

    ---
    active: true
    iteration: 1
    max_iterations: [MAX_ITERATIONS]
    completion_promise: "ALL PHASES COMPLETE"
    started_at: "[ISO8601_UTC_TIMESTAMP]"
    ---

    [THE LOOP PROMPT BELOW, with GSD_TOOLS_PATH and USER_DESCRIPTION substituted in]

**The Loop Prompt** (repeated each iteration by the stop hook):

---BEGIN LOOP PROMPT TEMPLATE---

You are in a claude-autopilot loop. Your job: advance the GSD project, maximizing parallelism.

## Step 1: Check State

Run: node [GSD_TOOLS_PATH] init progress 2>/dev/null

Parse the JSON. Key fields: phases, current_phase, next_phase, completed_count, phase_count.

## Step 2: Detect Parallel Opportunities

Analyze the phases array for independence. Two phases are independent if:
- Both have status "planned" or "in_progress" with PLAN.md files ready
- They do NOT share modified files (check each plan's files_modified in PLAN.md frontmatter)
- Neither explicitly depends on the other (check dependency declarations)

**If 2+ independent phases with ready plans exist:**

Fan out parallel subagents using the Agent tool:

```
For each independent phase, dispatch:
Agent(
  prompt="You are a GSD phase executor. Your single job:
  1. Read .planning/STATE.md for project context
  2. Invoke /gsd:execute-phase [PHASE_NUMBER] via the Skill tool
  3. Do NOT modify ROADMAP.md or STATE.md directly — report results back
  4. Report: phase number, plans completed count, any failures or blockers
  Phase to execute: [PHASE_NUMBER]",
  model="sonnet"
)
```

After all parallel agents complete:
- Collect results from each
- Update ROADMAP.md once with all phase progress
- Update STATE.md once with new position
- If any agent reported failure, log it and continue with remaining phases
- Proceed to Step 5 (stuck detection)

**If only 1 phase is actionable or phases have dependencies:** Fall through to Step 3.

## Step 3: Decide Action (Sequential)

Apply this decision tree IN ORDER:

a) completed_count == phase_count AND phase_count > 0:
   ALL DONE. First invoke /gsd:verify-work via the Skill tool for a final check.
   Then release lock: rm -f .planning/.auto-work.lock
   Then output exactly: <promise>ALL PHASES COMPLETE</promise>

b) current_phase exists AND has status "in_progress":
   Invoke /gsd:execute-phase [current_phase.number] via the Skill tool.

c) current_phase exists AND has status "researched" or "planned":
   Invoke /gsd:plan-phase [current_phase.number] via the Skill tool.

d) current_phase is null AND next_phase exists:
   Invoke /gsd:plan-phase [next_phase.number] via the Skill tool.

e) current_phase is null AND next_phase is null AND phase_count > 0:
   Likely all complete. Read .planning/ROADMAP.md to confirm.
   If truly done: invoke /gsd:verify-work, release lock, then output <promise>ALL PHASES COMPLETE</promise>
   If phases remain: investigate the inconsistency and handle it.

f) phase_count == 0 OR no roadmap:
   Something is broken. Release lock. Output <promise>ALL PHASES COMPLETE</promise> as safety valve.

## Step 4: One Action Per Iteration

Do ONE action from Step 2 or 3, then let the iteration end naturally.
The loop restarts you with fresh context for the next step.

Do NOT output the promise tag unless you are in case (a) or (e) with confirmed completion.
If a skill fails or errors out, report what happened. Do NOT output the promise tag on failure.

## Step 5: Stuck Detection

Read the iteration count from .claude/ralph-loop.local.md frontmatter.
If iteration > 3 AND init progress shows no change from what you would expect after 3 iterations
(same phase, same completed_count), you may be stuck. Report the situation clearly to the user
and do NOT output the promise tag. The user can /cancel-ralph and intervene.

## Context
Work description: [USER_DESCRIPTION]

---END LOOP PROMPT TEMPLATE---

When writing the state file, replace [GSD_TOOLS_PATH] with the actual path found in A1,
and [USER_DESCRIPTION] with the actual user description from A2.

### C4. Begin first iteration

After writing the state file, immediately execute the Loop Prompt yourself. You ARE the first iteration:
1. Run init progress using GSD_TOOLS_PATH
2. Apply the phase independence analysis from Step 2
3. If parallel phases found, fan them out via Agent tool
4. Otherwise, apply the sequential decision tree from Step 3
5. Invoke the appropriate GSD skill(s)

When this iteration completes and you try to exit, the stop hook detects the state file,
increments the iteration counter, and feeds the prompt back for iteration 2.

</process>

<guardrails>
- NEVER output <promise>ALL PHASES COMPLETE</promise> unless completed_count truly equals phase_count AND phase_count > 0
- If init progress returns an error or empty output, do NOT loop - tell the user to run /gsd:health
- Each iteration should make measurable progress. If stuck on the same phase for 3+ iterations, report to user.
- The --max-iterations default of 25 is a safety valve. Most milestones complete in 5-15 iterations.
- Always use GSD_TOOLS_PATH discovered in A1, never hardcode the path.
- Always release lock (.planning/.auto-work.lock) on completion, cancellation, or error exit.
- Parallel phase execution: NEVER let subagents modify ROADMAP.md or STATE.md directly. The orchestrator updates those after collecting results.
- Parallel phase execution: only fan out phases that have PLAN.md files ready. Do not plan and execute in the same parallel batch.
</guardrails>
