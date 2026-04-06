import type { SkillDefinition, SkillResult, SkillContext } from "@agentforge/shared";
import type { BaseSkill } from "./base-skill.js";
import { EventEmitter } from "node:events";
import pino from "pino";

interface SkillMatch {
  skill: BaseSkill;
  confidence: number;
}

/**
 * SkillRegistry — Discovers, matches, and executes skills.
 *
 * Handles skill registration, semantic matching against input,
 * and execution with event emission.
 */
export class SkillRegistry extends EventEmitter {
  private skills = new Map<string, BaseSkill>();
  private logger = pino({ name: "skill-registry" });

  /** Register a skill */
  register(skill: BaseSkill): void {
    if (this.skills.has(skill.name)) {
      throw new Error(`Skill "${skill.name}" already registered`);
    }
    this.skills.set(skill.name, skill);
    this.logger.info({ skill: skill.name }, "Skill registered");
  }

  /** Unregister a skill */
  unregister(name: string): boolean {
    const removed = this.skills.delete(name);
    if (removed) {
      this.logger.info({ skill: name }, "Skill unregistered");
    }
    return removed;
  }

  /** Get a skill by name */
  get(name: string): BaseSkill | undefined {
    return this.skills.get(name);
  }

  /** List all registered skill definitions */
  list(): SkillDefinition[] {
    return Array.from(this.skills.values()).map((s) => s.toDefinition());
  }

  /** Find the best matching skill for an input (returns null if no match above threshold) */
  match(input: string, threshold = 0.15): BaseSkill | null {
    const matches = this.matchAll(input, threshold);
    return matches.length > 0 ? matches[0].skill : null;
  }

  /** Find all matching skills sorted by confidence (descending) */
  matchAll(input: string, threshold = 0.15): SkillMatch[] {
    const matches: SkillMatch[] = [];

    for (const skill of this.skills.values()) {
      const confidence = skill.matches(input);
      if (confidence >= threshold) {
        matches.push({ skill, confidence });
      }
    }

    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  /** Execute a skill by name */
  async execute(name: string, context: SkillContext): Promise<SkillResult> {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(`Skill "${name}" not found`);
    }

    this.logger.info({ skill: name, agentId: context.agentId }, "Executing skill");
    this.emit("skill_start", { skillName: name, agentId: context.agentId });

    const result = await skill.run(context);

    if (result.status === "success" || result.status === "partial") {
      this.emit("skill_complete", result);
      this.logger.info(
        { skill: name, duration: result.duration, status: result.status },
        "Skill completed"
      );
    } else {
      this.emit("skill_failed", result);
      this.logger.error({ skill: name, obstacles: result.obstacles }, "Skill failed");
    }

    return result;
  }

  /** Execute the best matching skill for an input */
  async matchAndExecute(input: string, context: SkillContext): Promise<SkillResult | null> {
    const skill = this.match(input);
    if (!skill) return null;
    return this.execute(skill.name, context);
  }

  /** Get registry stats */
  get stats() {
    return {
      totalSkills: this.skills.size,
      skills: Array.from(this.skills.values()).map((s) => ({
        name: s.name,
        executionCount: s.executionCount,
        onCooldown: s.isOnCooldown(),
        cooldownRemaining: s.cooldownRemaining(),
      })),
    };
  }
}
