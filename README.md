# claude-autopilot

Self-driving [GSD](https://github.com/gsd-build/get-shit-done) orchestrator for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Describe what you want in plain English, and it plans, parallelizes, and grinds through phases until done.

## What it does

```
/auto-work "build a REST API with auth, rate limiting, and admin dashboard"
```

1. **Orients** — detects GSD project state, onboards if needed
2. **Classifies** — routes quick fixes vs. multi-phase milestones
3. **Parallelizes** — detects independent phases, fans out subagents with file-overlap conflict detection
4. **Loops** — iterates through plan → execute → verify cycles until all phases complete
5. **Isolates** — PID-based instance locking prevents concurrent corruption

No manual phase-by-phase orchestration. No babysitting. One command, walk away.

## Install

```bash
npx claude-autopilot
```

This will:
- Install [GSD](https://github.com/gsd-build/get-shit-done) if you don't have it
- Copy the skill, command, and stop hook to `~/.claude/`
- Register the loop hook in your Claude Code settings

## Usage

### Basic

```bash
# In Claude Code:
/auto-work "implement user authentication with JWT and refresh tokens"
```

### Flags

| Flag | Description |
|------|-------------|
| `--quick` | Force quick-task routing (skip scope classification) |
| `--no-loop` | Plan and execute once, don't loop |
| `--resume` | Resume a previous autopilot session |
| `--max-iterations N` | Cap loop iterations (default: 25) |

### Examples

```bash
# Quick fix — detected automatically, no loop
/auto-work "fix the broken login redirect"

# Full milestone — plans phases, loops until done
/auto-work "build a notification system with email, push, and in-app delivery"

# Resume after context reset
/auto-work --resume

# One-shot, no loop
/auto-work --no-loop "add rate limiting to the API"
```

## How it works

### Parallel phase detection

Before executing, autopilot analyzes the phase dependency graph:
- Checks `files_modified` in each phase's PLAN.md
- Verifies no explicit dependency declarations between phases
- Only fans out phases that have ready plans (never plans + executes in the same parallel batch)

When independent phases exist, it dispatches subagents that work concurrently. State files (ROADMAP.md, STATE.md) are only updated by the orchestrator after all agents report back — never by the subagents themselves.

### Loop mechanism

Uses a stop-hook that intercepts Claude Code's session exit:
1. Checks for a `<promise>` tag in the last assistant output
2. If the completion promise isn't met, increments the iteration counter and feeds the prompt back
3. Each iteration gets fresh context, preventing context window degradation

The loop stops when:
- All phases are complete (promise fulfilled)
- Max iterations reached (default: 25, most milestones finish in 5-15)
- Stuck detection triggers (no progress after 3 iterations)

### Instance locking

A PID-based lock file at `.planning/.auto-work.lock` prevents multiple autopilot instances from running simultaneously. Stale locks (dead PID or >2 hours old) are automatically reclaimed.

## Uninstall

```bash
npx claude-autopilot uninstall
```

Removes the skill, command, and hook. GSD is left in place (manage it separately).

## Requirements

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
- Node.js >= 18
- [GSD](https://github.com/gsd-build/get-shit-done) (auto-installed if missing)

## License

MIT — see [LICENSE](LICENSE).

Stop hook derived from [Ralph Loop](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/ralph-loop) by Anthropic (Apache 2.0) — see [NOTICE](NOTICE).
