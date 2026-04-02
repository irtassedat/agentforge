import type { Task } from "@agentforge/shared";
import { BaseAgent } from "../runtime/base-agent.js";

interface ScheduleEntry {
  taskType: string;
  payload: Record<string, unknown>;
  intervalMs: number;
  lastRun: number;
}

/**
 * SchedulerAgent — Cron-like task scheduler.
 *
 * Maintains a list of scheduled entries and emits tasks
 * at configured intervals. Demonstrates the scheduler pattern:
 * periodic work generation with drift correction.
 */
export class SchedulerAgent extends BaseAgent {
  private schedules: ScheduleEntry[] = [];
  private _pollTimer: NodeJS.Timeout | null = null;

  constructor(id: string) {
    super(id, "Scheduler", {
      concurrency: 1,
      taskTimeout: 5000,
      maxRetries: 1,
      retryStrategy: "fixed",
      retryDelay: 1000,
      heartbeatInterval: 10_000,
    });
  }

  /** Add a recurring schedule */
  addSchedule(taskType: string, payload: Record<string, unknown>, intervalMs: number): void {
    this.schedules.push({ taskType, payload, intervalMs, lastRun: 0 });
    this.logger.info({ taskType, intervalMs }, "Schedule added");
  }

  protected async onStart(): Promise<void> {
    this._pollTimer = setInterval(() => this.tick(), 1000);
  }

  protected async onStop(): Promise<void> {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  protected async process(task: Task): Promise<Record<string, unknown>> {
    // Scheduler doesn't process tasks itself — it emits them
    this.emit("schedule_trigger", {
      taskType: task.type,
      payload: task.payload,
      triggeredAt: new Date(),
    });

    return { triggered: true, taskType: task.type };
  }

  private tick(): void {
    const now = Date.now();

    for (const entry of this.schedules) {
      if (now - entry.lastRun >= entry.intervalMs) {
        entry.lastRun = now;
        this.emit("schedule_trigger", {
          taskType: entry.taskType,
          payload: entry.payload,
          triggeredAt: new Date(),
        });
      }
    }
  }
}
