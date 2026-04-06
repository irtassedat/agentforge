import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Priority } from "@agentforge/shared";
import { MessageBus } from "./message-bus.js";

function sendMsg(
  bus: MessageBus,
  overrides: {
    from?: string;
    to?: string;
    type?: "task" | "result" | "query" | "broadcast";
    payload?: Record<string, unknown>;
    priority?: Priority;
    expiresAt?: Date;
  } = {}
) {
  return bus.send({
    from: overrides.from ?? "agent-a",
    to: overrides.to ?? "agent-b",
    type: overrides.type ?? "task",
    payload: overrides.payload ?? { data: 1 },
    priority: overrides.priority ?? "normal",
    ...(overrides.expiresAt ? { expiresAt: overrides.expiresAt } : {}),
  });
}

describe("MessageBus", () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus({ maxQueueSize: 5, maxDeadLetters: 3 });
  });

  describe("send()", () => {
    it("adds message to queue", () => {
      sendMsg(bus);
      expect(bus.queueDepth("agent-b")).toBe(1);
    });

    it("assigns id and timestamp", () => {
      const msg = sendMsg(bus);
      expect(msg.id).toBeDefined();
      expect(msg.id.length).toBeGreaterThan(0);
      expect(msg.timestamp).toBeInstanceOf(Date);
    });

    it("respects priority ordering", () => {
      sendMsg(bus, { priority: "low" });
      sendMsg(bus, { priority: "critical" });
      sendMsg(bus, { priority: "normal" });

      const first = bus.peek("agent-b");
      expect(first!.priority).toBe("critical");
    });

    it("inserts high priority before normal", () => {
      sendMsg(bus, { priority: "normal" });
      sendMsg(bus, { priority: "high" });

      const first = bus.peek("agent-b");
      expect(first!.priority).toBe("high");
    });
  });

  describe("receive()", () => {
    it("pops from queue and moves to processing", () => {
      sendMsg(bus);
      expect(bus.queueDepth("agent-b")).toBe(1);

      const msg = bus.receive("agent-b");
      expect(msg).not.toBeNull();
      expect(msg!.from).toBe("agent-a");
      expect(bus.queueDepth("agent-b")).toBe(0);
    });

    it("returns null for empty queue", () => {
      expect(bus.receive("agent-b")).toBeNull();
    });

    it("skips expired messages", () => {
      const past = new Date(Date.now() - 1000);
      sendMsg(bus, { expiresAt: past });
      sendMsg(bus, { payload: { fresh: true } });

      const msg = bus.receive("agent-b");
      expect(msg).not.toBeNull();
      expect(msg!.payload).toEqual({ fresh: true });
    });

    it("returns null when all messages are expired", () => {
      const past = new Date(Date.now() - 1000);
      sendMsg(bus, { expiresAt: past });
      sendMsg(bus, { expiresAt: past });

      expect(bus.receive("agent-b")).toBeNull();
    });
  });

  describe("peek()", () => {
    it("returns message without consuming", () => {
      sendMsg(bus);

      const peeked = bus.peek("agent-b");
      expect(peeked).not.toBeNull();
      expect(bus.queueDepth("agent-b")).toBe(1);

      // Peek again, same message
      const peeked2 = bus.peek("agent-b");
      expect(peeked2!.id).toBe(peeked!.id);
    });

    it("returns null for empty queue", () => {
      expect(bus.peek("agent-b")).toBeNull();
    });
  });

  describe("ack()", () => {
    it("removes from processing", () => {
      sendMsg(bus);
      const msg = bus.receive("agent-b")!;

      const ack = bus.ack("agent-b", msg.id, { processed: true });
      expect(ack.messageId).toBe(msg.id);
      expect(ack.agentId).toBe("agent-b");
      expect(ack.status).toBe("completed");
      expect(ack.result).toEqual({ processed: true });
      expect(ack.timestamp).toBeInstanceOf(Date);
    });
  });

  describe("nack()", () => {
    it("moves message to dead letter queue", () => {
      sendMsg(bus);
      const msg = bus.receive("agent-b")!;

      bus.nack("agent-b", msg.id);

      const deadLetters = bus.getDeadLetters();
      expect(deadLetters).toHaveLength(1);
      expect(deadLetters[0].id).toBe(msg.id);
    });
  });

  describe("broadcast()", () => {
    it("sends to all agents except sender", () => {
      // Create queues for several agents by sending initial messages
      sendMsg(bus, { from: "sender", to: "agent-1" });
      sendMsg(bus, { from: "sender", to: "agent-2" });
      sendMsg(bus, { from: "sender", to: "sender" }); // self-queue

      // Clear existing messages
      bus.clearQueue("agent-1");
      bus.clearQueue("agent-2");
      bus.clearQueue("sender");

      const messages = bus.broadcast("sender", { alert: true });

      // Should send to agent-1 and agent-2, but not sender
      expect(messages).toHaveLength(2);
      expect(messages.every((m) => m.to !== "sender")).toBe(true);
      expect(messages.every((m) => m.from === "sender")).toBe(true);
      expect(messages.every((m) => m.type === "broadcast")).toBe(true);
    });
  });

  describe("queueDepth()", () => {
    it("returns correct count", () => {
      expect(bus.queueDepth("agent-b")).toBe(0);
      sendMsg(bus);
      expect(bus.queueDepth("agent-b")).toBe(1);
      sendMsg(bus);
      expect(bus.queueDepth("agent-b")).toBe(2);
    });

    it("returns 0 for unknown agent", () => {
      expect(bus.queueDepth("nonexistent")).toBe(0);
    });
  });

  describe("clearQueue()", () => {
    it("empties the queue and returns count", () => {
      sendMsg(bus);
      sendMsg(bus);
      sendMsg(bus);

      const cleared = bus.clearQueue("agent-b");
      expect(cleared).toBe(3);
      expect(bus.queueDepth("agent-b")).toBe(0);
    });

    it("returns 0 for non-existent queue", () => {
      expect(bus.clearQueue("nonexistent")).toBe(0);
    });
  });

  describe("queue overflow", () => {
    it("drops message to dead letter when queue is full", () => {
      // maxQueueSize is 5
      for (let i = 0; i < 5; i++) {
        sendMsg(bus, { payload: { i } });
      }
      expect(bus.queueDepth("agent-b")).toBe(5);

      // This one should overflow
      sendMsg(bus, { payload: { overflow: true } });

      const deadLetters = bus.getDeadLetters();
      expect(deadLetters).toHaveLength(1);
      expect(deadLetters[0].payload).toEqual({ overflow: true });
    });

    it("trims dead letters when exceeding max", () => {
      // maxDeadLetters is 3, maxQueueSize is 5
      // Fill queue
      for (let i = 0; i < 5; i++) {
        sendMsg(bus, { payload: { i } });
      }

      // Overflow 5 messages — only last 3 should remain in dead letters
      for (let i = 0; i < 5; i++) {
        sendMsg(bus, { payload: { overflow: i } });
      }

      const deadLetters = bus.getDeadLetters();
      expect(deadLetters.length).toBeLessThanOrEqual(3);
    });
  });

  describe("events", () => {
    it("emits message_sent", () => {
      const handler = vi.fn();
      bus.on("message_sent", handler);

      sendMsg(bus);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ from: "agent-a", to: "agent-b" })
      );
    });

    it("emits message_received", () => {
      const handler = vi.fn();
      bus.on("message_received", handler);

      sendMsg(bus);
      bus.receive("agent-b");

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("emits message_ack", () => {
      const handler = vi.fn();
      bus.on("message_ack", handler);

      sendMsg(bus);
      const msg = bus.receive("agent-b")!;
      bus.ack("agent-b", msg.id);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: msg.id, agentId: "agent-b" })
      );
    });

    it("emits message_dropped when queue overflows", () => {
      const handler = vi.fn();
      bus.on("message_dropped", handler);

      for (let i = 0; i < 5; i++) {
        sendMsg(bus);
      }
      sendMsg(bus); // overflow

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("emits message_nack", () => {
      const handler = vi.fn();
      bus.on("message_nack", handler);

      sendMsg(bus);
      const msg = bus.receive("agent-b")!;
      bus.nack("agent-b", msg.id);

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("stats", () => {
    it("returns correct aggregate stats", () => {
      sendMsg(bus, { to: "agent-1" });
      sendMsg(bus, { to: "agent-1" });
      sendMsg(bus, { to: "agent-2" });

      const stats = bus.stats;
      expect(stats.totalQueues).toBe(2);
      expect(stats.totalMessages).toBe(3);
      expect(stats.totalProcessing).toBe(0);
      expect(stats.deadLetters).toBe(0);
    });
  });
});
