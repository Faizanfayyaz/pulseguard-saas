'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  Globe,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  X,
  XCircle,
  Zap,
} from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface Monitor {
  id: string;
  tenant_id: string;
  name: string;
  url: string;
  method: string;
  interval_seconds: number;
  timeout_ms: number;
  expected_status_code: number;
  status: 'active' | 'paused' | 'pending';
  current_state: 'up' | 'down' | 'degraded';
  consecutive_failures: number;
  last_checked_at: string | null;
  created_at: string;
  total_pings_24h: number;
  successful_pings_24h: number;
  uptime_percentage_24h: number;
  avg_response_time_ms: number;
}

interface Incident {
  id: string;
  monitor_id: string;
  monitor_name: string;
  monitor_url: string;
  status: string;
  title: string;
  cause: string | null;
  started_at: string;
}

interface MetricsData {
  summary: {
    total_pings: number;
    successful_pings: number;
    failed_pings: number;
    uptime_percentage: number;
    avg_response_time_ms: number;
    min_response_time_ms: number;
    max_response_time_ms: number;
    p95_latency_ms: number;
    p99_latency_ms: number;
  };
  timeline: Array<{
    time_bucket: string;
    pings: number;
    success_count: number;
    avg_latency: number;
  }>;
}

interface PingLog {
  id: number;
  status_code: number | null;
  response_time_ms: number;
  is_success: number;
  error_message: string | null;
  created_at: string;
}

