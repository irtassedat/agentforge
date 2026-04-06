# AgentForge

[![CI](https://github.com/irtassedat/agentforge/actions/workflows/ci.yml/badge.svg)](https://github.com/irtassedat/agentforge/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933.svg)](https://nodejs.org/)

**AI Agent Orchestration Platform** — Define, deploy, and monitor autonomous agents with real-time observability.

**[Live Demo Dashboard](https://dashboard-rust-chi-93.vercel.app)** | [Documentation](#features) | [Quick Start](#quick-start)

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
- **Skills System** — Reusable capabilities with semantic matching, structured output, and obstacle reporting
- **SubAgent Delegation** — Isolated context execution with parallel fan-out and result aggregation
- **Inter-Agent Messaging** — Priority-queued agent-to-agent communication with ack/nack and DLQ
- **Agent Registry** — Central lifecycle management with start/stop/pause/resume/restart commands
- **Task Processing** — Priority-based queue with exponential backoff and dead letter queue (DLQ)
- **Self-Healing** — Watchdog agent monitors health and auto-restarts failed agents
- **Real-Time Dashboard** — WebSocket-powered monitoring with live metrics, logs, and agent status
- **Telegram Bot** — Control agents via chat: `/agents list`, `/agent restart worker-1`, `/status`
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

## Skills System

Skills are reusable capabilities that agents can execute. They provide semantic matching, structured output, cooldown enforcement, and obstacle reporting.

```typescript
import { BaseSkill, SkillRegistry } from "@agentforge/agents";
import type { SkillContext } from "@agentforge/shared";

class HealthCheckSkill extends BaseSkill {
  readonly name = "health-check";
  readonly description = "Checks service health endpoints";
  readonly triggerPhrases = ["health", "status", "check", "monitor"];
  readonly outputFormat = [
    { name: "status", type: "text", required: true },
    { name: "services", type: "table", required: true },
  ];

  protected async execute(context: SkillContext) {
    this.reportObstacle({
      type: "network",
      description: "Endpoint slow (>5s)",
      severity: "warning",
    });
    return { status: "OK", services: [] };
  }
}

// Semantic matching
const registry = new SkillRegistry();
registry.register(new HealthCheckSkill());
const skill = registry.match("check if services are running"); // confidence: 0.72
```

## SubAgent Delegation

SubAgents run tasks in isolated contexts. Only the summary returns to the parent.

```typescript
import { Delegator } from "@agentforge/agents";

const delegator = new Delegator();
const result = await delegator.delegate(
  { name: "researcher", tools: ["Read", "Grep"], delegationMode: "wait_for_result" },
  parentAgentId, task,
  async (ctx) => {
    ctx.recordToolUse("Read");
    ctx.reportObstacle({ type: "timeout", description: "API slow", severity: "warning" });
    return { findings: "JWT validation in auth.ts:42" };
  }
);
// result.summary, result.obstacles, result.toolsUsed
```

## Inter-Agent Messaging

Priority-queued agent-to-agent communication with ack/nack lifecycle:

```typescript
import { MessageBus } from "@agentforge/agents";

const bus = new MessageBus();
bus.send({ from: "pipeline-1", to: "monitor-1", type: "task", payload: { check: true }, priority: "high" });
const msg = bus.receive("monitor-1");
bus.ack("monitor-1", msg.id, { result: "healthy" });
```

## Production Agents

| Agent | Description | Skills | Pattern |
|-------|-------------|--------|---------|
| `PipelineAgent` | Multi-step data processing | collect, transform, validate | Skills |
| `MonitorAgent` | Health monitoring with structured reports | health-check | Skills |
| `CoordinatorAgent` | Orchestrates SubAgents with parallel fan-out | — | SubAgent + Messaging |
| `HttpWorkerAgent` | HTTP request processing | — | Base |
| `SchedulerAgent` | Cron-like periodic task generation | — | Base |
| `WatchdogAgent` | Auto-restarts failed agents (self-healing) | — | Base |

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
