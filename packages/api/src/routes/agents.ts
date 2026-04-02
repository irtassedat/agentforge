import type { FastifyInstance } from "fastify";
import type { AgentCommand } from "@agentforge/shared";
import type { AgentRegistry } from "@agentforge/agents";

export async function agentRoutes(app: FastifyInstance) {
  const registry = (app as unknown as { registry: AgentRegistry }).registry;

  /** List all agents */
  app.get("/", async () => {
    return {
      success: true,
      data: registry.list(),
      meta: { total: registry.list().length },
    };
  });

  /** Get agent by ID */
  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const snapshot = registry.getSnapshot(req.params.id);
    if (!snapshot) {
      return reply.status(404).send({ success: false, error: "Agent not found" });
    }
    return { success: true, data: snapshot };
  });

  /** Send command to agent (start/stop/pause/resume/restart) */
  app.post<{ Params: { id: string }; Body: { action: string } }>(
    "/:id/command",
    async (req, reply) => {
      const { id } = req.params;
      const { action } = req.body;

      const validActions = ["start", "stop", "pause", "resume", "restart"];
      if (!validActions.includes(action)) {
        return reply.status(400).send({
          success: false,
          error: `Invalid action. Must be one of: ${validActions.join(", ")}`,
        });
      }

      try {
        await registry.execute({ action, agentId: id } as AgentCommand);
        return {
          success: true,
          data: registry.getSnapshot(id),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return reply.status(400).send({ success: false, error: message });
      }
    }
  );
}
