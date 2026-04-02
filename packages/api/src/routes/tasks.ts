import type { FastifyInstance } from "fastify";
import type { Task, Priority } from "@agentforge/shared";
import type { AgentRegistry } from "@agentforge/agents";
import { nanoid } from "nanoid";

// In-memory task store (would be Redis/PostgreSQL in production)
const tasks = new Map<string, Task>();
const dlq = new Map<string, Task>();

export async function taskRoutes(app: FastifyInstance) {
  const registry = (app as unknown as { registry: AgentRegistry }).registry;

  /** List tasks with optional filters */
  app.get<{
    Querystring: { status?: string; agentId?: string; limit?: string; offset?: string };
  }>("/", async (req) => {
    let result = Array.from(tasks.values());

    if (req.query.status) {
      result = result.filter((t) => t.status === req.query.status);
    }
    if (req.query.agentId) {
      result = result.filter((t) => t.agentId === req.query.agentId);
    }

    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;

    return {
      success: true,
      data: result.slice(offset, offset + limit),
      meta: { total: result.length, limit, offset },
    };
  });

  /** Create and dispatch a task */
  app.post<{
    Body: {
      agentId: string;
      type: string;
      payload: Record<string, unknown>;
      priority?: Priority;
    };
  }>("/", async (req, reply) => {
    const { agentId, type, payload, priority = "normal" } = req.body;

    const agent = registry.get(agentId);
    if (!agent) {
      return reply.status(404).send({ success: false, error: "Agent not found" });
    }

    const task: Task = {
      id: nanoid(16),
      agentId,
      type,
      priority,
      status: "pending",
      payload,
      attempts: 0,
      maxAttempts: 3,
      scheduledAt: new Date(),
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
    };

    tasks.set(task.id, task);

    // Execute asynchronously
    agent.executeTask(task).then((result) => {
      tasks.set(result.id, result);
      if (result.status === "dead_letter") {
        dlq.set(result.id, result);
      }
    });

    return reply.status(201).send({ success: true, data: task });
  });

  /** Get task by ID */
  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const task = tasks.get(req.params.id);
    if (!task) {
      return reply.status(404).send({ success: false, error: "Task not found" });
    }
    return { success: true, data: task };
  });

  /** List dead letter queue */
  app.get("/dlq", async () => {
    return {
      success: true,
      data: Array.from(dlq.values()),
      meta: { total: dlq.size },
    };
  });

  /** Retry a DLQ entry */
  app.post<{ Params: { id: string } }>("/dlq/:id/retry", async (req, reply) => {
    const task = dlq.get(req.params.id);
    if (!task) {
      return reply.status(404).send({ success: false, error: "DLQ entry not found" });
    }

    const agent = registry.get(task.agentId);
    if (!agent) {
      return reply.status(400).send({ success: false, error: "Agent no longer exists" });
    }

    // Reset task for retry
    task.status = "pending";
    task.attempts = 0;
    task.error = undefined;
    dlq.delete(task.id);
    tasks.set(task.id, task);

    agent.executeTask(task).then((result) => {
      tasks.set(result.id, result);
      if (result.status === "dead_letter") {
        dlq.set(result.id, result);
      }
    });

    return { success: true, data: task };
  });
}
