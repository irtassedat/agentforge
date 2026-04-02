"use client";

import { useEffect, useState, useCallback } from "react";
import { DEMO_AGENTS, DEMO_METRICS, DEMO_TASKS, DEMO_DLQ } from "../lib/mock-data";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3000/ws";
const IS_DEMO = process.env.NEXT_PUBLIC_DEMO === "true" || typeof window !== "undefined";

interface Agent {
  id: string;
  definitionId: string;
  status: "idle" | "running" | "paused" | "failed" | "terminated";
  startedAt: string | null;
  lastHeartbeat: string | null;
  tasksProcessed: number;
  tasksFailed: number;
  currentTask: string | null;
  memoryUsage: number;
  uptime: number;
  lastError: string | null;
}

interface Metrics {
  agents: { total: number; running: number; failed: number; idle: number };
  performance: { totalProcessed: number; totalFailed: number; avgUptime: number; totalMemoryMb: number };
  system: { nodeVersion: string; uptime: number; memoryMb: number };
}

interface Task {
  id: string;
  agentId: string;
  type: string;
  status: string;
  priority: string;
  attempts: number;
  createdAt: string;
}

function Dot({ status }: { status: string }) {
  const color = status === "running" ? "bg-ok pulse" : status === "idle" ? "bg-dim" : status === "paused" ? "bg-warn" : "bg-err";
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />;
}

function StatCard({ label, value, sub, color = "text-text" }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="p-3 rounded-lg bg-card border border-border">
      <p className="text-[10px] text-dim uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-bold mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-dim mt-0.5">{sub}</p>}
    </div>
  );
}

