---
name: add-agent
description: Scaffolds a new agent class with skills, tests, and registry integration. Use when user says "add agent", "new agent", "create agent", "scaffold agent", or wants to add a new agent type to AgentForge.
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

# Add Agent Skill

When creating a new agent:

1. **Read the base class** to understand the pattern:
   - `packages/agents/src/runtime/base-agent.ts`

2. **Create the agent file** at `packages/agents/src/workers/<name>-agent.ts`:
   - Extend `BaseAgent`
   - Create built-in skills (extend `BaseSkill`) if needed
   - Register skills in constructor via `SkillRegistry`
   - Implement `process(task)` method
   - Use structured output with obstacle reporting

3. **Create test file** at `packages/agents/src/workers/<name>-agent.test.ts`

4. **Export from index**:
   - Add export to `packages/agents/src/index.ts`

5. **Verify**:
   ```bash
   pnpm build && pnpm typecheck && pnpm lint && pnpm test
   ```
