import { BaseAgent } from "../runtime/base-agent.js";
import { SkillRegistry } from "../skills/skill-registry.js";
import { BaseSkill } from "../skills/base-skill.js";
import type { Task, SkillContext, SkillResult } from "@agentforge/shared";

/** Built-in skill: Collect data from a source */
class CollectSkill extends BaseSkill {
  readonly name = "collect";
  readonly description = "Collects data from configured sources";
  readonly triggerPhrases = ["collect", "fetch", "gather", "scrape", "pull data"];
  readonly outputFormat = [
    { name: "source", type: "text" as const, required: true },
    { name: "recordCount", type: "metric" as const, required: true },
    { name: "data", type: "list" as const, required: true },
  ];

  protected async execute(context: SkillContext): Promise<Record<string, unknown>> {
    const source = (context.params?.["source"] as string) ?? "default";
    const url = context.task.payload["url"] as string | undefined;

    if (url) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          this.reportObstacle({
            type: "network",
            description: `HTTP ${response.status} from ${url}`,
            workaround: "Using cached data if available",
            severity: "warning",
          });
          return { source, recordCount: 0, data: [], status: "degraded" };
        }
        const data = (await response.json()) as unknown[];
        return { source: url, recordCount: data.length, data };
      } catch (err) {
        this.reportObstacle({
          type: "network",
          description: `Failed to fetch ${url}: ${err instanceof Error ? err.message : String(err)}`,
          severity: "critical",
        });
        return { source: url, recordCount: 0, data: [], status: "failed" };
      }
    }

    // Demo mode — generate sample data
    const records = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      value: Math.random() * 100,
      timestamp: new Date().toISOString(),
    }));

    return { source, recordCount: records.length, data: records };
  }
}

/** Built-in skill: Transform/process collected data */
class TransformSkill extends BaseSkill {
  readonly name = "transform";
  readonly description = "Transforms and processes raw data";
  readonly triggerPhrases = ["transform", "process", "normalize", "clean", "parse"];
  readonly outputFormat = [
    { name: "inputCount", type: "metric" as const, required: true },
    { name: "outputCount", type: "metric" as const, required: true },
    { name: "transformations", type: "list" as const, required: true },
    { name: "data", type: "list" as const, required: true },
  ];

  protected async execute(context: SkillContext): Promise<Record<string, unknown>> {
    const data = (context.params?.["data"] as unknown[]) ?? [];
    const transformations: string[] = [];

    // Filter nulls
    const filtered = data.filter((item) => item != null);
    if (filtered.length < data.length) {
      transformations.push(`Removed ${data.length - filtered.length} null records`);
    }

    // Normalize (if objects with 'value' field)
    const normalized = filtered.map((item) => {
      if (typeof item === "object" && item !== null && "value" in item) {
        const record = item as Record<string, unknown>;
        return { ...record, value: Math.round(Number(record["value"]) * 100) / 100 };
      }
      return item;
    });
    transformations.push("Normalized numeric values to 2 decimal places");

    return {
      inputCount: data.length,
      outputCount: normalized.length,
      transformations,
      data: normalized,
    };
  }
}

/** Built-in skill: Validate processed data */
class ValidateSkill extends BaseSkill {
  readonly name = "validate";
  readonly description = "Validates data against rules";
  readonly triggerPhrases = ["validate", "verify", "check", "audit"];
  readonly outputFormat = [
    { name: "totalRecords", type: "metric" as const, required: true },
    { name: "validCount", type: "metric" as const, required: true },
    { name: "invalidCount", type: "metric" as const, required: true },
    { name: "errors", type: "list" as const, required: false },
    { name: "passRate", type: "metric" as const, required: true },
  ];

  protected async execute(context: SkillContext): Promise<Record<string, unknown>> {
    const data = (context.params?.["data"] as unknown[]) ?? [];
    const errors: string[] = [];
    let validCount = 0;

    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      if (typeof item !== "object" || item === null) {
        errors.push(`Record ${i}: not an object`);
        continue;
      }
      const record = item as Record<string, unknown>;
      if (!("id" in record)) {
        errors.push(`Record ${i}: missing id`);
        continue;
      }
      validCount++;
    }

    const invalidCount = data.length - validCount;
    if (invalidCount > 0) {
      this.reportObstacle({
        type: "other",
        description: `${invalidCount} records failed validation`,
        severity: invalidCount > data.length * 0.5 ? "critical" : "warning",
      });
    }

    return {
      totalRecords: data.length,
      validCount,
      invalidCount,
      errors: errors.slice(0, 10), // cap at 10
      passRate: data.length > 0 ? Math.round((validCount / data.length) * 100) : 0,
    };
  }
}

/**
 * PipelineAgent — Multi-step data processing agent.
 *
 * Executes a pipeline: collect → transform → validate
 * Each step is a skill with structured output and obstacle reporting.
 */
export class PipelineAgent extends BaseAgent {
  readonly skillRegistry = new SkillRegistry();

  constructor(id: string, config: Partial<import("@agentforge/shared").AgentConfig> = {}) {
    super(id, "PipelineAgent", config);

    // Register built-in pipeline skills
    this.skillRegistry.register(new CollectSkill());
    this.skillRegistry.register(new TransformSkill());
    this.skillRegistry.register(new ValidateSkill());
  }

  protected async process(task: Task): Promise<Record<string, unknown>> {
    const results: SkillResult[] = [];
    const context = { task, agentId: this.id };

    // Step 1: Collect
    const collectResult = await this.skillRegistry.execute("collect", {
      ...context,
      params: { source: task.payload["source"] },
    });
    results.push(collectResult);

    if (collectResult.status === "failed") {
      return { pipeline: "failed", step: "collect", results };
    }

    // Step 2: Transform
    const transformResult = await this.skillRegistry.execute("transform", {
      ...context,
      params: { data: collectResult.output["data"] },
    });
    results.push(transformResult);

    // Step 3: Validate
    const validateResult = await this.skillRegistry.execute("validate", {
      ...context,
      params: { data: transformResult.output["data"] },
    });
    results.push(validateResult);

    const allObstacles = results.flatMap((r) => r.obstacles);
    const hasCritical = allObstacles.some((o) => o.severity === "critical");

    return {
      pipeline: hasCritical ? "completed_with_errors" : "success",
      steps: results.map((r) => ({
        skill: r.skillName,
        status: r.status,
        duration: r.duration,
        obstacleCount: r.obstacles.length,
      })),
      totalDuration: results.reduce((sum, r) => sum + r.duration, 0),
      obstacles: allObstacles,
      finalData: validateResult.output,
    };
  }
}
