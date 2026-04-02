import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Task } from "@agentforge/shared";
import { BaseAgent } from "./base-agent.js";

/** Concrete test implementation of BaseAgent */
class TestAgent extends BaseAgent {
  public processHandler: (task: Task) => Promise<Record<string, unknown>> = async () => ({
    ok: true,
  });

  constructor(id = "test-agent") {
    super(id, "TestAgent", {
      concurrency: 2,
      taskTimeout: 5000,
      maxRetries: 3,
      retryStrategy: "exponential",
      retryDelay: 100,
      heartbeatInterval: 60_000,
    });
  }

  protected async process(task: Task): Promise<Record<string, unknown>> {
    return this.processHandler(task);
  }
}

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Date.now()}`,
    agentId: "test-agent",
    type: "test",
    priority: "normal",
    status: "pending",
    payload: {},
    attempts: 0,
    maxAttempts: 3,
    scheduledAt: new Date(),
    startedAt: null,
    completedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("BaseAgent", () => {
  let agent: TestAgent;

  beforeEach(() => {
    agent = new TestAgent();
  });

  describe("lifecycle", () => {
    it("starts in idle state", () => {
      expect(agent.status).toBe("idle");
    });

    it("transitions to running on start", async () => {
      await agent.start();
      expect(agent.status).toBe("running");
      await agent.stop();
    });

    it("transitions to terminated on stop", async () => {
      await agent.start();
      await agent.stop();
      expect(agent.status).toBe("terminated");
    });

    it("can pause and resume", async () => {
      await agent.start();
      agent.pause();
      expect(agent.status).toBe("paused");
      agent.resume();
      expect(agent.status).toBe("running");
      await agent.stop();
    });

    it("emits lifecycle events", async () => {
      const started = vi.fn();
      const stopped = vi.fn();
      agent.on("started", started);
      agent.on("stopped", stopped);

      await agent.start();
      expect(started).toHaveBeenCalledWith("test-agent");

      await agent.stop();
      expect(stopped).toHaveBeenCalledWith("test-agent");
    });
  });

  describe("task processing", () => {
    beforeEach(async () => {
      await agent.start();
    });

    it("processes a task successfully", async () => {
      agent.processHandler = async () => ({ result: 42 });
      const task = createTask();

      const result = await agent.executeTask(task);

      expect(result.status).toBe("completed");
      expect(result.result).toEqual({ result: 42 });
      expect(result.completedAt).toBeInstanceOf(Date);
      expect(agent.stats.tasksProcessed).toBe(1);

      await agent.stop();
    });

    it("retries on failure with exponential backoff", async () => {
      let callCount = 0;
      agent.processHandler = async () => {
        callCount++;
        if (callCount < 3) throw new Error("transient failure");
        return { ok: true };
      };

      const task = createTask();
      const retryEvents: unknown[] = [];
      agent.on("task_retry", (data) => retryEvents.push(data));

      const result = await agent.executeTask(task);

      // First call fails, task goes to retry
      expect(result.status).toBe("queued");
      expect(result.attempts).toBe(1);
      expect(retryEvents.length).toBe(1);

      await agent.stop();
    });

    it("sends to DLQ after max retries", async () => {
      agent.processHandler = async () => {
        throw new Error("permanent failure");
      };

      const dlqEvents: unknown[] = [];
      agent.on("task_dlq", (data) => dlqEvents.push(data));

      const task = createTask({ attempts: 2, maxAttempts: 3 });
      const result = await agent.executeTask(task);

      expect(result.status).toBe("dead_letter");
      expect(result.error).toBe("permanent failure");
      expect(dlqEvents.length).toBe(1);
      expect(agent.stats.tasksFailed).toBe(1);

      await agent.stop();
    });

    it("rejects tasks when not running", async () => {
      await agent.stop();
      const task = createTask();

      await expect(agent.executeTask(task)).rejects.toThrow("not running");
    });
  });

  describe("heartbeat", () => {
    it("emits heartbeat events", async () => {
      const hbAgent = new TestAgent();
      // Override heartbeat interval to be fast for testing
      (hbAgent as any).config.heartbeatInterval = 50;

      const heartbeats: unknown[] = [];
      hbAgent.on("heartbeat", (hb) => heartbeats.push(hb));

      await hbAgent.start();
      await new Promise((r) => setTimeout(r, 150));
      await hbAgent.stop();

      expect(heartbeats.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("stats", () => {
    it("tracks uptime", async () => {
      await agent.start();
      await new Promise((r) => setTimeout(r, 50));
      expect(agent.stats.uptime).toBeGreaterThan(0);
      await agent.stop();
    });

    it("tracks memory usage", () => {
      expect(agent.stats.memoryUsage).toBeGreaterThan(0);
    });
  });
});