function formatUptime(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function Dashboard() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dlq, setDlq] = useState<Task[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const fetchAll = useCallback(async () => {
    try {
      const [agentsRes, metricsRes, tasksRes, dlqRes] = await Promise.allSettled([
        fetch(`${API_URL}/api/agents`).then((r) => r.json()),
        fetch(`${API_URL}/api/metrics`).then((r) => r.json()),
        fetch(`${API_URL}/api/tasks?limit=20`).then((r) => r.json()),
        fetch(`${API_URL}/api/tasks/dlq`).then((r) => r.json()),
      ]);
      if (agentsRes.status === "fulfilled") setAgents(agentsRes.value.data);
      if (metricsRes.status === "fulfilled") setMetrics(metricsRes.value.data);
      if (tasksRes.status === "fulfilled") setTasks(tasksRes.value.data);
      if (dlqRes.status === "fulfilled") setDlq(dlqRes.value.data);
    } catch {
      // Fallback to demo data when API is unavailable
      if (IS_DEMO && agents.length === 0) {
        setAgents(DEMO_AGENTS);
        setMetrics(DEMO_METRICS);
        setTasks(DEMO_TASKS);
        setDlq(DEMO_DLQ);
        setConnected(true);
      }
    } finally {
      setLoading(false);
    }
  }, [agents.length]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        reconnectTimer = setTimeout(connect, 3000);
      };
      ws.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          if (event.type === "agent_status") {
            setAgents((prev) => {
              const idx = prev.findIndex((a) => a.id === event.data.id);
              if (idx >= 0) return [...prev.slice(0, idx), event.data, ...prev.slice(idx + 1)];
              return [...prev, event.data];
            });
          }
          if (event.type === "task_update") {
            setTasks((prev) => [event.data, ...prev.slice(0, 19)]);
          }
        } catch { /* ignore */ }
      };
    }

    connect();
    return () => { ws?.close(); clearTimeout(reconnectTimer); };
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 10000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const sendCommand = async (agentId: string, action: string) => {
    setActionLoading((p) => ({ ...p, [agentId]: true }));
    try {
      await fetch(`${API_URL}/api/agents/${agentId}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await fetchAll();
    } finally {
      setActionLoading((p) => ({ ...p, [agentId]: false }));
    }
  };

  const running = agents.filter((a) => a.status === "running").length;
  const failed = agents.filter((a) => a.status === "failed").length;
  const successRate = metrics?.performance
    ? metrics.performance.totalProcessed + metrics.performance.totalFailed > 0
      ? Math.round((metrics.performance.totalProcessed / (metrics.performance.totalProcessed + metrics.performance.totalFailed)) * 100)
      : 100
    : 0;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
            <span className="text-accent font-bold text-sm">AF</span>
          </div>
          <div>
            <h1 className="text-lg font-bold">AgentForge</h1>
            <p className="text-[10px] text-dim">AI Agent Orchestration</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {IS_DEMO && agents.length > 0 && (
            <span className="px-2 py-0.5 text-[10px] rounded bg-accent/10 border border-accent/20 text-accent">DEMO</span>
          )}
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] border ${connected ? "border-ok/20 text-ok" : "border-err/20 text-err"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-ok pulse" : "bg-err"}`} />
            {connected ? "Live" : "Offline"}
          </div>
          <button onClick={fetchAll} disabled={loading} className="px-2.5 py-1 text-[11px] rounded bg-card border border-border hover:bg-card-hover disabled:opacity-50">
            {loading ? "..." : "Refresh"}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-6">
        <StatCard label="Agents" value={agents.length} sub={`${running} running`} />
        <StatCard label="Running" value={running} color="text-ok" />
        <StatCard label="Failed" value={failed} color={failed > 0 ? "text-err" : "text-dim"} />
        <StatCard label="Tasks" value={metrics?.performance.totalProcessed ?? 0} sub="processed" color="text-info" />
        <StatCard label="Success" value={`${successRate}%`} color={successRate >= 90 ? "text-ok" : "text-warn"} />
        <StatCard label="Memory" value={`${metrics?.performance.totalMemoryMb ?? 0}MB`} sub={`Heap: ${metrics?.system.memoryMb ?? 0}MB`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-2">
          <h2 className="text-xs font-semibold text-dim uppercase tracking-wider mb-2">Agents</h2>
          {agents.map((agent) => (
            <div key={agent.id} className="p-3 rounded-lg bg-card border border-border hover:bg-card-hover transition-all animate-in group">
              <div className="flex items-center gap-2 mb-2">
                <Dot status={agent.status} />
                <span className="font-medium text-sm flex-1">{agent.id}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  agent.status === "running" ? "bg-ok/10 text-ok" :
                  agent.status === "failed" ? "bg-err/10 text-err" :
                  agent.status === "paused" ? "bg-warn/10 text-warn" : "bg-dim/10 text-dim"
                }`}>{agent.status}</span>
              </div>
              <div className="grid grid-cols-4 gap-3 text-[11px] mb-2">
                <div><span className="text-dim">Processed</span><p className="text-ok font-medium">{agent.tasksProcessed}</p></div>
                <div><span className="text-dim">Failed</span><p className={agent.tasksFailed > 0 ? "text-err font-medium" : "text-dim"}>{agent.tasksFailed}</p></div>
                <div><span className="text-dim">Memory</span><p>{Math.round(agent.memoryUsage / 1024 / 1024)}MB</p></div>
                <div><span className="text-dim">Uptime</span><p>{agent.uptime > 0 ? formatUptime(agent.uptime) : "\u2014"}</p></div>
              </div>
              {agent.currentTask && <p className="text-[10px] text-info mb-2">Processing: {agent.currentTask}</p>}
              {agent.lastError && <p className="text-[10px] text-err mb-2 truncate">Error: {agent.lastError}</p>}
              <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {agent.status === "idle" && <button onClick={() => sendCommand(agent.id, "start")} disabled={actionLoading[agent.id]} className="px-2 py-0.5 text-[10px] rounded bg-ok/10 text-ok hover:bg-ok/20 disabled:opacity-50">Start</button>}
                {agent.status === "running" && (
                  <>
                    <button onClick={() => sendCommand(agent.id, "pause")} disabled={actionLoading[agent.id]} className="px-2 py-0.5 text-[10px] rounded bg-warn/10 text-warn hover:bg-warn/20 disabled:opacity-50">Pause</button>
                    <button onClick={() => sendCommand(agent.id, "stop")} disabled={actionLoading[agent.id]} className="px-2 py-0.5 text-[10px] rounded bg-err/10 text-err hover:bg-err/20 disabled:opacity-50">Stop</button>
                  </>
                )}
                {agent.status === "paused" && <button onClick={() => sendCommand(agent.id, "resume")} disabled={actionLoading[agent.id]} className="px-2 py-0.5 text-[10px] rounded bg-ok/10 text-ok hover:bg-ok/20 disabled:opacity-50">Resume</button>}
                {(agent.status === "failed" || agent.status === "terminated") && <button onClick={() => sendCommand(agent.id, "restart")} disabled={actionLoading[agent.id]} className="px-2 py-0.5 text-[10px] rounded bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-50">Restart</button>}
              </div>
            </div>
          ))}
          {agents.length === 0 && !loading && (
            <div className="p-8 text-center text-dim text-sm rounded-lg bg-card border border-border">No agents registered. Start the API server first.</div>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <h2 className="text-xs font-semibold text-dim uppercase tracking-wider mb-2">Recent Tasks</h2>
            <div className="rounded-lg bg-card border border-border divide-y divide-border/50 max-h-[300px] overflow-y-auto">
              {tasks.map((task) => (
                <div key={task.id} className="px-3 py-2 text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${task.status === "completed" ? "bg-ok" : task.status === "processing" ? "bg-info pulse" : task.status === "failed" || task.status === "dead_letter" ? "bg-err" : "bg-dim"}`} />
                    <span className="flex-1 truncate font-medium">{task.type}</span>
                    <span className="text-dim">{task.status}</span>
                  </div>
                  <div className="flex justify-between mt-0.5 text-[10px] text-dim">
                    <span>{task.agentId}</span>
                    <span>#{task.id.slice(0, 8)}</span>
                  </div>
                </div>
              ))}
              {tasks.length === 0 && <div className="px-3 py-6 text-center text-dim text-[11px]">No tasks yet</div>}
            </div>
          </div>

          <div>
            <h2 className="text-xs font-semibold text-err uppercase tracking-wider mb-2">Dead Letter Queue ({dlq.length})</h2>
            <div className="rounded-lg bg-card border border-border divide-y divide-border/50 max-h-[200px] overflow-y-auto">
              {dlq.map((task) => (
                <div key={task.id} className="px-3 py-2 text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-err" />
                    <span className="flex-1 truncate">{task.type}</span>
                    <span className="text-dim">x{task.attempts}</span>
                  </div>
                </div>
              ))}
              {dlq.length === 0 && <div className="px-3 py-4 text-center text-dim text-[11px]">Queue empty</div>}
            </div>
          </div>

          {metrics && (
            <div>
              <h2 className="text-xs font-semibold text-dim uppercase tracking-wider mb-2">System</h2>
              <div className="rounded-lg bg-card border border-border p-3 space-y-1.5 text-[11px]">
                <div className="flex justify-between"><span className="text-dim">Node.js</span><span>{metrics.system.nodeVersion}</span></div>
                <div className="flex justify-between"><span className="text-dim">Uptime</span><span>{formatUptime(metrics.system.uptime * 1000)}</span></div>
                <div className="flex justify-between"><span className="text-dim">Heap</span><span>{metrics.system.memoryMb}MB</span></div>
                <div className="flex justify-between"><span className="text-dim">API</span><span className={connected ? "text-ok" : "text-err"}>{connected ? "Connected" : "Disconnected"}</span></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
