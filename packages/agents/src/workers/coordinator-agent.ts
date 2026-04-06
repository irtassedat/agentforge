import { BaseAgent } from "../runtime/base-agent.js";
import { Delegator } from "../delegation/delegator.js";
import { MessageBus } from "../messaging/message-bus.js";
import type { Task, SubAgentConfig } from "@agentforge/shared";

/**
 * CoordinatorAgent — Orchestrates work across SubAgents and MessageBus.
 *
 * Demonstrates the full AgentForge pattern:
 * - SubAgent delegation for isolated tasks
 * - Parallel fan-out for independent work
 * - MessageBus for agent-to-agent communication
 * - Result aggregation with obstacle collection
 */
export class CoordinatorAgent extends BaseAgent {
  readonly delegator = new Delegator();
  readonly messageBus: MessageBus;

  constructor(
    id: string,
    messageBus?: MessageBus,
    config: Partial<import("@agentforge/shared").AgentConfig> = {}
  ) {
    super(id, "CoordinatorAgent", config);
    this.messageBus = messageBus ?? new MessageBus();
  }

  protected async process(task: Task): Promise<Record<string, unknown>> {
    const subtasks =
      (task.payload["subtasks"] as Array<{
        name: string;
        type: string;
        payload: Record<string, unknown>;
      }>) ?? [];

    if (subtasks.length === 0) {
      // No subtasks — run as single coordinated task
      return this.processSingle(task);
    }

    // Fan-out: delegate subtasks to SubAgents in parallel
    const configs = subtasks.map((st) => ({
      config: {
        name: st.name,
        description: `Subtask: ${st.type}`,
        tools: ["Read", "Grep", "Bash"],
        delegationMode: "wait_for_result" as const,
        timeoutMs: 30_000,
      } satisfies SubAgentConfig,
      task: {
        ...task,
        id: `${task.id}-${st.name}`,
        type: st.type,
        payload: st.payload,
      },
      handler: async (context: import("../delegation/sub-agent.js").SubAgentContext) => {
        context.recordToolUse("internal");
        // Each subtask processes its own payload
        return {
          subtaskName: st.name,
          processedPayload: st.payload,
          completedAt: new Date().toISOString(),
        };
      },
    }));

    const results = await this.delegator.delegateParallel(configs, this.id);

    // Aggregate results
    const successful = results.filter((r) => r.status === "completed");
    const failed = results.filter((r) => r.status !== "completed");
    const allObstacles = results.flatMap((r) => r.obstacles);

    // Notify via MessageBus
    this.messageBus.send({
      from: this.id,
      to: "system",
      type: "result",
      payload: {
        coordinatedTask: task.id,
        totalSubtasks: results.length,
        successful: successful.length,
        failed: failed.length,
      },
      priority: failed.length > 0 ? "high" : "normal",
    });

    return {
      coordination: failed.length === 0 ? "success" : "partial",
      totalSubtasks: results.length,
      completed: successful.length,
      failed: failed.length,
      results: results.map((r) => ({
        name: r.subAgentName,
        status: r.status,
        duration: r.duration,
        summary: r.summary,
        obstacleCount: r.obstacles.length,
      })),
      totalDuration: results.reduce((sum, r) => sum + r.duration, 0),
      obstacles: allObstacles,
      messageSent: true,
    };
  }

  private async processSingle(task: Task): Promise<Record<string, unknown>> {
    // Single task — delegate to one SubAgent
    const result = await this.delegator.delegate(
      {
        name: "coordinator-worker",
        description: "Single coordinated task execution",
        tools: ["Read", "Grep", "Bash"],
        delegationMode: "wait_for_result",
        timeoutMs: 30_000,
      },
      this.id,
      task,
      async (context) => {
        context.recordToolUse("internal");
        return {
          processed: true,
          taskType: task.type,
          payload: task.payload,
        };
      }
    );

    return {
      coordination: result.status === "completed" ? "success" : "failed",
      result: {
        name: result.subAgentName,
        status: result.status,
        summary: result.summary,
        duration: result.duration,
      },
      obstacles: result.obstacles,
    };
  }
}
