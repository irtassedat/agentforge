import { describe, it, expect, beforeEach } from "vitest";
import type { SkillContext, Task } from "@agentforge/shared";
import { BaseSkill } from "./base-skill.js";

/** Concrete skill that echoes input */
class EchoSkill extends BaseSkill {
  name = "echo";
  description = "Echoes input back";
  triggerPhrases = ["echo", "repeat", "say back"];
  cooldownMs = 100;
  outputFormat = [{ name: "message", type: "text" as const, required: true }];

  protected async execute(context: SkillContext): Promise<Record<string, unknown>> {
    return { message: context.task.type };
  }
}

/** Skill that reports obstacles during execution */
class FlakySkill extends BaseSkill {
  name = "flaky";
  description = "Sometimes fails";
  triggerPhrases = ["flaky", "unreliable"];

  protected async execute(_context: SkillContext): Promise<Record<string, unknown>> {
    this.reportObstacle({
      type: "network",
      description: "API rate limited",
      workaround: "Added 500ms delay between requests",
      severity: "warning",
    });
    return { result: "done despite issues" };
  }
}

/** Skill that reports a critical obstacle */
class CriticalObstacleSkill extends BaseSkill {
  name = "critical";
  description = "Reports critical obstacle";
  triggerPhrases = ["critical"];

  protected async execute(_context: SkillContext): Promise<Record<string, unknown>> {
    this.reportObstacle({
      type: "dependency",
      description: "Required service unavailable",
      severity: "critical",
    });
    return { partial: true };
  }
}

/** Skill that always throws */
class ThrowingSkill extends BaseSkill {
  name = "thrower";
  description = "Always throws";
  triggerPhrases = ["throw"];

  protected async execute(_context: SkillContext): Promise<Record<string, unknown>> {
    throw new Error("Execution failed catastrophically");
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

function createContext(overrides: Partial<SkillContext> = {}): SkillContext {
  return {
    task: createTask(),
    agentId: "test-agent",
    ...overrides,
  };
}

describe("BaseSkill", () => {
  let echo: EchoSkill;

  beforeEach(() => {
    echo = new EchoSkill();
  });

  describe("matches()", () => {
    it("returns confidence > 0 for matching input", () => {
      const score = echo.matches("please echo this");
      expect(score).toBeGreaterThan(0);
    });

    it("returns 0 for non-matching input", () => {
      const score = echo.matches("calculate the sum");
      expect(score).toBe(0);
    });

    it("scores exact match higher than partial match", () => {
      const exactScore = echo.matches("echo");
      const partialScore = echo.matches("please echo this for me");
      expect(exactScore).toBeGreaterThan(partialScore);
    });

    it("matches against skill name", () => {
      const score = echo.matches("use the echo skill");
      expect(score).toBeGreaterThan(0);
    });

    it("matches against description words", () => {
      const score = echo.matches("echoes input");
      expect(score).toBeGreaterThan(0);
    });
  });

  describe("run()", () => {
    it("returns structured SkillResult with success status", async () => {
      const ctx = createContext({ task: createTask({ type: "hello" }) });
      const result = await echo.run(ctx);

      expect(result.skillName).toBe("echo");
      expect(result.agentId).toBe("test-agent");
      expect(result.status).toBe("success");
      expect(result.output).toEqual({ message: "hello" });
      expect(result.obstacles).toEqual([]);
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it("tracks obstacles from reportObstacle()", async () => {
      const flaky = new FlakySkill();
      const result = await flaky.run(createContext());

      expect(result.status).toBe("success");
      expect(result.obstacles).toHaveLength(1);
      expect(result.obstacles[0]).toEqual({
        type: "network",
        description: "API rate limited",
        workaround: "Added 500ms delay between requests",
        severity: "warning",
      });
      expect(result.output).toEqual({ result: "done despite issues" });
    });

    it("returns 'partial' when critical obstacle exists", async () => {
      const critical = new CriticalObstacleSkill();
      const result = await critical.run(createContext());

      expect(result.status).toBe("partial");
      expect(result.obstacles).toHaveLength(1);
      expect(result.obstacles[0].severity).toBe("critical");
    });

    it("enforces cooldown", async () => {
      const ctx = createContext();
      await echo.run(ctx);

      const result = await echo.run(ctx);
      expect(result.status).toBe("failed");
      expect(result.output).toHaveProperty("error");
      expect(result.output.error as string).toContain("cooldown");
      expect(result.obstacles[0].type).toBe("timeout");
    });

    it("allows execution after cooldown expires", async () => {
      const ctx = createContext();
      await echo.run(ctx);

      await new Promise((r) => setTimeout(r, 120));
      const result = await echo.run(ctx);
      expect(result.status).toBe("success");
    });

    it("returns failed status on thrown error", async () => {
      const thrower = new ThrowingSkill();
      const result = await thrower.run(createContext());

      expect(result.status).toBe("failed");
      expect(result.output).toEqual({ error: "Execution failed catastrophically" });
      expect(result.obstacles).toHaveLength(1);
      expect(result.obstacles[0].type).toBe("other");
      expect(result.obstacles[0].severity).toBe("critical");
    });
  });

  describe("cooldownRemaining()", () => {
    it("returns 0 when not on cooldown", () => {
      expect(echo.cooldownRemaining()).toBe(0);
    });

    it("returns remaining time when on cooldown", async () => {
      await echo.run(createContext());
      const remaining = echo.cooldownRemaining();
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(100);
    });
  });

  describe("toDefinition()", () => {
    it("returns correct SkillDefinition", () => {
      const def = echo.toDefinition();

      expect(def).toEqual({
        name: "echo",
        description: "Echoes input back",
        triggerPhrases: ["echo", "repeat", "say back"],
        allowedTools: undefined,
        cooldownMs: 100,
        outputFormat: [{ name: "message", type: "text", required: true }],
      });
    });
  });

  describe("executionCount", () => {
    it("starts at 0", () => {
      expect(echo.executionCount).toBe(0);
    });

    it("increments after successful execution", async () => {
      await echo.run(createContext());
      expect(echo.executionCount).toBe(1);

      await new Promise((r) => setTimeout(r, 120));
      await echo.run(createContext());
      expect(echo.executionCount).toBe(2);
    });

    it("does not increment on cooldown rejection", async () => {
      await echo.run(createContext());
      expect(echo.executionCount).toBe(1);

      await echo.run(createContext());
      expect(echo.executionCount).toBe(1);
    });
  });
});
