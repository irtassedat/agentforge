import type { SubAgentConfig, SubAgentResult, Task } from "@agentforge/shared";
import { SubAgent } from "./sub-agent.js";
import type { SubAgentContext } from "./sub-agent.js";
import { EventEmitter } from "node:events";
import pino from "pino";

/**
 * Delegator — Manages SubAgent lifecycle and delegation decisions.
 *
 * Decision rule from Anthropic course:
 * "Does the intermediate work matter?"
 * - No -> delegate to SubAgent
 * - Yes -> keep in main thread
 */
export class Delegator extends EventEmitter {
  private subAgents = new Map<string, SubAgent>();
  private logger = pino({ name: "delegator" });
  private _history: SubAgentResult[] = [];
  private readonly maxHistory = 100;

  /** Create and register a new SubAgent */
  createSubAgent(config: SubAgentConfig): SubAgent {
    const subAgent = new SubAgent(config);

    subAgent.on("delegation_complete", (result: SubAgentResult) => {
      this.addToHistory(result);
      this.emit("delegation_complete", result);
    });

    subAgent.on("delegation_failed", (result: SubAgentResult) => {
      this.addToHistory(result);
      this.emit("delegation_failed", result);
    });

    this.subAgents.set(subAgent.id, subAgent);
    this.logger.info({ subAgentId: subAgent.id, name: config.name }, "SubAgent created");
    return subAgent;
  }

  /** Delegate a task to a new SubAgent */
  async delegate(
    config: SubAgentConfig,
    parentAgentId: string,
    task: Task,
    handler: (context: SubAgentContext) => Promise<Record<string, unknown>>
  ): Promise<SubAgentResult> {
    const subAgent = this.createSubAgent(config);
    try {
      return await subAgent.delegate(parentAgentId, task, handler);
    } finally {
      this.subAgents.delete(subAgent.id);
    }
  }

  /** Delegate to multiple SubAgents in parallel */
  async delegateParallel(
    configs: Array<{
      config: SubAgentConfig;
      task: Task;
      handler: (context: SubAgentContext) => Promise<Record<string, unknown>>;
    }>,
    parentAgentId: string
  ): Promise<SubAgentResult[]> {
    const promises = configs.map(({ config, task, handler }) =>
      this.delegate(config, parentAgentId, task, handler)
    );
    return Promise.all(promises);
  }

  /** Get delegation history */
  get history(): readonly SubAgentResult[] {
    return this._history;
  }

  /** Get active SubAgent count */
  get activeCount(): number {
    return this.subAgents.size;
  }

  private addToHistory(result: SubAgentResult): void {
    this._history.push(result);
    if (this._history.length > this.maxHistory) {
      this._history = this._history.slice(-this.maxHistory);
    }
  }
}
