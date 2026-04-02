import type { Task, AgentInstance } from "@agentforge/shared";
import { BaseAgent } from "../runtime/base-agent.js";
import type { AgentRegistry } from "../runtime/agent-registry.js";

/**
 * WatchdogAgent — Monitors other agents' health.
 *
 * Checks heartbeat freshness, memory usage, error rates.
 * Auto-restarts failed agents. Demonstrates the watcher pattern:
 * autonomous monitoring with self-healing capabilities.
 */
export class WatchdogAgent extends BaseAgent {
  private registry: AgentRegistry;
  private _watchTimer: NodeJS.Timeout | null = null;
  private readonly maxHeartbeatAge: number;
  private readonly maxMemoryMb: number;
  private readonly maxErrorRate: number;

  constructor(
    id: string,
    registry: AgentRegistry,
    config?: {
      checkIntervalMs?: number;
      maxHeartbeatAge?: number;
      maxMemoryMb?: number;
      maxErrorRate?: number;
    }
  ) {
    super(id, "Watchdog", {
      concurrency: 1,
      taskTimeout: 10_000,
      maxRetries: 1,
      retryStrategy: "fixed",
      retryDelay: 5000,
      heartbeatInterval: 15_000,
    });

    this.registry = registry;
    this.maxHeartbeatAge = config?.maxHeartbeatAge ?? 30_000;
    this.maxMemoryMb = config?.maxMemoryMb ?? 512;
    this.maxErrorRate = config?.maxErrorRate ?? 0.5;
  }

  protected async onStart(): Promise<void> {
    this._watchTimer = setInterval(() => this.checkAgents(), 10_000);
    this.logger.info("Watchdog monitoring started");
  }

  protected async onStop(): Promise<void> {
    if (this._watchTimer) {
      clearInterval(this._watchTimer);
      this._watchTimer = null;
    }
  }

  protected async process(task: Task): Promise<Record<string, unknown>> {
    const agents = this.registry.list();
    const issues: string[] = [];

    for (const agent of agents) {
      if (agent.id === this.id) continue; // Don't watch yourself

      const problems = this.diagnose(agent);
      if (problems.length > 0) {
        issues.push(...problems.map((p) => `${agent.id}: ${p}`));
      }
    }

    return { checked: agents.length - 1, issues };
  }

  private async checkAgents(): Promise<void> {
    const agents = this.registry.list();

    for (const agent of agents) {
      if (agent.id === this.id) continue;

      const problems = this.diagnose(agent);
      if (problems.length === 0) continue;

      for (const problem of problems) {
        this.logger.warn({ agentId: agent.id, problem }, "Agent health issue");
        this.emit("health_issue", { agentId: agent.id, problem, timestamp: new Date() });
      }

      // Auto-restart failed agents
      if (agent.status === "failed") {
        this.logger.info({ agentId: agent.id }, "Auto-restarting failed agent");
        try {
          await this.registry.execute({ action: "restart", agentId: agent.id });
          this.emit("auto_restart", { agentId: agent.id, timestamp: new Date() });
        } catch (err) {
          this.logger.error({ agentId: agent.id, err }, "Auto-restart failed");
        }
      }
    }
  }

  private diagnose(agent: AgentInstance): string[] {
    const issues: string[] = [];

    // Stale heartbeat
    if (agent.status === "running" && agent.lastHeartbeat) {
      const age = Date.now() - new Date(agent.lastHeartbeat).getTime();
      if (age > this.maxHeartbeatAge) {
        issues.push(`Heartbeat stale (${Math.round(age / 1000)}s)`);
      }
    }

    // High memory
    const memMb = agent.memoryUsage / (1024 * 1024);
    if (memMb > this.maxMemoryMb) {
      issues.push(`Memory high (${Math.round(memMb)}MB > ${this.maxMemoryMb}MB)`);
    }

    // High error rate
    const total = agent.tasksProcessed + agent.tasksFailed;
    if (total > 10) {
      const errorRate = agent.tasksFailed / total;
      if (errorRate > this.maxErrorRate) {
        issues.push(`Error rate ${(errorRate * 100).toFixed(0)}% > ${this.maxErrorRate * 100}%`);
      }
    }

    // Failed status
    if (agent.status === "failed") {
      issues.push(`Status: failed — ${agent.lastError || "unknown"}`);
    }

    return issues;
  }
}
