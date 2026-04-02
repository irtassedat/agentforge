import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { AgentRegistry, HttpWorkerAgent, SchedulerAgent, WatchdogAgent } from "@agentforge/agents";
import { agentRoutes } from "./routes/agents.js";
import { taskRoutes } from "./routes/tasks.js";
import { metricsRoutes } from "./routes/metrics.js";
import { wsHandler } from "./routes/ws.js";

const PORT = Number(process.env.API_PORT) || 3000;
const HOST = process.env.API_HOST || "0.0.0.0";

async function bootstrap() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
      transport:
        process.env.NODE_ENV !== "production"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
  });

  await app.register(cors, { origin: true });
  await app.register(websocket);

  // Initialize agent registry with built-in agents
  const registry = new AgentRegistry();

  // Register demo agents
  const httpWorker = new HttpWorkerAgent("http-worker-1", { concurrency: 5 });
  const scheduler = new SchedulerAgent("scheduler-1");
  const watchdog = new WatchdogAgent("watchdog-1", registry);

  registry.register(httpWorker);
  registry.register(scheduler);
  registry.register(watchdog);

  // Decorate Fastify with registry for route access
  app.decorate("registry", registry);

  // Register routes
  await app.register(agentRoutes, { prefix: "/api/agents" });
  await app.register(taskRoutes, { prefix: "/api/tasks" });
  await app.register(metricsRoutes, { prefix: "/api/metrics" });
  await app.register(wsHandler, { prefix: "/ws" });

  // Health check
  app.get("/health", async () => ({
    status: "ok",
    version: "0.1.0",
    uptime: process.uptime(),
    agents: registry.getSystemMetrics(),
  }));

  // Start server
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`AgentForge API running on http://${HOST}:${PORT}`);

  // Auto-start watchdog
  await watchdog.start();
  app.log.info("Watchdog agent started — monitoring agent health");

  // Graceful shutdown
  const shutdown = async () => {
    app.log.info("Shutting down...");
    for (const agent of registry.list()) {
      if (agent.status === "running") {
        await registry.execute({ action: "stop", agentId: agent.id });
      }
    }
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrap().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
