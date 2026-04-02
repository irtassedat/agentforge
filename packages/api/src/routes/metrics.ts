import type { FastifyInstance } from "fastify";
import type { AgentRegistry } from "@agentforge/agents";

export async function metricsRoutes(app: FastifyInstance) {
  const registry = (app as unknown as { registry: AgentRegistry }).registry;

  /** System-wide metrics */
  app.get("/", async () => {
    const agents = registry.list();
    const running = agents.filter((a) => a.status === "running");

    return {
      success: true,
      data: {
        timestamp: new Date(),
        agents: registry.getSystemMetrics(),
        performance: {
          totalProcessed: agents.reduce((sum, a) => sum + a.tasksProcessed, 0),
          totalFailed: agents.reduce((sum, a) => sum + a.tasksFailed, 0),
          avgUptime: running.length
            ? Math.round(running.reduce((sum, a) => sum + a.uptime, 0) / running.length)
            : 0,
          totalMemoryMb: Math.round(
            agents.reduce((sum, a) => sum + a.memoryUsage, 0) / (1024 * 1024)
          ),
        },
        system: {
          nodeVersion: process.version,
          platform: process.platform,
          uptime: Math.round(process.uptime()),
          memoryMb: Math.round(process.memoryUsage().heapUsed / (1024 * 1024)),
        },
      },
    };
  });
}
