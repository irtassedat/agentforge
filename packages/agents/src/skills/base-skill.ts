import type {
  SkillDefinition,
  SkillResult,
  SkillContext,
  SkillOutputField,
  Obstacle,
} from "@agentforge/shared";

/**
 * BaseSkill — Abstract foundation for all skills.
 *
 * Skills are reusable capabilities that agents can execute.
 * They have semantic matching (trigger phrases), structured output,
 * cooldown enforcement, and obstacle reporting.
 */
export abstract class BaseSkill {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly triggerPhrases: string[];

  readonly outputFormat: SkillOutputField[] = [];
  readonly allowedTools?: string[];
  readonly cooldownMs: number = 0;

  private _lastExecuted = 0;
  private _executionCount = 0;
  private _obstacles: Obstacle[] = [];

  /** Check if input semantically matches this skill */
  matches(input: string): number {
    const lower = input.toLowerCase();
    let score = 0;
    let matched = 0;

    for (const phrase of this.triggerPhrases) {
      if (lower.includes(phrase.toLowerCase())) {
        matched++;
        // Exact match scores higher than partial
        if (lower === phrase.toLowerCase()) {
          score += 1.0;
        } else {
          score += 0.6;
        }
      }
    }

    // Also check against name and description
    if (lower.includes(this.name.toLowerCase())) score += 0.8;

    const words = this.description.toLowerCase().split(/\s+/);
    const inputWords = new Set(lower.split(/\s+/));
    let descriptionOverlap = 0;
    for (const word of words) {
      if (word.length > 3 && inputWords.has(word)) descriptionOverlap++;
    }
    if (descriptionOverlap > 0) score += descriptionOverlap * 0.2;

    // Normalize to 0-1 range
    const maxPossible = this.triggerPhrases.length + 1 + words.length * 0.2;
    return Math.min(1, (score / Math.max(1, maxPossible)) * (matched > 0 ? 2 : 1));
  }

  /** Check if skill is in cooldown */
  isOnCooldown(): boolean {
    if (this.cooldownMs <= 0) return false;
    return Date.now() - this._lastExecuted < this.cooldownMs;
  }

  /** Get remaining cooldown time in ms */
  cooldownRemaining(): number {
    if (!this.isOnCooldown()) return 0;
    return this.cooldownMs - (Date.now() - this._lastExecuted);
  }

  /** Execute skill with structured output and obstacle tracking */
  async run(context: SkillContext): Promise<SkillResult> {
    if (this.isOnCooldown()) {
      return {
        skillName: this.name,
        agentId: context.agentId,
        status: "failed",
        output: { error: `Skill on cooldown. ${this.cooldownRemaining()}ms remaining.` },
        obstacles: [
          {
            type: "timeout",
            description: `Cooldown active: ${this.cooldownRemaining()}ms remaining`,
            severity: "info",
          },
        ],
        duration: 0,
        timestamp: new Date(),
      };
    }

    this._obstacles = [];
    const start = Date.now();

    try {
      const output = await this.execute(context);
      this._lastExecuted = Date.now();
      this._executionCount++;

      return {
        skillName: this.name,
        agentId: context.agentId,
        status: this._obstacles.some((o) => o.severity === "critical") ? "partial" : "success",
        output,
        obstacles: [...this._obstacles],
        duration: Date.now() - start,
        timestamp: new Date(),
      };
    } catch (err) {
      this._lastExecuted = Date.now();
      const error = err instanceof Error ? err.message : String(err);

      return {
        skillName: this.name,
        agentId: context.agentId,
        status: "failed",
        output: { error },
        obstacles: [
          ...this._obstacles,
          { type: "other", description: error, severity: "critical" },
        ],
        duration: Date.now() - start,
        timestamp: new Date(),
      };
    }
  }

  /** Report an obstacle during execution */
  protected reportObstacle(obstacle: Obstacle): void {
    this._obstacles.push(obstacle);
  }

  /** Get skill definition (metadata only, no execution) */
  toDefinition(): SkillDefinition {
    return {
      name: this.name,
      description: this.description,
      triggerPhrases: this.triggerPhrases,
      allowedTools: this.allowedTools,
      cooldownMs: this.cooldownMs,
      outputFormat: this.outputFormat,
    };
  }

  get executionCount(): number {
    return this._executionCount;
  }

  /** Subclasses implement this — the actual skill logic */
  protected abstract execute(context: SkillContext): Promise<Record<string, unknown>>;
}
