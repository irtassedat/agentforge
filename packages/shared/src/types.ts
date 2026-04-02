// ========================================
// AgentForge — Core Type Definitions
// ========================================

/** Agent lifecycle states */
export type AgentStatus = "idle" | "running" | "paused" | "failed" | "terminated";

/** Task processing states */
export type TaskStatus = "pending" | "queued" | "processing" | "completed" | "failed" | "dead_letter";

/** Priority levels for task scheduling */
export type Priority = "critical" | "high" | "normal" | "low";

/** Agent definition — what gets registered */
export interface AgentDefinition {
  id: string;
  name: string;
  type: "worker" | "scheduler" | "watcher" | "notifier" | "analytics";
  description: string;
  config: AgentConfig;
  createdAt: Date;
  updatedAt: Date;
}

/** Runtime configuration for an agent */
export interface AgentConfig {
  /** Max concurrent tasks */
  concurrency: number;
  /** Task timeout in ms */
  taskTimeout: number;
  /** Max retries before DLQ */
  maxRetries: number;
  /** Retry backoff strategy */
  retryStrategy: "fixed" | "exponential" | "linear";
  /** Base delay for retries in ms */
  retryDelay: number;
  /** Heartbeat interval in ms */
  heartbeatInterval: number;
  /** Custom metadata */
  meta?: Record<string, unknown>;
}

/** Live agent instance — runtime state */
export interface AgentInstance {
  id: string;
  definitionId: string;
  status: AgentStatus;
  pid?: number;
  startedAt: Date | null;
  lastHeartbeat: Date | null;
  tasksProcessed: number;
  tasksFailed: number;
  currentTask: string | null;
  memoryUsage: number;
  uptime: number;
  errorCount: number;
  lastError: string | null;
}

/** Task — unit of work */
export interface Task {
  id: string;
  agentId: string;
  type: string;
  priority: Priority;
  status: TaskStatus;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  attempts: number;
  maxAttempts: number;
  scheduledAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

/** Dead Letter Queue entry */
export interface DeadLetter {
  id: string;
  taskId: string;
  agentId: string;
  error: string;
  attempts: number;
  payload: Record<string, unknown>;
  failedAt: Date;
  retriedAt: Date | null;
  resolved: boolean;
}

/** Workflow — sequence of agent tasks */
export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  status: "draft" | "active" | "paused" | "completed" | "failed";
  currentStep: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowStep {
  agentId: string;
  taskType: string;
  payload: Record<string, unknown>;
  /** Condition to proceed — references previous step results */
  condition?: string;
  /** Timeout for this step */
  timeout: number;
}

/** Agent heartbeat event */
export interface Heartbeat {
  agentId: string;
  instanceId: string;
  timestamp: Date;
  status: AgentStatus;
  metrics: {
    memoryMb: number;
    cpuPercent: number;
    tasksInQueue: number;
    activeTask: string | null;
  };
}

/** System-wide metrics snapshot */
export interface SystemMetrics {
  timestamp: Date;
  agents: {
    total: number;
    running: number;
    failed: number;
    idle: number;
  };
  tasks: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    deadLettered: number;
  };
  queues: {
    name: string;
    size: number;
    processingRate: number;
  }[];
  memory: {
    totalMb: number;
    usedMb: number;
  };
}

/** WebSocket event types */
export type WSEvent =
  | { type: "heartbeat"; data: Heartbeat }
  | { type: "task_update"; data: Task }
  | { type: "agent_status"; data: AgentInstance }
  | { type: "metrics"; data: SystemMetrics }
  | { type: "dlq_entry"; data: DeadLetter }
  | { type: "workflow_update"; data: Workflow }
  | { type: "log"; data: LogEntry };

/** Structured log entry */
export interface LogEntry {
  id: string;
  timestamp: Date;
  level: "debug" | "info" | "warn" | "error" | "fatal";
  agentId: string | null;
  taskId: string | null;
  message: string;
  meta?: Record<string, unknown>;
}

/** API response wrapper */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
  meta?: {
    page?: number;
    total?: number;
    took?: number;
  };
}

/** Agent command — sent via API or bot */
export type AgentCommand =
  | { action: "start"; agentId: string }
  | { action: "stop"; agentId: string }
  | { action: "pause"; agentId: string }
  | { action: "resume"; agentId: string }
  | { action: "restart"; agentId: string }
  | { action: "scale"; agentId: string; instances: number };
