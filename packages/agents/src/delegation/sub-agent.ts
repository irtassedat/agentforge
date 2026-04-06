import { EventEmitter } from "node:events";
import type { SubAgentConfig, SubAgentResult, Obstacle, Task } from "@agentforge/shared";
import { nanoid } from "nanoid";
import pino from "pino";

/**
 * SubAgent — Isolated execution context for delegated tasks.
 *
 * Runs a task independently, collects results and obstacles,
 * then returns a structured summary to the parent agent.
 * All intermediate work (file reads, searches, tool calls)
 * stays in the SubAgent's context.
 */
export class SubAgent extends EventEmitter {
  readonly id: string;
  readonly config: SubAgentConfig;
  private logger: pino.Logger;
  private _obstacles: Obstacle[] = [];
  private _toolsUsed: string[] = [];
  private _startedAt: number = 0;

  constructor(config: SubAgentConfig) {
    super();
    this.id = `sub-${nanoid(8)}`;
    this.config = config;
    this.logger = pino({ name: `subagent:${config.name}` });
  }

  /**
   * Delegate a task to this SubAgent.
   * Runs the handler in isolation and returns structured result.
   */
  async delegate(
    parentAgentId: string,
    task: Task,
    handler: (context: SubAgentContext) => Promise<Record<string, unknown>>
  ): Promise<SubAgentResult> {
    this._startedAt = Date.now();
    this._obstacles = [];
    this._toolsUsed = [];

    this.logger.info(
      { subAgentId: this.id, parentAgentId, taskId: task.id },
      "SubAgent delegated task"
    );

    this.emit("delegation_start", {
      subAgentId: this.id,
      parentAgentId,
      taskType: task.type,
    });

    const context: SubAgentContext = {
      task,
      parentAgentId,
      subAgentId: this.id,
      allowedTools: this.config.tools,
      reportObstacle: (obstacle: Obstacle) => {
        this._obstacles.push(obstacle);
      },
      recordToolUse: (tool: string) => {
        if (!this._toolsUsed.includes(tool)) {
          this._toolsUsed.push(tool);
        }
      },
    };

    const timeoutMs = this.config.timeoutMs ?? 60_000;

    try {
      const output = await this.withTimeout(handler(context), timeoutMs);
      const duration = Date.now() - this._startedAt;

      const result: SubAgentResult = {
        subAgentName: this.config.name,
        parentAgentId,
        status: "completed",
        summary: this.generateSummary(output),
        output,
        obstacles: [...this._obstacles],
        toolsUsed: [...this._toolsUsed],
        duration,
        timestamp: new Date(),
      };

      this.emit("delegation_complete", result);
      this.logger.info(
        { subAgentId: this.id, duration, obstacleCount: this._obstacles.length },
        "SubAgent completed"
      );

      return result;
    } catch (err) {
      const duration = Date.now() - this._startedAt;
      const error = err instanceof Error ? err.message : String(err);
      const isTimeout = error.includes("timeout");

      const result: SubAgentResult = {
        subAgentName: this.config.name,
        parentAgentId,
        status: isTimeout ? "timeout" : "failed",
        summary: `Failed: ${error}`,
        output: { error },
        obstacles: [
          ...this._obstacles,
          {
            type: isTimeout ? "timeout" : "other",
            description: error,
            severity: "critical",
          },
        ],
        toolsUsed: [...this._toolsUsed],
        duration,
        timestamp: new Date(),
      };

      this.emit("delegation_failed", result);
      this.logger.error({ subAgentId: this.id, error }, "SubAgent failed");

      return result;
    }
  }

  /** Check if a tool is allowed for this SubAgent */
  isToolAllowed(tool: string): boolean {
    return this.config.tools.includes(tool);
  }

  private generateSummary(output: Record<string, unknown>): string {
    const keys = Object.keys(output);
    if (keys.length === 0) return "No output produced";
    if (output["summary"] && typeof output["summary"] === "string") {
      return output["summary"] as string;
    }
    return `Produced ${keys.length} output fields: ${keys.join(", ")}`;
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`SubAgent timeout after ${ms}ms`)), ms)
    );
    return Promise.race([promise, timeout]);
  }
}

/** Context passed to SubAgent handler */
export interface SubAgentContext {
  task: Task;
  parentAgentId: string;
  subAgentId: string;
  allowedTools: string[];
  reportObstacle: (obstacle: Obstacle) => void;
  recordToolUse: (tool: string) => void;
}
