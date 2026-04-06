---
name: debug-agent
description: Diagnoses why an agent is failing by analyzing DLQ entries, error logs, and task history. Use when user says "why is agent failing", "debug agent", "agent error", "check DLQ", "task failing".
allowed-tools: Read, Grep, Glob, Bash
---

# Debug Agent Skill

When debugging an agent failure:

1. **Run tests**: `pnpm test -- --reporter=verbose 2>&1 | tail -50`

2. **Check the agent's process() method** for:
   - Unhandled promise rejections
   - Missing null checks on task.payload
   - Timeout issues (taskTimeout vs actual operation time)
   - Skill execution failures

3. **Check skill matching** — if wrong skill triggers:
   - Review triggerPhrases for overlaps
   - Test: `skill.matches("user input")` — confidence > 0.15

4. **Check SubAgent delegation** — if delegation fails:
   - Verify timeout is sufficient
   - Check tool restrictions
   - Look at obstacle reports in SubAgentResult

5. **Report findings**: Root cause, affected component, suggested fix
