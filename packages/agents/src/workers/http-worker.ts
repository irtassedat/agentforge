import type { Task } from "@agentforge/shared";
import { BaseAgent } from "../runtime/base-agent.js";

/**
 * HttpWorkerAgent — Executes HTTP requests as tasks.
 *
 * Demonstrates the worker pattern: receives task, executes,
 * returns structured result. Supports GET/POST/PUT/DELETE
 * with configurable headers, body, and timeout.
 */
export class HttpWorkerAgent extends BaseAgent {
  constructor(id: string, config?: { concurrency?: number; taskTimeout?: number }) {
    super(id, "HttpWorker", {
      concurrency: config?.concurrency ?? 5,
      taskTimeout: config?.taskTimeout ?? 15_000,
      maxRetries: 3,
      retryStrategy: "exponential",
      retryDelay: 2000,
    });
  }

  protected async process(task: Task): Promise<Record<string, unknown>> {
    const { url, method = "GET", headers = {}, body } = task.payload as {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
    };

    if (!url) throw new Error("Task payload missing 'url'");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.taskTimeout);

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const contentType = res.headers.get("content-type") || "";
      const data = contentType.includes("json") ? await res.json() : await res.text();

      return {
        statusCode: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        data,
        took: Date.now() - task.startedAt!.getTime(),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
