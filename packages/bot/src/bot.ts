import { Bot, Context, session } from "grammy";
import pino from "pino";

const logger = pino({ name: "agentforge-bot" });

const API_URL = process.env.API_URL || "http://localhost:3000";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
  logger.error("TELEGRAM_BOT_TOKEN is required");
  process.exit(1);
}

interface SessionData {
  lastCommand: string | null;
}

const bot = new Bot<Context & { session: SessionData }>(BOT_TOKEN);

bot.use(session({ initial: (): SessionData => ({ lastCommand: null }) }));

/** Fetch from AgentForge API */
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "API error");
  return data.data;
}

// ─── Commands ───────────────────────────────────────────

bot.command("start", (ctx) =>
  ctx.reply(
    "⚡ *AgentForge Bot*\n\n" +
      "Commands:\n" +
      "/agents — List all agents\n" +
      "/status — System metrics\n" +
      "/start\\_agent `<id>` — Start an agent\n" +
      "/stop\\_agent `<id>` — Stop an agent\n" +
      "/restart\\_agent `<id>` — Restart an agent\n" +
      "/tasks — Recent tasks\n" +
      "/dlq — Dead letter queue\n" +
      "/health — API health check",
    { parse_mode: "Markdown" }
  )
);

bot.command("agents", async (ctx) => {
  try {
    const agents = await api<Array<{
      id: string;
      status: string;
      tasksProcessed: number;
      tasksFailed: number;
      uptime: number;
    }>>("/api/agents");

    if (agents.length === 0) {
      return ctx.reply("No agents registered.");
    }

    const statusIcon = (s: string) =>
      s === "running" ? "🟢" : s === "paused" ? "🟡" : s === "failed" ? "🔴" : "⚪";

    const lines = agents.map(
      (a) =>
        `${statusIcon(a.status)} \`${a.id}\` — ${a.status}\n   ✅ ${a.tasksProcessed} processed · ❌ ${a.tasksFailed} failed`
    );

    await ctx.reply(`*Agents (${agents.length})*\n\n${lines.join("\n\n")}`, {
      parse_mode: "Markdown",
    });
  } catch (err) {
    await ctx.reply(`❌ Error: ${err instanceof Error ? err.message : "Unknown"}`);
  }
});

bot.command("status", async (ctx) => {
  try {
    const metrics = await api<{
      agents: { total: number; running: number; failed: number; idle: number };
      performance: { totalProcessed: number; totalFailed: number; totalMemoryMb: number };
      system: { nodeVersion: string; uptime: number; memoryMb: number };
    }>("/api/metrics");

    const upH = Math.floor(metrics.system.uptime / 3600);
    const upM = Math.floor((metrics.system.uptime % 3600) / 60);

    await ctx.reply(
      `📊 *System Status*\n\n` +
        `*Agents:* ${metrics.agents.total} total — 🟢 ${metrics.agents.running} running · 🔴 ${metrics.agents.failed} failed · ⚪ ${metrics.agents.idle} idle\n\n` +
        `*Tasks:* ✅ ${metrics.performance.totalProcessed} processed · ❌ ${metrics.performance.totalFailed} failed\n` +
        `*Memory:* ${metrics.performance.totalMemoryMb}MB agents · ${metrics.system.memoryMb}MB heap\n` +
        `*Uptime:* ${upH}h ${upM}m\n` +
        `*Node:* ${metrics.system.nodeVersion}`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    await ctx.reply(`❌ Error: ${err instanceof Error ? err.message : "Unknown"}`);
  }
});

/** Generic command handler for agent actions */
async function agentAction(ctx: Context, action: string) {
  const agentId = ctx.message?.text?.split(" ")[1];
  if (!agentId) {
    return ctx.reply(`Usage: /${action}_agent \`<agent-id>\``, { parse_mode: "Markdown" });
  }

  try {
    const result = await api<{ id: string; status: string }>(
      `/api/agents/${agentId}/command`,
      { method: "POST", body: JSON.stringify({ action }) }
    );
    await ctx.reply(`✅ Agent \`${result.id}\` → *${result.status}*`, { parse_mode: "Markdown" });
  } catch (err) {
    await ctx.reply(`❌ ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

bot.command("start_agent", (ctx) => agentAction(ctx, "start"));
bot.command("stop_agent", (ctx) => agentAction(ctx, "stop"));
bot.command("restart_agent", (ctx) => agentAction(ctx, "restart"));

bot.command("tasks", async (ctx) => {
  try {
    const tasks = await api<Array<{
      id: string;
      type: string;
      status: string;
      agentId: string;
      attempts: number;
    }>>("/api/tasks?limit=10");

    if (tasks.length === 0) return ctx.reply("No tasks yet.");

    const icon = (s: string) =>
      s === "completed" ? "✅" : s === "processing" ? "⏳" : s === "failed" ? "❌" : s === "dead_letter" ? "💀" : "⏸";

    const lines = tasks.map(
      (t) => `${icon(t.status)} \`${t.type}\` → ${t.status} (${t.agentId})`
    );

    await ctx.reply(`*Recent Tasks*\n\n${lines.join("\n")}`, { parse_mode: "Markdown" });
  } catch (err) {
    await ctx.reply(`❌ Error: ${err instanceof Error ? err.message : "Unknown"}`);
  }
});

bot.command("dlq", async (ctx) => {
  try {
    const entries = await api<Array<{
      id: string;
      type: string;
      agentId: string;
      attempts: number;
    }>>("/api/tasks/dlq");

    if (entries.length === 0) return ctx.reply("✅ DLQ is empty!");

    const lines = entries.map(
      (t) => `💀 \`${t.type}\` — ${t.agentId} (${t.attempts} attempts)`
    );

    await ctx.reply(`*Dead Letter Queue (${entries.length})*\n\n${lines.join("\n")}`, {
      parse_mode: "Markdown",
    });
  } catch (err) {
    await ctx.reply(`❌ Error: ${err instanceof Error ? err.message : "Unknown"}`);
  }
});

bot.command("health", async (ctx) => {
  try {
    const start = Date.now();
    const health = await api<{ status: string; version: string }>("/health");
    const latency = Date.now() - start;

    await ctx.reply(
      `💚 *API Health*\n\nStatus: ${health.status}\nVersion: ${health.version}\nLatency: ${latency}ms`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    await ctx.reply(`🔴 API unreachable: ${err instanceof Error ? err.message : "Unknown"}`);
  }
});

// ─── Start Bot ──────────────────────────────────────────

bot.catch((err) => {
  logger.error({ err: err.error }, "Bot error");
});

bot.start({
  onStart: () => logger.info("AgentForge Telegram bot started"),
});

process.on("SIGINT", () => bot.stop());
process.on("SIGTERM", () => bot.stop());
