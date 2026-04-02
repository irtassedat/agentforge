# CLAUDE.md — AgentForge

## Project
AI Agent Orchestration Platform — TypeScript monorepo with pnpm workspaces.

## Structure
- `packages/shared` — Core types and interfaces
- `packages/agents` — Agent runtime, registry, built-in workers (BaseAgent, AgentRegistry, HttpWorker, Scheduler, Watchdog)
- `packages/api` — REST API + WebSocket server (Fastify 5, Prisma, PostgreSQL)
- `packages/dashboard` — Real-time monitoring UI (Next.js 15, React 19, Tailwind)
- `packages/bot` — Telegram control interface (Grammy)

## Commands
- `pnpm install` — install all dependencies
- `pnpm build` — build all packages (shared first, then agents)
- `pnpm lint` — ESLint check
- `pnpm typecheck` — TypeScript strict mode check
- `pnpm test` — vitest unit tests
- `pnpm dev` — run all packages in dev mode

## Code Style
- TypeScript strict mode, ESNext modules
- Conventional commits (feat/fix/refactor/test/docs)
- Tests alongside source files (*.test.ts)
- No `any` types — use `unknown` and narrow
- Prefer composition over inheritance (except BaseAgent pattern)

## Git
- user.name = irtassedat
- user.email = sedatirtas.1@gmail.com
- NO AI attribution in commits (no Co-Authored-By)
- PR workflow: feature branch → PR → CI green → merge

## Architecture Decisions
- BaseAgent is abstract: subclasses implement `process(task)`
- AgentRegistry is the central orchestrator — all agent lifecycle goes through it
- Tasks use priority queue with configurable retry strategies (fixed, linear, exponential)
- Dead Letter Queue (DLQ) for permanently failed tasks
- Heartbeat system for health monitoring
- WatchdogAgent auto-restarts failed agents (self-healing)
