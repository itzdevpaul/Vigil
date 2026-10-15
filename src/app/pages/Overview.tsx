import { Link } from "react-router";
import { useState, useEffect } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  TrendingUp, Activity, AlertTriangle, CheckCircle2, Bell, Database, Sparkles,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { onSnapshot } from "firebase/firestore";
import { useScanContext } from "../contexts/ScanContext";
import { useAuth } from "../components/AuthProvider";
import { getRiskHistoryQuery, type RiskSnapshot } from "../../firebase";

function statusColor(status: string) {
  switch (status) {
    case "running":   return "text-cyan-400 bg-cyan-500/20";
    case "completed": return "text-green-400 bg-green-500/20";
    case "failed":    return "text-red-400 bg-red-500/20";
    case "paused":    return "text-yellow-400 bg-yellow-500/20";
    default:          return "text-gray-400 bg-white/10";
  }
}

export function Overview() {
  const { user } = useAuth();
  const { scans, findings, findingsList, completedCount, activeCount, queuedCount, hasScans, isRunning, assets, firestoreOk } = useScanContext();
  const [riskHistory, setRiskHistory] = useState<RiskSnapshot[]>([]);

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = onSnapshot(getRiskHistoryQuery(user.uid), (snap) => {
      setRiskHistory(snap.docs.map(d => d.data() as RiskSnapshot));
    }, () => {});
    return unsub;
  }, [user?.uid]);

  // Build 30-day risk chart data
  const riskChartData = (() => {
    const days: { label: string; date: string; score: number | null }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      const snap = riskHistory.find(r => r.date === dateStr);
      days.push({ label, date: dateStr, score: snap ? snap.score : null });
    }
    // Forward-fill nulls so the line is continuous
    let lastScore = 0;
    return days.map(d => {
      if (d.score !== null) lastScore = d.score;
      return { label: d.label, score: lastScore };
    });
  })();

  const latestScore = riskChartData[riskChartData.length - 1]?.score ?? 0;
  const prevScore   = riskChartData[riskChartData.length - 8]?.score ?? 0;
  const scoreDelta  = latestScore - prevScore;

  const metricCards = [
    { label: "Total Findings",  icon: Activity,     highlight: false, value: firestoreOk ? (hasScans ? findings.toString() : "--") : "Unavailable" },
    { label: "Completed Scans", icon: CheckCircle2,  highlight: true,  value: firestoreOk ? (hasScans ? completedCount.toString() : "--") : "Unavailable" },
    { label: "Active Scans",    icon: TrendingUp,    highlight: false, value: firestoreOk ? (hasScans ? activeCount.toString() : "--") : "Unavailable" },
    { label: "Queued Scans",    icon: AlertTriangle, highlight: false, value: firestoreOk ? (hasScans ? queuedCount.toString() : "--") : "Unavailable" },
  ];

  const recentActivity = [...scans]
    .sort((a, b) => {
      const aTime = a.createdAt?.toDate?.()?.getTime() ?? 0;
      const bTime = b.createdAt?.toDate?.()?.getTime() ?? 0;
      return bTime - aTime;
    })
    .slice(0, 4);

  const assetCount = assets.length;
  const activityStatus = isRunning ? "Active" : "Idle";

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <h1 className="sr-only">Vigil Dashboard — Overview</h1>
      {!firestoreOk && (
        <div role="status" className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
          Scan data is unavailable. No sample scan results are being shown.
        </div>
      )}

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
        {metricCards.map((metric, idx) => (
          <div
            key={idx}
            className={`relative overflow-hidden rounded-xl backdrop-blur-xl border p-4 md:p-6 ${
              metric.highlight
                ? "bg-gradient-to-br from-red-500/10 to-orange-500/10 border-red-500/30"
                : "bg-white/5 border-white/10"
            }`}
          >
            <div className="flex items-start justify-between mb-4">
              <div
                className={`w-10 h-10 md:w-12 md:h-12 rounded-lg flex items-center justify-center ${
                  metric.highlight
                    ? "bg-red-500/20 text-red-400"
                    : "bg-cyan-500/20 text-cyan-400"
                }`}
              >
                <metric.icon className="w-5 h-5 md:w-6 md:h-6" />
              </div>
            </div>
            <div className="text-2xl md:text-3xl font-bold mb-1 text-gray-500">{metric.value}</div>
            <div className="text-xs md:text-sm text-gray-400">{metric.label}</div>
          </div>
        ))}
      </div>

      {/* 30-Day Risk Score Trend */}
      <div className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h3 className="text-lg font-semibold">Saved Risk History</h3>
            <p className="text-xs text-gray-400 mt-0.5">Stored account history; not a validated risk assessment</p>
          </div>
          {riskHistory.length > 0 && (
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-2xl font-bold text-gray-100">{latestScore}</div>
                <div className={`text-xs font-medium ${scoreDelta > 0 ? "text-red-400" : scoreDelta < 0 ? "text-green-400" : "text-gray-400"}`}>
                  {scoreDelta > 0 ? `▲ +${scoreDelta}` : scoreDelta < 0 ? `▼ ${scoreDelta}` : "— unchanged"} vs 7d ago
                </div>
              </div>
              <div className={`w-3 h-3 rounded-full ${latestScore >= 70 ? "bg-red-400" : latestScore >= 40 ? "bg-yellow-400" : "bg-green-400"}`} />
            </div>
          )}
        </div>

        {riskHistory.length === 0 ? (
          <div className="h-44 flex flex-col items-center justify-center gap-2">
            <TrendingUp className="w-9 h-9 text-gray-600" />
            <p className="text-gray-500 text-sm">No saved risk-history records are available</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={riskChartData} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
              <defs>
                <linearGradient id="riskGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#06b6d4" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="label"
                tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval={6}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{ background: "#0d0d18", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                itemStyle={{ color: "#22d3ee" }}
                labelStyle={{ color: "rgba(255,255,255,0.6)", fontSize: 11 }}
                formatter={(v: number) => [`${v}`, "Risk Score"]}
              />
              <Area
                type="monotone"
                dataKey="score"
                stroke="#06b6d4"
                strokeWidth={2}
                fill="url(#riskGrad)"
                dot={false}
                activeDot={{ r: 4, fill: "#06b6d4", stroke: "#0a0a0f", strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Bottom grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {/* Risk Trends bar chart */}
        <div className="lg:col-span-2 rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-4 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Findings (Last 7 Days)</h3>
            <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
              activityStatus === "Active" ? "bg-green-500/20 text-green-400" : "bg-white/5 text-gray-400"
            }`}>{activityStatus}</span>
          </div>
          <SimpleBarChart data={buildLast7Days(findingsList)} />
        </div>

        {/* Live Activity */}
        <div className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-4 md:p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Bell className="w-4 h-4 text-cyan-400" />
            Live Activity
          </h3>
          {recentActivity.length === 0 ? (
            <div className="h-[200px] flex flex-col items-center justify-center gap-3">
              <Activity className="w-10 h-10 text-gray-600" />
              <p className="text-gray-500 text-sm text-center">{firestoreOk ? "No scan activity recorded yet" : "Scan activity unavailable"}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentActivity.map((scan) => (
                <div key={scan.id} className="flex items-start gap-3">
                  <div className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${
                    scan.status === "running" ? "bg-cyan-400 animate-pulse" :
                    scan.status === "completed" ? "bg-green-400" : "bg-gray-500"
                  }`} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{scan.name}</div>
                    <div className="text-xs text-gray-500 truncate">{scan.target}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${statusColor(scan.status)}`}>{scan.status}</span>
                      <span className="text-xs text-gray-600">
                        {scan.createdAt?.toDate ? formatDistanceToNow(scan.createdAt.toDate(), { addSuffix: true }) : ""}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Finding Summary + Asset Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        {/* Finding Summary */}
        <div className="rounded-xl bg-gradient-to-br from-purple-500/5 to-blue-500/5 border border-purple-500/20 p-4 md:p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-400" />
            Finding Summary
          </h3>
          {!hasScans ? (
            <>
              <p className="text-gray-400 mb-4 text-sm md:text-base">
                {isRunning ? "A scan is in progress. Findings will appear here only after the worker records results." : "This summary uses recorded scan findings; it is not an AI assessment, prediction, or security certification."}
              </p>
              <div className="flex flex-wrap gap-3">
                <Link to="/monitoring" className="px-4 py-2 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 text-sm font-medium transition-all border border-purple-500/30">
                  {isRunning ? "View Scan Progress" : "Start First Scan"}
                </Link>
              </div>
            </>
          ) : (
            <FindingSummary findingsList={findingsList} assets={assets} />
          )}
        </div>

        {/* Asset Distribution */}
        <div className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-4 md:p-6">
          <h3 className="text-lg font-semibold mb-4">Asset Distribution</h3>
          {assetCount > 0 ? (
            <div className="space-y-4">
              <div className="text-4xl font-bold text-gray-100">{assetCount}</div>
              <div className="text-sm text-gray-400">Assets recorded in available scan results.</div>
              <Link
                to="/assets"
                className="mt-2 inline-flex text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                View discovered assets →
              </Link>
            </div>
          ) : (
            <div className="h-[200px] flex flex-col items-center justify-center">
              <Database className="w-10 h-10 text-gray-600 mb-3" />
              <p className="text-gray-500 text-sm text-center">{firestoreOk ? "No assets discovered yet" : "Asset results unavailable"}</p>
              <Link
                to="/assets"
                className="mt-4 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                Add your first asset →
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function FindingSummary({ findingsList, assets }: { findingsList: any[]; assets: any[] }) {
  const critCount  = findingsList.filter(f => f.severity === "critical").length;
  const highCount  = findingsList.filter(f => f.severity === "high").length;
  const cveCount   = findingsList.filter(f => f.cve).length;
  if (critCount > 0 || highCount > 0) {
    return (
      <p className="text-gray-300 leading-relaxed text-sm">
        Scan results include <span className="text-red-400 font-semibold">{critCount} critical</span> and{" "}
        <span className="text-orange-400 font-semibold">{highCount} high-severity</span> findings.{" "}
        {cveCount > 0 && `${cveCount} finding${cveCount > 1 ? "s include" : " includes"} a CVE identifier. `}
        Review finding details against your environment before taking action.
      </p>
    );
  }
  return (
    <p className="text-gray-300 leading-relaxed text-sm">
      No critical or high-severity findings are recorded in the available results. This is not a guarantee that the target is free of security issues.{" "}
      {assets.length > 0 && `${assets.length} assets were recorded by scan results.`}
    </p>
  );
}

function buildLast7Days(findingsList: any[]) {
  const days: { label: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    days.push({ label, count: 0 });
  }

  findingsList.forEach((f) => {
    let ts = (f.createdAt && f.createdAt.toDate) ? f.createdAt.toDate() : f.createdAt ? new Date(f.createdAt) : null;
    if (!ts) return;
    const idx = days.findIndex((_day, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return ts.getDate() === d.getDate() && ts.getMonth() === d.getMonth();
    });
    if (idx >= 0) days[idx].count += 1;
  });
  return days;
}

function SimpleBarChart({ data }: { data: { label: string; count: number }[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  const w = 100;
  return (
    <div className="w-full h-36 px-3 relative">
      <svg viewBox={`0 0 ${w} 100`} preserveAspectRatio="none" className="w-full h-full">
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
          <line key={i} x1={0} x2={w} y1={10 + (1 - t) * 80} y2={10 + (1 - t) * 80} stroke="rgba(255,255,255,0.04)" strokeWidth={0.5} />
        ))}
        {data.map((d, i) => {
          const x = i * (w / data.length);
          const h = (d.count / max) * 80;
          return (
            <g key={i}>
              <rect x={x + 2} y={90 - h} width={(w / data.length) - 4} height={h} rx="3" fill="url(#barGradient)" />
              <title>{`${d.label}: ${d.count}`}</title>
              <text x={x + (w / data.length) / 2} y={96} fontSize="5" fill="rgba(255,255,255,0.7)" textAnchor="middle">{d.label}</text>
            </g>
          );
        })}
        <defs>
          <linearGradient id="barGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.8" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}