export default function DashboardPage() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [selectedMonitor, setSelectedMonitor] = useState<Monitor | null>(null);
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [logs, setLogs] = useState<PingLog[]>([]);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);

  // New Monitor Form State
  const [formData, setFormData] = useState({
    name: '',
    url: 'https://',
    method: 'GET',
    interval_seconds: 60,
    timeout_ms: 10000,
    expected_status_code: 200,
  });

  const fetchData = useCallback(async () => {
    try {
      const [monitorsRes, incidentsRes] = await Promise.all([
        fetch(`${API_BASE}/api/monitors`),
        fetch(`${API_BASE}/api/incidents`),
      ]);

      if (monitorsRes.ok) {
        const data = await monitorsRes.json();
        setMonitors(data);
      }
      if (incidentsRes.ok) {
        const incData = await incidentsRes.json();
        setIncidents(incData.filter((i: Incident) => i.status !== 'resolved'));
      }
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 8000);
    return () => clearInterval(timer);
  }, [fetchData]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchData();
  };

  const handleOpenMetrics = async (monitor: Monitor) => {
    setSelectedMonitor(monitor);
    setIsModalOpen(true);
    try {
      const [mRes, lRes] = await Promise.all([
        fetch(`${API_BASE}/api/monitors/${monitor.id}/metrics?hours=24`),
        fetch(`${API_BASE}/api/monitors/${monitor.id}/logs?limit=30`),
      ]);
      if (mRes.ok) setMetrics(await mRes.json());
      if (lRes.ok) setLogs(await lRes.json());
    } catch (e) {
      console.error('Metrics fetch error:', e);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this monitor?')) return;
    try {
      await fetch(`${API_BASE}/api/monitors/${id}`, { method: 'DELETE' });
      fetchData();
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  const handleCreateMonitor = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/api/monitors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        setIsCreateModalOpen(false);
        setFormData({
          name: '',
          url: 'https://',
          method: 'GET',
          interval_seconds: 60,
          timeout_ms: 10000,
          expected_status_code: 200,
        });
        fetchData();
      }
    } catch (err) {
      console.error('Create error:', err);
    }
  };

  // Computations
  const totalMonitors = monitors.length;
  const activeMonitors = monitors.filter((m) => m.status === 'active').length;
  const avgUptime =
    totalMonitors > 0
      ? (
          monitors.reduce((acc, m) => acc + Number(m.uptime_percentage_24h || 100), 0) /
          totalMonitors
        ).toFixed(2)
      : '100.0';
  const avgLatency =
    totalMonitors > 0
      ? Math.round(
          monitors.reduce((acc, m) => acc + Number(m.avg_response_time_ms || 0), 0) /
            totalMonitors
        )
      : 0;

  return (
    <div className="min-h-screen text-slate-100 flex flex-col">
      {/* Top Navigation */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/30">
              <Activity className="h-5 w-5 text-white animate-pulse" />
            </div>
            <div>
              <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-indigo-300 bg-clip-text text-transparent">
                PulseGuard
              </span>
              <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-indigo-950/80 text-indigo-400 border border-indigo-800/50">
                SaaS Real-Time
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleRefresh}
              className="p-2 rounded-lg border border-slate-800 bg-slate-800/50 hover:bg-slate-700/60 text-slate-300 transition"
              title="Refresh Telemetry"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin text-indigo-400' : ''}`} />
            </button>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-medium text-sm text-white shadow-lg shadow-indigo-600/25 transition"
            >
              <Plus className="h-4 w-4" />
              <span>New Monitor</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full space-y-6">
        {/* Active Incident Notification Banner */}
        {incidents.length > 0 && (
          <div className="rounded-xl border border-red-500/40 bg-red-950/20 backdrop-blur-sm p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 text-sm">
              <h3 className="font-semibold text-red-200">
                {incidents.length} Active Incident{incidents.length > 1 ? 's' : ''} Detected
              </h3>
              <p className="text-red-300/80 mt-0.5">
                {incidents[0].title} — <span className="text-red-400 font-mono text-xs">{incidents[0].cause}</span>
              </p>
            </div>
            <span className="px-2.5 py-1 text-xs rounded-md bg-red-900/60 text-red-300 border border-red-700/50 uppercase font-bold tracking-wider">
              {incidents[0].status}
            </span>
          </div>
        )}

        {/* Overview Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 backdrop-blur-sm">
            <div className="flex items-center justify-between text-slate-400 text-sm">
              <span>Monitors Configured</span>
              <Server className="h-4 w-4 text-indigo-400" />
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-white">{totalMonitors}</span>
              <span className="text-xs text-emerald-400 font-medium">({activeMonitors} active)</span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 backdrop-blur-sm">
            <div className="flex items-center justify-between text-slate-400 text-sm">
              <span>24h Global Uptime</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-emerald-400">{avgUptime}%</span>
              <span className="text-xs text-slate-400">across endpoints</span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 backdrop-blur-sm">
            <div className="flex items-center justify-between text-slate-400 text-sm">
              <span>Avg Latency (24h)</span>
              <Zap className="h-4 w-4 text-amber-400" />
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-white">{avgLatency}</span>
              <span className="text-xs text-slate-400">ms</span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 backdrop-blur-sm">
            <div className="flex items-center justify-between text-slate-400 text-sm">
              <span>Outages / Incidents</span>
              <AlertTriangle className={`h-4 w-4 ${incidents.length > 0 ? 'text-red-400' : 'text-slate-500'}`} />
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className={`text-3xl font-extrabold ${incidents.length > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {incidents.length}
              </span>
              <span className="text-xs text-slate-400">active events</span>
            </div>
          </div>
        </div>

        {/* Monitors Section */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/30 overflow-hidden backdrop-blur-sm">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
            <h2 className="font-semibold text-base text-slate-200">Synthetics Endpoints</h2>
            <span className="text-xs text-slate-400">Auto-refreshing every 8s</span>
          </div>

          {isLoading ? (
            <div className="py-16 text-center text-slate-500 flex flex-col items-center justify-center">
              <RefreshCw className="h-8 w-8 animate-spin text-indigo-500 mb-2" />
              <span>Loading telemetry services...</span>
            </div>
          ) : monitors.length === 0 ? (
            <div className="py-16 text-center text-slate-400">
              <Globe className="h-10 w-10 text-slate-600 mx-auto mb-3" />
              <p className="text-base font-medium">No monitors found</p>
              <p className="text-sm text-slate-500 mt-1">Get started by creating your first synthetic monitor.</p>
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-sm rounded-lg text-white font-medium"
              >
                Create Monitor
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/70">
              {monitors.map((monitor) => {
                const isUp = monitor.current_state === 'up';
                const isDown = monitor.current_state === 'down';
                const isDegraded = monitor.current_state === 'degraded';

                return (
                  <div
                    key={monitor.id}
                    onClick={() => handleOpenMetrics(monitor)}
                    className="p-5 hover:bg-slate-800/30 cursor-pointer transition flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    {/* Left: Identity & URL */}
                    <div className="flex items-start gap-3.5 min-w-0">
                      <div className="mt-1">
                        {isUp && <CheckCircle2 className="h-5 w-5 text-emerald-400" />}
                        {isDown && <XCircle className="h-5 w-5 text-red-500 animate-pulse" />}
                        {isDegraded && <AlertTriangle className="h-5 w-5 text-amber-400" />}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-100 truncate text-base">
                            {monitor.name}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[11px] font-mono font-bold bg-slate-800 text-indigo-300 border border-slate-700">
                            {monitor.method}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                          <span className="truncate max-w-xs sm:max-w-md font-mono">{monitor.url}</span>
                          <a
                            href={monitor.url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-slate-500 hover:text-slate-300"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      </div>
                    </div>

                    {/* Right: Metrics & Actions */}
                    <div className="flex items-center gap-6 self-end md:self-auto shrink-0">
                      {/* Interval & Last checked */}
                      <div className="text-right text-xs text-slate-400 hidden sm:block">
                        <div className="flex items-center gap-1 justify-end">
                          <Clock className="h-3 w-3 text-slate-500" />
                          <span>{monitor.interval_seconds}s</span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {monitor.last_checked_at
                            ? new Date(monitor.last_checked_at).toLocaleTimeString()
                            : 'Pending'}
                        </div>
                      </div>

                      {/* Uptime % Bar */}
                      <div className="w-28 text-right">
                        <div className="text-xs font-semibold text-slate-200">
                          {monitor.uptime_percentage_24h}%
                        </div>
                        <div className="w-full bg-slate-800 h-1.5 rounded-full mt-1 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              Number(monitor.uptime_percentage_24h) >= 99
                                ? 'bg-emerald-400'
                                : Number(monitor.uptime_percentage_24h) >= 95
                                ? 'bg-amber-400'
                                : 'bg-red-500'
                            }`}
                            style={{ width: `${Math.max(5, monitor.uptime_percentage_24h)}%` }}
                          />
                        </div>
                      </div>

                      {/* Avg Response Time */}
                      <div className="w-16 text-right">
                        <span className="text-xs font-mono font-medium text-slate-300">
                          {monitor.avg_response_time_ms} ms
                        </span>
                      </div>

                      {/* Quick Delete Action */}
                      <button
                        onClick={(e) => handleDelete(monitor.id, e)}
                        className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-red-950/30 transition"
                        title="Delete Monitor"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Modal: Deep Telemetry Metrics & Ping Logs */}
      {isModalOpen && selectedMonitor && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl p-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-bold text-white">{selectedMonitor.name}</h3>
                  <span className="px-2 py-0.5 text-xs rounded bg-slate-800 font-mono text-indigo-300">
                    {selectedMonitor.method}
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-mono mt-1">{selectedMonitor.url}</p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Metrics Breakdown */}
            {metrics && (
              <div className="mt-6 space-y-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
                    <span className="text-xs text-slate-400">24h Uptime</span>
                    <p className="text-2xl font-bold text-emerald-400 mt-1">
                      {metrics.summary.uptime_percentage}%
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
                    <span className="text-xs text-slate-400">P95 Latency</span>
                    <p className="text-2xl font-bold text-amber-400 mt-1">
                      {metrics.summary.p95_latency_ms} <span className="text-sm font-normal">ms</span>
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
                    <span className="text-xs text-slate-400">P99 Latency</span>
                    <p className="text-2xl font-bold text-orange-400 mt-1">
                      {metrics.summary.p99_latency_ms} <span className="text-sm font-normal">ms</span>
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
                    <span className="text-xs text-slate-400">Avg / Max Latency</span>
                    <p className="text-xl font-bold text-slate-200 mt-1">
                      {metrics.summary.avg_response_time_ms} / {metrics.summary.max_response_time_ms}{' '}
                      <span className="text-xs font-normal">ms</span>
                    </p>
                  </div>
                </div>

                {/* Hourly Timeline */}
                <div>
                  <h4 className="text-sm font-semibold text-slate-300 mb-2">24h Telemetry Timeline</h4>
                  <div className="h-24 bg-slate-950/60 rounded-xl border border-slate-800 p-3 flex items-end gap-1.5 overflow-x-auto">
                    {metrics.timeline.length === 0 ? (
                      <span className="text-xs text-slate-500 m-auto">No timeline buckets yet</span>
                    ) : (
                      metrics.timeline.map((bucket, idx) => {
                        const height = Math.min(100, Math.max(15, (bucket.avg_latency / 1000) * 80));
                        return (
                          <div
                            key={idx}
                            className="flex-1 min-w-[12px] flex flex-col items-center gap-1 group relative"
                          >
                            <div
                              className="w-full bg-indigo-500 hover:bg-indigo-400 rounded-t transition"
                              style={{ height: `${height}%` }}
                            />
                            {/* Hover tooltip */}
                            <div className="hidden group-hover:block absolute bottom-8 z-20 bg-slate-800 text-white text-[10px] p-1.5 rounded shadow pointer-events-none whitespace-nowrap">
                              {bucket.time_bucket.split(' ')[1]}: {bucket.avg_latency}ms ({bucket.pings} pings)
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Recent Logs Table */}
                <div>
                  <h4 className="text-sm font-semibold text-slate-300 mb-2">Recent Synthetic Telemetry</h4>
                  <div className="border border-slate-800 rounded-xl overflow-hidden max-h-56 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 sticky top-0">
                        <tr>
                          <th className="py-2 px-3">Status</th>
                          <th className="py-2 px-3">Latency</th>
                          <th className="py-2 px-3">Timestamp</th>
                          <th className="py-2 px-3">Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50">
                        {logs.map((log) => (
                          <tr key={log.id} className="hover:bg-slate-800/30">
                            <td className="py-2 px-3">
                              <span
                                className={`font-mono font-bold px-1.5 py-0.5 rounded ${
                                  log.is_success
                                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/40'
                                    : 'bg-red-950 text-red-400 border border-red-800/40'
                                }`}
                              >
                                {log.status_code || 'ERR'}
                              </span>
                            </td>
                            <td className="py-2 px-3 font-mono">{log.response_time_ms} ms</td>
                            <td className="py-2 px-3 text-slate-400 font-mono">
                              {new Date(log.created_at).toLocaleTimeString()}
                            </td>
                            <td className="py-2 px-3 text-slate-400 truncate max-w-xs">
                              {log.error_message || 'OK'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Create Monitor */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl p-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Add Synthetic Monitor</h3>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateMonitor} className="mt-4 space-y-4 text-sm">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Friendly Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Production API Gateway"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Target Endpoint URL</label>
                <input
                  type="url"
                  required
                  placeholder="https://api.example.com/health"
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 font-mono text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Method</label>
                  <select
                    value={formData.method}
                    onChange={(e) => setFormData({ ...formData, method: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="HEAD">HEAD</option>
                    <option value="PUT">PUT</option>
                    <option value="PATCH">PATCH</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Interval (Sec)</label>
                  <select
                    value={formData.interval_seconds}
                    onChange={(e) =>
                      setFormData({ ...formData, interval_seconds: parseInt(e.target.value, 10) })
                    }
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="30">30 seconds</option>
                    <option value="60">1 minute</option>
                    <option value="120">2 minutes</option>
                    <option value="300">5 minutes</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Timeout (ms)</label>
                  <input
                    type="number"
                    value={formData.timeout_ms}
                    onChange={(e) =>
                      setFormData({ ...formData, timeout_ms: parseInt(e.target.value, 10) })
                    }
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Expected Code</label>
                  <input
                    type="number"
                    value={formData.expected_status_code}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        expected_status_code: parseInt(e.target.value, 10),
                      })
                    }
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-800 hover:bg-slate-800 text-slate-300 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm shadow-md shadow-indigo-600/30"
                >
                  Create Endpoint
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

