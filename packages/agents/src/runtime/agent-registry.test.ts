import { describe, it, expect, beforeEach } from "vitest";
import type { Task } from "@agentforge/shared";
import { AgentRegistry } from "./agent-registry.js";
import { BaseAgent } from "./base-agent.js";

class MockAgent extends BaseAgent {
  constructor(id: string) {
    super(id, `Mock-${id}`, { heartbeatInterval: 60_000 });
  }
  protected async process(_task: Task): Promise<Record<string, unknown>> {
    return { ok: true };
  }
}

describe("AgentRegistry", () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  it("registers and lists agents", () => {
    registry.register(new MockAgent("a1"));
    registry.register(new MockAgent("a2"));

    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map((a) => a.id)).toContain("a1");
    expect(list.map((a) => a.id)).toContain("a2");
  });

  it("rejects duplicate registration", () => {
    registry.register(new MockAgent("a1"));
    expect(() => registry.register(new MockAgent("a1"))).toThrow("already registered");
  });

  it("unregisters agents", () => {
    registry.register(new MockAgent("a1"));
    expect(registry.unregister("a1")).toBe(true);
    expect(registry.list()).toHaveLength(0);
  });

  it("gets agent by ID", () => {
    const agent = new MockAgent("a1");
    registry.register(agent);
    expect(registry.get("a1")).toBe(agent);
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("executes start command", async () => {
    const agent = new MockAgent("a1");
    registry.register(agent);

    await registry.execute({ action: "start", agentId: "a1" });
    expect(agent.status).toBe("running");

    await registry.execute({ action: "stop", agentId: "a1" });
  });

  it("executes pause/resume commands", async () => {
    const agent = new MockAgent("a1");
    registry.register(agent);

    await registry.execute({ action: "start", agentId: "a1" });
    await registry.execute({ action: "pause", agentId: "a1" });
    expect(agent.status).toBe("paused");

    await registry.execute({ action: "resume", agentId: "a1" });
    expect(agent.status).toBe("running");

    await registry.execute({ action: "stop", agentId: "a1" });
  });

  it("throws on command to unknown agent", async () => {
    await expect(
      registry.execute({ action: "start", agentId: "nonexistent" })
    ).rejects.toThrow("not found");
  });

  it("filters agents by status", async () => {
    const a1 = new MockAgent("a1");
    const a2 = new MockAgent("a2");
    registry.register(a1);
    registry.register(a2);

    await registry.execute({ action: "start", agentId: "a1" });

    expect(registry.byStatus("running")).toHaveLength(1);
    expect(registry.byStatus("idle")).toHaveLength(1);

    await registry.execute({ action: "stop", agentId: "a1" });
  });

  it("aggregates system metrics", () => {
    registry.register(new MockAgent("a1"));
    registry.register(new MockAgent("a2"));

    const metrics = registry.getSystemMetrics();
    expect(metrics.total).toBe(2);
    expect(metrics.idle).toBe(2);
    expect(metrics.running).toBe(0);
  });

  it("emits agent_change events on lifecycle", async () => {
    const agent = new MockAgent("a1");
    registry.register(agent);

    const changes: unknown[] = [];
    registry.on("agent_change", (data) => changes.push(data));

    await registry.execute({ action: "start", agentId: "a1" });
    await registry.execute({ action: "stop", agentId: "a1" });

    expect(changes.length).toBe(2);
  });
});
