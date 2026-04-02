import type { FastifyInstance } from "fastify";
import type { AgentRegistry } from "@agentforge/agents";
import type { WSEvent } from "@agentforge/shared";

export async function wsHandler(app: FastifyInstance) {
  const registry = (app as unknown as { registry: AgentRegistry }).registry;
  const clients = new Set<{ send: (data: string) => void }>();

  // Broadcast helper
  const broadcast = (event: WSEvent) => {
    const data = JSON.stringify(event);
    for (const client of clients) {
      try {
        client.send(data);
      } catch {
        clients.delete(client);
      }
    }
  };

  // Subscribe to registry events
  registry.on("heartbeat", (hb) => broadcast({ type: "heartbeat", data: hb }));
  registry.on("agent_change", (agent) => broadcast({ type: "agent_status", data: agent }));
  registry.on("task_complete", (task) => broadcast({ type: "task_update", data: task }));
  registry.on("task_dlq", (task) => broadcast({ type: "dlq_entry", data: task }));

  // WebSocket endpoint
  app.get("/", { websocket: true }, (socket) => {
    clients.add(socket);
    app.log.info({ clients: clients.size }, "WebSocket client connected");

    // Send initial state
    const agents = registry.list();
    const metrics = registry.getSystemMetrics();
    socket.send(
      JSON.stringify({
        type: "metrics",
        data: {
          timestamp: new Date(),
          agents: metrics,
          tasks: { pending: 0, processing: 0, completed: 0, failed: 0, deadLettered: 0 },
          queues: [],
          memory: {
            totalMb: Math.round(process.memoryUsage().heapTotal / (1024 * 1024)),
            usedMb: Math.round(process.memoryUsage().heapUsed / (1024 * 1024)),
          },
        },
      })
    );

    for (const agent of agents) {
      socket.send(JSON.stringify({ type: "agent_status", data: agent }));
    }

    socket.on("close", () => {
      clients.delete(socket);
      app.log.info({ clients: clients.size }, "WebSocket client disconnected");
    });
  });
}
