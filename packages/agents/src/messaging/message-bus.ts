import { EventEmitter } from "node:events";
import type { AgentMessage, MessageAck, Priority } from "@agentforge/shared";
import { nanoid } from "nanoid";
import pino from "pino";

/**
 * MessageBus — In-memory inter-agent communication.
 *
 * Provides agent-to-agent messaging with priority queuing,
 * acknowledgments, and dead letter handling.
 *
 * Production note: Replace with Redis LPUSH/BRPOP for
 * distributed deployments.
 */
export class MessageBus extends EventEmitter {
  private queues = new Map<string, AgentMessage[]>();
  private processing = new Map<string, AgentMessage[]>();
  private deadLetters: AgentMessage[] = [];
  private logger = pino({ name: "message-bus" });
  private readonly maxQueueSize: number;
  private readonly maxDeadLetters: number;

  constructor(options?: { maxQueueSize?: number; maxDeadLetters?: number }) {
    super();
    this.maxQueueSize = options?.maxQueueSize ?? 1000;
    this.maxDeadLetters = options?.maxDeadLetters ?? 500;
  }

  /** Send a message to an agent */
  send(message: Omit<AgentMessage, "id" | "timestamp">): AgentMessage {
    const msg: AgentMessage = {
      ...message,
      id: nanoid(12),
      timestamp: new Date(),
    };

    const queue = this.getOrCreateQueue(msg.to);

    if (queue.length >= this.maxQueueSize) {
      this.logger.warn({ to: msg.to, queueSize: queue.length }, "Queue full, message dropped");
      this.deadLetters.push(msg);
      this.trimDeadLetters();
      this.emit("message_dropped", msg);
      return msg;
    }

    // Insert by priority (critical first)
    const priorityOrder: Record<Priority, number> = {
      critical: 0,
      high: 1,
      normal: 2,
      low: 3,
    };

    const insertIdx = queue.findIndex(
      (m) => priorityOrder[m.priority] > priorityOrder[msg.priority]
    );

    if (insertIdx === -1) {
      queue.push(msg);
    } else {
      queue.splice(insertIdx, 0, msg);
    }

    this.emit("message_sent", msg);
    this.logger.debug({ from: msg.from, to: msg.to, type: msg.type }, "Message sent");
    return msg;
  }

  /** Broadcast a message to all agents */
  broadcast(
    from: string,
    payload: Record<string, unknown>,
    priority: Priority = "normal"
  ): AgentMessage[] {
    const agents = Array.from(this.queues.keys());
    return agents
      .filter((id) => id !== from)
      .map((to) => this.send({ from, to, type: "broadcast", payload, priority }));
  }

  /** Pop the next message for an agent (moves to processing) */
  receive(agentId: string): AgentMessage | null {
    const queue = this.queues.get(agentId);
    if (!queue || queue.length === 0) return null;

    // Check for expired messages
    const now = new Date();
    const validIdx = queue.findIndex((m) => !m.expiresAt || m.expiresAt > now);

    if (validIdx === -1) {
      // All expired
      queue.length = 0;
      return null;
    }

    // Remove expired messages before the valid one
    if (validIdx > 0) {
      queue.splice(0, validIdx);
    }

    const msg = queue.shift()!;

    // Move to processing
    const proc = this.processing.get(agentId) ?? [];
    proc.push(msg);
    this.processing.set(agentId, proc);

    this.emit("message_received", msg);
    return msg;
  }

  /** Peek at the next message without consuming */
  peek(agentId: string): AgentMessage | null {
    const queue = this.queues.get(agentId);
    if (!queue || queue.length === 0) return null;
    return queue[0];
  }

  /** Acknowledge a processed message */
  ack(agentId: string, messageId: string, result?: Record<string, unknown>): MessageAck {
    const proc = this.processing.get(agentId) ?? [];
    const idx = proc.findIndex((m) => m.id === messageId);

    if (idx !== -1) {
      proc.splice(idx, 1);
    }

    const ackMsg: MessageAck = {
      messageId,
      agentId,
      status: "completed",
      result,
      timestamp: new Date(),
    };

    this.emit("message_ack", ackMsg);
    return ackMsg;
  }

  /** Reject a message (moves to dead letter) */
  nack(agentId: string, messageId: string): void {
    const proc = this.processing.get(agentId) ?? [];
    const idx = proc.findIndex((m) => m.id === messageId);

    if (idx !== -1) {
      const msg = proc.splice(idx, 1)[0];
      this.deadLetters.push(msg);
      this.trimDeadLetters();
      this.emit("message_nack", msg);
    }
  }

  /** Get queue depth for an agent */
  queueDepth(agentId: string): number {
    return this.queues.get(agentId)?.length ?? 0;
  }

  /** Get all queue depths */
  allQueueDepths(): Record<string, number> {
    const depths: Record<string, number> = {};
    for (const [id, queue] of this.queues) {
      depths[id] = queue.length;
    }
    return depths;
  }

  /** Get dead letter queue */
  getDeadLetters(): readonly AgentMessage[] {
    return this.deadLetters;
  }

  /** Clear an agent's queue */
  clearQueue(agentId: string): number {
    const queue = this.queues.get(agentId);
    if (!queue) return 0;
    const count = queue.length;
    queue.length = 0;
    return count;
  }

  /** Get bus stats */
  get stats() {
    let totalMessages = 0;
    let totalProcessing = 0;
    for (const queue of this.queues.values()) totalMessages += queue.length;
    for (const proc of this.processing.values()) totalProcessing += proc.length;

    return {
      totalQueues: this.queues.size,
      totalMessages,
      totalProcessing,
      deadLetters: this.deadLetters.length,
    };
  }

  private getOrCreateQueue(agentId: string): AgentMessage[] {
    let queue = this.queues.get(agentId);
    if (!queue) {
      queue = [];
      this.queues.set(agentId, queue);
    }
    return queue;
  }

  private trimDeadLetters(): void {
    if (this.deadLetters.length > this.maxDeadLetters) {
      this.deadLetters = this.deadLetters.slice(-this.maxDeadLetters);
    }
  }
}
