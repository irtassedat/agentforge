import { describe, it, expect, vi } from "vitest";
import type { Task, SubAgentConfig } from "@agentforge/shared";
import { SubAgent } from "./sub-agent.js";
import type { SubAgentContext } from "./sub-agent.js";

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Date.now()}`,
    agentId: "parent-agent",
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

function createConfig(overrides: Partial<SubAgentConfig> = {}): SubAgentConfig {
  return {
    name: "test-sub",
    description: "Test sub-agent",
    tools: ["read_file", "search"],
    delegationMode: "wait_for_result",
    ...overrides,
  };
}

describe("SubAgent", () => {
  describe("delegate()", () => {
    it("executes handler and returns result", async () => {
      const sub = new SubAgent(createConfig());
      const task = createTask();

      const result = await sub.delegate("parent-1", task, async () => {
        return { answer: 42 };
      });

      expect(result.subAgentName).toBe("test-sub");
      expect(result.parentAgentId).toBe("parent-1");
      expect(result.status).toBe("completed");
      expect(result.output).toEqual({ answer: 42 });
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it("includes obstacles from handler", async () => {
      const sub = new SubAgent(createConfig());
      const task = createTask();

      const result = await sub.delegate("parent-1", task, async (ctx: SubAgentContext) => {
        ctx.reportObstacle({
          type: "network",
          description: "API returned 429",
          severity: "warning",
        });
        return { done: true };
      });

      expect(result.status).toBe("completed");
      expect(result.obstacles).toHaveLength(1);
      expect(result.obstacles[0].type).toBe("network");
    });

    it("tracks tool usage", async () => {
      const sub = new SubAgent(createConfig());
      const task = createTask();

      const result = await sub.delegate("parent-1", task, async (ctx: SubAgentContext) => {
        ctx.recordToolUse("read_file");
        ctx.recordToolUse("search");
        ctx.recordToolUse("read_file"); // duplicate, should not be added twice
        return { done: true };
      });

      expect(result.toolsUsed).toEqual(["read_file", "search"]);
    });

    it("times out correctly", async () => {
      const sub = new SubAgent(createConfig({ timeoutMs: 50 }));
      const task = createTask();

      const result = await sub.delegate("parent-1", task, async () => {
        await new Promise((r) => setTimeout(r, 200));
        return { done: true };
      });

      expect(result.status).toBe("timeout");
      expect(result.output).toHaveProperty("error");
      expect(result.output.error as string).toContain("timeout");
    });

    it("handles handler errors", async () => {
      const sub = new SubAgent(createConfig());
      const task = createTask();

      const result = await sub.delegate("parent-1", task, async () => {
        throw new Error("Handler exploded");
      });

      expect(result.status).toBe("failed");
      expect(result.summary).toContain("Handler exploded");
      expect(result.obstacles.some((o) => o.severity === "critical")).toBe(true);
    });

    it("generates summary from output.summary when available", async () => {
      const sub = new SubAgent(createConfig());
      const task = createTask();

      const result = await sub.delegate("parent-1", task, async () => {
        return { summary: "Found 5 results", data: [1, 2, 3, 4, 5] };
      });

      expect(result.summary).toBe("Found 5 results");
    });

    it("generates summary from output keys when no summary field", async () => {
      const sub = new SubAgent(createConfig());
      const task = createTask();

      const result = await sub.delegate("parent-1", task, async () => {
        return { count: 5, items: [] };
      });

      expect(result.summary).toContain("count");
      expect(result.summary).toContain("items");
    });
  });

  describe("isToolAllowed()", () => {
    it("returns true for configured tools", () => {
      const sub = new SubAgent(createConfig({ tools: ["read_file", "search"] }));
      expect(sub.isToolAllowed("read_file")).toBe(true);
      expect(sub.isToolAllowed("search")).toBe(true);
    });

    it("returns false for non-configured tools", () => {
      const sub = new SubAgent(createConfig({ tools: ["read_file"] }));
      expect(sub.isToolAllowed("write_file")).toBe(false);
      expect(sub.isToolAllowed("delete")).toBe(false);
    });
  });

  describe("events", () => {
    it("emits delegation_start", async () => {
      const sub = new SubAgent(createConfig());
      const handler = vi.fn();
      sub.on("delegation_start", handler);

      await sub.delegate("parent-1", createTask(), async () => ({ ok: true }));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          subAgentId: sub.id,
          parentAgentId: "parent-1",
          taskType: "test",
        })
      );
    });

    it("emits delegation_complete on success", async () => {
      const sub = new SubAgent(createConfig());
      const handler = vi.fn();
      sub.on("delegation_complete", handler);

      await sub.delegate("parent-1", createTask(), async () => ({ ok: true }));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          subAgentName: "test-sub",
          status: "completed",
        })
      );
    });

    it("emits delegation_failed on error", async () => {
      const sub = new SubAgent(createConfig());
      const handler = vi.fn();
      sub.on("delegation_failed", handler);

      await sub.delegate("parent-1", createTask(), async () => {
        throw new Error("boom");
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          subAgentName: "test-sub",
          status: "failed",
        })
      );
    });
  });
});
