import { EventEmitter } from "node:events";
import type {
  AgentConfig,
  Task,
  Heartbeat,
} from "@agentforge/shared";
import { nanoid } from "nanoid";
import pino from "pino";

const DEFAULT_CONFIG: AgentConfig = {
  concurrency: 1,
  taskTimeout: 30_000,
  maxRetries: 3,
  retryStrategy: "exponential",
  retryDelay: 1000,
  heartbeatInterval: 5000,
};

/**
 * BaseAgent — Abstract foundation for all agent types.
 *
 * Handles lifecycle management, heartbeat, task processing loop,
 * retry logic with configurable backoff, and dead letter queue routing.
 *
 * Subclasses implement `process(task)` to define behavior.
 */
export abstract class BaseAgent extends EventEmitter {
  readonly id: string;
  readonly instanceId: string;
  readonly name: string;
  protected config: AgentConfig;
  protected logger: pino.Logger;

  private _status: AgentStatus = "idle";
  private _startedAt: Date | null = null;
  private _tasksProcessed = 0;
  private _tasksFailed = 0;
  private _currentTask: string | null = null;
  private _lastError: string | null = null;
  private _heartbeatTimer: NodeJS.Timeout | null = null;
  private _processing = false;
  private _activeCount = 0;

  constructor(id: string, name: string, config: Partial<AgentConfig> = {}) {
    super();
    this.id = id;
    this.instanceId = nanoid(12);
    this.name = name;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = pino({ name: `agent:${name}` });
  }

  get status(): AgentStatus {
    return this._status;
  }

  get stats() {
    return {
      tasksProcessed: this._tasksProcessed,
      tasksFailed: this._tasksFailed,
      currentTask: this._currentTask,
      lastError: this._lastError,
      uptime: this._startedAt ? Date.now() - this._startedAt.getTime() : 0,
      memoryUsage: process.memoryUsage().heapUsed,
    };
  }

  /** Start the agent — begins heartbeat and processing loop */
  async start(): Promise<void> {
    if (this._status === "running") return;

    this.logger.info({ agentId: this.id }, "Agent starting");
    this._status = "running";
    this._startedAt = new Date();

    await this.onStart();
    this.startHeartbeat();
    this.emit("started", this.id);
  }

  /** Graceful stop — finishes current task, then shuts down */
  async stop(): Promise<void> {
    if (this._status !== "running" && this._status !== "paused") return;

    this.logger.info({ agentId: this.id }, "Agent stopping");
    this._status = "terminated";

    this.stopHeartbeat();
    await this.onStop();
    this.emit("stopped", this.id);
  }

  /** Pause — stops picking new tasks, current task finishes */
  pause(): void {
    if (this._status !== "running") return;
    this._status = "paused";
    this.logger.info({ agentId: this.id }, "Agent paused");
    this.emit("paused", this.id);
  }

  /** Resume from paused state */
  resume(): void {
    if (this._status !== "paused") return;
    this._status = "running";
    this.logger.info({ agentId: this.id }, "Agent resumed");
    this.emit("resumed", this.id);
  }

  /** Execute a task with retry logic and timeout */
  async executeTask(task: Task): Promise<Task> {
    if (this._status !== "running") {
      throw new Error(`Agent ${this.id} is not running (status: ${this._status})`);
    }

    while (this._activeCount >= this.config.concurrency) {
      await new Promise((r) => setTimeout(r, 100));
    }

    this._activeCount++;
    this._currentTask = task.id;
    task.status = "processing";
    task.startedAt = new Date();

    this.emit("task_start", task);
    this.logger.info({ taskId: task.id, type: task.type }, "Processing task");

    try {
      const result = await this.withTimeout(
        this.process(task),
        this.config.taskTimeout
      );

      task.status = "completed";
      task.result = result;
      task.completedAt = new Date();
      this._tasksProcessed++;

      this.emit("task_complete", task);
      this.logger.info({ taskId: task.id, took: Date.now() - task.startedAt!.getTime() }, "Task completed");
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      task.attempts++;
      this._lastError = error;

      if (task.attempts >= task.maxAttempts) {
        task.status = "dead_letter";
        task.error = error;
        this._tasksFailed++;
        this.emit("task_dlq", task);
        this.logger.error({ taskId: task.id, attempts: task.attempts, error }, "Task sent to DLQ");
      } else {
        task.status = "queued";
        task.error = error;
        const delay = this.calculateRetryDelay(task.attempts);
        this.emit("task_retry", { task, delay });
        this.logger.warn({ taskId: task.id, attempt: task.attempts, delay }, "Task retry scheduled");
      }
    } finally {
      this._activeCount--;
      this._currentTask = null;
    }

    return task;
  }

  /** Subclasses implement this — the actual work */
  protected abstract process(task: Task): Promise<Record<string, unknown>>;

  /** Hook: called on start */
  protected async onStart(): Promise<void> {}

  /** Hook: called on stop */
  protected async onStop(): Promise<void> {}

  private calculateRetryDelay(attempt: number): number {
    const { retryStrategy, retryDelay } = this.config;
    switch (retryStrategy) {
      case "exponential":
        return retryDelay * Math.pow(2, attempt - 1);
      case "linear":
        return retryDelay * attempt;
      case "fixed":
      default:
        return retryDelay;
    }
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Task timeout after ${ms}ms`)), ms)
    );
    return Promise.race([promise, timeout]);
  }

  private startHeartbeat(): void {
    this._heartbeatTimer = setInterval(() => {
      const hb: Heartbeat = {
        agentId: this.id,
        instanceId: this.instanceId,
        timestamp: new Date(),
        status: this._status,
        metrics: {
          memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          cpuPercent: 0,
          tasksInQueue: 0,
          activeTask: this._currentTask,
        },
      };
      this.emit("heartbeat", hb);
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }
}
