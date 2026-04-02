# AgentForge

[![CI](https://github.com/irtassedat/agentforge/actions/workflows/ci.yml/badge.svg)](https://github.com/irtassedat/agentforge/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933.svg)](https://nodejs.org/)

**AI Agent Orchestration Platform** — Define, deploy, and monitor autonomous agents with real-time observability.

```
              ┌─────────────────────────────────────────────┐
              │              AgentForge                      │
              │                                             │
              │   ┌──────────┐  ┌──────────┐  ┌─────────┐  │
              │   │ Worker   │  │ Scheduler│  │ Watchdog│  │
              │   │ Agents   │  │ Agent    │  │ Agent   │  │
              │   └────┬─────┘  └────┬─────┘  └────┬────┘  │
              │        │             │             │        │
              │   ┌────▼─────────────▼─────────────▼────┐   │
              │   │        Agent Registry               │   │
              │   │   (lifecycle, heartbeat, commands)   │   │
              │   └────┬────────────────────────────┬───┘   │
              │        │                            │       │
              │   ┌────▼────┐               ┌──────▼────┐  │
              │   │ REST API│               │ Dashboard │  │
              │   │ Fastify │◄── WebSocket──│ Next.js   │  │
              │   └────┬────┘               └───────────┘  │
              │        │                                    │
              │   ┌────▼────┐  ┌─────────┐                 │
              │   │PostgreSQL│  │  Redis  │                 │
              │   │ (state)  │  │ (queue) │                 │
              │   └──────────┘  └─────────┘                 │
              └─────────────────────────────────────────────┘
```

## Features

- **Autonomous Agents** — Define agents with configurable concurrency, retry strategies, and timeouts
- **Agent Registry** — Central lifecycle management with start/stop/pause/resume/restart commands
- **Task Processing** — Priority-based queue with exponential backoff and dead letter queue (DLQ)
- **Self-Healing** — Watchdog agent monitors health and auto-restarts failed agents
- **Real-Time Dashboard** — WebSocket-powered monitoring with live metrics, logs, and agent status
- **Telegram Bot** — Control agents via chat: `/agents list`, `/agent restart worker-1`, `/status`
- **Workflow Engine** — Chain agents into multi-step workflows with conditional logic
- **Type-Safe** — Full TypeScript monorepo with shared types across all packages

## Architecture

| Package | Description | Stack |
|---------|-------------|-------|
| `@agentforge/shared` | Core types and interfaces | TypeScript |
| `@agentforge/agents` | Agent runtime, registry, built-in workers | Node.js, Redis |
| `@agentforge/api` | REST API + WebSocket server | Fastify 5, PostgreSQL, Prisma |
| `@agentforge/dashboard` | Real-time monitoring UI | Next.js 15, React 19, Tailwind |
| `@agentforge/bot` | Telegram control interface | Grammy |

## Quick Start

```bash
# Clone and install
git clone https://github.com/irtassedat/agentforge.git
cd agentforge
pnpm install

# Start infrastructure
docker compose up -d

# Run in development
pnpm dev
```

## Agent Types

### WorkerAgent
Processes tasks from a queue. Configurable concurrency, timeout, and retry logic.

```typescript
import { HttpWorkerAgent } from "@agentforge/agents";

const worker = new HttpWorkerAgent("api-checker", { concurrency: 5 });
await worker.start();

await worker.executeTask({
  id: "task-1",
  type: "http_check",
  payload: { url: "https://api.example.com/health", method: "GET" },
  priority: "normal",
  // ...
});
```

### SchedulerAgent
Cron-like periodic task generation with drift correction.

```typescript
import { SchedulerAgent } from "@agentforge/agents";

const scheduler = new SchedulerAgent("cron-1");
scheduler.addSchedule("health_check", { targets: ["api", "db"] }, 30_000);
await scheduler.start();
```

### WatchdogAgent
Monitors agent health: heartbeat freshness, memory, error rates. Auto-restarts failed agents.

```typescript
import { WatchdogAgent, AgentRegistry } from "@agentforge/agents";

const registry = new AgentRegistry();
const watchdog = new WatchdogAgent("watchdog", registry, {
  maxHeartbeatAge: 30_000,
  maxMemoryMb: 512,
  maxErrorRate: 0.5,
});
await watchdog.start();
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents` | List all agents |
| `POST` | `/api/agents` | Register new agent |
| `GET` | `/api/agents/:id` | Get agent details |
| `POST` | `/api/agents/:id/command` | Send command (start/stop/restart) |
| `GET` | `/api/tasks` | List tasks with filters |
| `POST` | `/api/tasks` | Create new task |
| `GET` | `/api/tasks/dlq` | Dead letter queue |
| `POST` | `/api/tasks/dlq/:id/retry` | Retry DLQ entry |
| `GET` | `/api/workflows` | List workflows |
| `POST` | `/api/workflows` | Create workflow |
| `GET` | `/api/metrics` | System metrics |
| `WS` | `/ws` | Real-time events |

## Tech Stack

- **Runtime:** Node.js 20, TypeScript 5.7
- **Backend:** Fastify 5, Prisma ORM, PostgreSQL 16, Redis 7
- **Frontend:** Next.js 15, React 19, Tailwind CSS 4
- **Bot:** Grammy (Telegram Bot Framework)
- **Infra:** Docker Compose, pnpm workspaces

## License

MIT
