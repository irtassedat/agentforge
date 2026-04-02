import type { AgentInstance, AgentCommand, AgentStatus } from "@agentforge/shared";
import type { BaseAgent } from "./base-agent.js";
import { EventEmitter } from "node:events";
import pino from "pino";

/**
 * AgentRegistry — Central registry for all agent instances.
 *
 * Manages agent lifecycle, tracks state, routes commands,
 * and aggregates heartbeat data for monitoring.
 */
export class AgentRegistry extends EventEmitter {
  private agents = new Map<string, BaseAgent>();
  private logger = pino({ name: "registry" });

  /** Register an agent instance */
  register(agent: BaseAgent): void {
    if (this.agents.has(agent.id)) {
      throw new Error(`Agent ${agent.id} already registered`);
    }

    agent.on("heartbeat", (hb) => this.emit("heartbeat", hb));
    agent.on("task_complete", (task) => this.emit("task_complete", task));
    agent.on("task_dlq", (task) => this.emit("task_dlq", task));
    agent.on("task_retry", (data) => this.emit("task_retry", data));
    agent.on("started", () => this.emit("agent_change", this.getSnapshot(agent.id)));
    agent.on("stopped", () => this.emit("agent_change", this.getSnapshot(agent.id)));
    agent.on("paused", () => this.emit("agent_change", this.getSnapshot(agent.id)));

    this.agents.set(agent.id, agent);
    this.logger.info({ agentId: agent.id, name: agent.name }, "Agent registered");
  }

  /** Unregister an agent */
  unregister(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    agent.removeAllListeners();
    this.agents.delete(agentId);
    this.logger.info({ agentId }, "Agent unregistered");
    return true;
  }

  /** Get agent by ID */
  get(agentId: string): BaseAgent | undefined {
    return this.agents.get(agentId);
  }

  /** List all agents */
  list(): AgentInstance[] {
    return Array.from(this.agents.values()).map((a) => this.toInstance(a));
  }

  /** Get agents by status */
  byStatus(status: AgentStatus): AgentInstance[] {
    return this.list().filter((a) => a.status === status);
  }

  /** Execute a command on an agent */
  async execute(cmd: AgentCommand): Promise<void> {
    const agent = this.agents.get(cmd.agentId);
    if (!agent) throw new Error(`Agent ${cmd.agentId} not found`);

    switch (cmd.action) {
      case "start":
        await agent.start();
        break;
      case "stop":
        await agent.stop();
        break;
      case "pause":
        agent.pause();
        break;
      case "resume":
        agent.resume();
        break;
      case "restart":
        await agent.stop();
        await agent.start();
        break;
    }

    this.logger.info({ agentId: cmd.agentId, action: cmd.action }, "Command executed");
  }

  /** Get runtime snapshot for an agent */
  getSnapshot(agentId: string): AgentInstance | null {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    return this.toInstance(agent);
  }

  /** Aggregate system metrics */
  getSystemMetrics() {
    const agents = this.list();
    return {
      total: agents.length,
      running: agents.filter((a) => a.status === "running").length,
      failed: agents.filter((a) => a.status === "failed").length,
      idle: agents.filter((a) => a.status === "idle").length,
      paused: agents.filter((a) => a.status === "paused").length,
    };
  }

  private toInstance(agent: BaseAgent): AgentInstance {
    const s = agent.stats;
    return {
      id: agent.id,
      definitionId: agent.id,
      status: agent.status,
      startedAt: s.uptime > 0 ? new Date(Date.now() - s.uptime) : null,
      lastHeartbeat: new Date(),
      tasksProcessed: s.tasksProcessed,
      tasksFailed: s.tasksFailed,
      currentTask: s.currentTask,
      memoryUsage: s.memoryUsage,
      uptime: s.uptime,
      errorCount: s.tasksFailed,
      lastError: s.lastError,
    };
  }
}
