import { BaseAgent } from "../runtime/base-agent.js";
import { SkillRegistry } from "../skills/skill-registry.js";
import { BaseSkill } from "../skills/base-skill.js";
import type { Task, SkillContext } from "@agentforge/shared";

/** Built-in skill: Check endpoint health */
class HealthCheckSkill extends BaseSkill {
  readonly name = "health-check";
  readonly description = "Checks service health endpoints and reports status";
  readonly triggerPhrases = ["health", "status", "check", "monitor", "is it up", "ping"];
  readonly outputFormat = [
    { name: "overallStatus", type: "text" as const, required: true },
    { name: "services", type: "table" as const, required: true },
    { name: "responseTime", type: "metric" as const, required: true },
    { name: "alertRequired", type: "boolean" as const, required: true },
  ];

  protected async execute(context: SkillContext): Promise<Record<string, unknown>> {
    const endpoints = (context.params?.["endpoints"] as string[]) ?? [
      "https://httpbin.org/status/200",
      "https://jsonplaceholder.typicode.com/posts/1",
    ];

    const services: Array<{
      url: string;
      status: "up" | "down" | "degraded";
      responseMs: number;
      statusCode: number | null;
    }> = [];

    for (const url of endpoints) {
      const start = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        const responseMs = Date.now() - start;

        services.push({
          url,
          status: res.ok ? (responseMs > 5000 ? "degraded" : "up") : "down",
          responseMs,
          statusCode: res.status,
        });

        if (!res.ok) {
          this.reportObstacle({
            type: "network",
            description: `${url} returned HTTP ${res.status}`,
            severity: "warning",
          });
        }
      } catch (err) {
        services.push({
          url,
          status: "down",
          responseMs: Date.now() - start,
          statusCode: null,
        });
        this.reportObstacle({
          type: "network",
          description: `${url} unreachable: ${err instanceof Error ? err.message : String(err)}`,
          severity: "critical",
        });
      }
    }

    const upCount = services.filter((s) => s.status === "up").length;
    const avgResponseTime =
      services.length > 0
        ? Math.round(services.reduce((sum, s) => sum + s.responseMs, 0) / services.length)
        : 0;

    const hasDown = services.some((s) => s.status === "down");
    const hasDegraded = services.some((s) => s.status === "degraded");

    let overallStatus = "OK";
    if (hasDown) overallStatus = "ERROR";
    else if (hasDegraded) overallStatus = "WARN";

    return {
      overallStatus,
      services,
      summary: `${upCount}/${services.length} services healthy`,
      responseTime: avgResponseTime,
      alertRequired: hasDown,
    };
  }
}

/**
 * MonitorAgent — Health monitoring with structured reports.
 *
 * Checks service endpoints, tracks response times,
 * and produces dashboard-style output.
 */
export class MonitorAgent extends BaseAgent {
  readonly skillRegistry = new SkillRegistry();
  private endpoints: string[];

  constructor(
    id: string,
    endpoints: string[] = [],
    config: Partial<import("@agentforge/shared").AgentConfig> = {}
  ) {
    super(id, "MonitorAgent", config);
    this.endpoints = endpoints;
    this.skillRegistry.register(new HealthCheckSkill());
  }

  protected async process(task: Task): Promise<Record<string, unknown>> {
    const endpoints = (task.payload["endpoints"] as string[]) ?? this.endpoints;

    const result = await this.skillRegistry.execute("health-check", {
      task,
      agentId: this.id,
      params: { endpoints },
    });

    return {
      monitorReport: result.output,
      skillStatus: result.status,
      obstacles: result.obstacles,
      checkedAt: new Date().toISOString(),
    };
  }
}
