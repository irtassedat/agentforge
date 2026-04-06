import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SkillContext, Task } from "@agentforge/shared";
import { SkillRegistry } from "./skill-registry.js";
import { BaseSkill } from "./base-skill.js";

class EchoSkill extends BaseSkill {
  name = "echo";
  description = "Echoes input back";
  triggerPhrases = ["echo", "repeat"];

  protected async execute(context: SkillContext): Promise<Record<string, unknown>> {
    return { message: context.task.type };
  }
}

class MathSkill extends BaseSkill {
  name = "math";
  description = "Performs calculations";
  triggerPhrases = ["calculate", "math", "add numbers"];

  protected async execute(_context: SkillContext): Promise<Record<string, unknown>> {
    return { result: 42 };
  }
}

class FailSkill extends BaseSkill {
  name = "fail";
  description = "Always fails";
  triggerPhrases = ["fail"];

  protected async execute(_context: SkillContext): Promise<Record<string, unknown>> {
    throw new Error("Intentional failure");
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

describe("SkillRegistry", () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  describe("register()", () => {
    it("adds a skill", () => {
      registry.register(new EchoSkill());
      expect(registry.get("echo")).toBeDefined();
    });

    it("throws on duplicate name", () => {
      registry.register(new EchoSkill());
      expect(() => registry.register(new EchoSkill())).toThrow("already registered");
    });
  });

  describe("unregister()", () => {
    it("removes a skill and returns true", () => {
      registry.register(new EchoSkill());
      expect(registry.unregister("echo")).toBe(true);
      expect(registry.get("echo")).toBeUndefined();
    });

    it("returns false for non-existent skill", () => {
      expect(registry.unregister("nonexistent")).toBe(false);
    });
  });

  describe("get()", () => {
    it("returns skill by name", () => {
      const skill = new EchoSkill();
      registry.register(skill);
      expect(registry.get("echo")).toBe(skill);
    });

    it("returns undefined for unknown skill", () => {
      expect(registry.get("unknown")).toBeUndefined();
    });
  });

  describe("list()", () => {
    it("returns all definitions", () => {
      registry.register(new EchoSkill());
      registry.register(new MathSkill());

      const list = registry.list();
      expect(list).toHaveLength(2);
      expect(list.map((d) => d.name)).toContain("echo");
      expect(list.map((d) => d.name)).toContain("math");
    });

    it("returns empty array when no skills registered", () => {
      expect(registry.list()).toEqual([]);
    });
  });

  describe("match()", () => {
    it("returns best matching skill", () => {
      registry.register(new EchoSkill());
      registry.register(new MathSkill());

      const match = registry.match("echo this please");
      expect(match).not.toBeNull();
      expect(match!.name).toBe("echo");
    });

    it("returns null below threshold", () => {
      registry.register(new EchoSkill());
      const match = registry.match("completely unrelated topic about cooking");
      expect(match).toBeNull();
    });
  });

  describe("matchAll()", () => {
    it("returns sorted by confidence descending", () => {
      registry.register(new EchoSkill());
      registry.register(new MathSkill());

      // "echo" should match echo skill strongly, math not at all
      const matches = registry.matchAll("echo");
      expect(matches.length).toBeGreaterThan(0);

      // Verify sorted descending
      for (let i = 1; i < matches.length; i++) {
        expect(matches[i - 1].confidence).toBeGreaterThanOrEqual(matches[i].confidence);
      }
    });

    it("returns empty array when nothing matches", () => {
      registry.register(new EchoSkill());
      const matches = registry.matchAll("completely unrelated topic about cooking");
      expect(matches).toEqual([]);
    });
  });

  describe("execute()", () => {
    it("runs skill and returns result", async () => {
      registry.register(new EchoSkill());

      const result = await registry.execute("echo", createContext());
      expect(result.skillName).toBe("echo");
      expect(result.status).toBe("success");
    });

    it("throws for unknown skill", async () => {
      await expect(registry.execute("nonexistent", createContext())).rejects.toThrow("not found");
    });
  });

  describe("matchAndExecute()", () => {
    it("matches and runs the best skill", async () => {
      registry.register(new EchoSkill());
      registry.register(new MathSkill());

      const result = await registry.matchAndExecute("echo something", createContext());
      expect(result).not.toBeNull();
      expect(result!.skillName).toBe("echo");
      expect(result!.status).toBe("success");
    });

    it("returns null when no match", async () => {
      registry.register(new EchoSkill());
      const result = await registry.matchAndExecute(
        "completely unrelated topic about cooking",
        createContext()
      );
      expect(result).toBeNull();
    });
  });

  describe("stats", () => {
    it("returns correct counts", async () => {
      registry.register(new EchoSkill());
      registry.register(new MathSkill());

      const stats = registry.stats;
      expect(stats.totalSkills).toBe(2);
      expect(stats.skills).toHaveLength(2);
      expect(stats.skills[0]).toHaveProperty("name");
      expect(stats.skills[0]).toHaveProperty("executionCount");
      expect(stats.skills[0]).toHaveProperty("onCooldown");
      expect(stats.skills[0]).toHaveProperty("cooldownRemaining");
    });
  });

  describe("events", () => {
    it("emits skill_start on execution", async () => {
      registry.register(new EchoSkill());
      const handler = vi.fn();
      registry.on("skill_start", handler);

      await registry.execute("echo", createContext());
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ skillName: "echo", agentId: "test-agent" })
      );
    });

    it("emits skill_complete on success", async () => {
      registry.register(new EchoSkill());
      const handler = vi.fn();
      registry.on("skill_complete", handler);

      await registry.execute("echo", createContext());
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ skillName: "echo", status: "success" })
      );
    });

    it("emits skill_failed on failure", async () => {
      registry.register(new FailSkill());
      const handler = vi.fn();
      registry.on("skill_failed", handler);

      await registry.execute("fail", createContext());
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ skillName: "fail", status: "failed" })
      );
    });
  });
});
