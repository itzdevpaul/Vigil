import { useState, useMemo } from "react";
import { ZoomIn, ZoomOut, Maximize, Filter, X, Info, Shield, ExternalLink } from "lucide-react";
import { useScanContext } from "../contexts/ScanContext";
import { useNavigate } from "react-router";

function riskColor(score: number) {
  if (score >= 75) return { stroke: "#ef4444", fill: "#7f1d1d", text: "#fca5a5", label: "Critical" };
  if (score >= 50) return { stroke: "#f97316", fill: "#7c2d12", text: "#fdba74", label: "High" };
  if (score >= 30) return { stroke: "#eab308", fill: "#713f12", text: "#fde047", label: "Medium" };
  return { stroke: "#22c55e", fill: "#14532d", text: "#86efac", label: "Low" };
}

function buildGraph(assets: any[]) {
  if (assets.length === 0) return { nodes: [], edges: [] };

  // Layout: center hub + surrounding ring(s)
  const W = 800, H = 500;
  const cx = W / 2, cy = H / 2;

  const nodes = assets.map((asset, i) => {
    const total = assets.length;
    let x: number, y: number;
    if (i === 0) {
      x = cx; y = cy;
    } else {
      const ring = Math.floor((i - 1) / 6);
      const inRing = (i - 1) % 6;
      const ringCount = Math.min(6, total - 1 - ring * 6);
      const radius = 140 + ring * 120;
      const angle = (inRing / ringCount) * 2 * Math.PI - Math.PI / 2;
      x = cx + radius * Math.cos(angle);
      y = cy + radius * Math.sin(angle);
    }
    return { ...asset, x, y };
  });

  // Edges: connect each node to hub (index 0) + nodes of same scanId
  const edges: { from: number; to: number; critical: boolean }[] = [];
  for (let i = 1; i < nodes.length; i++) {
    edges.push({ from: 0, to: i, critical: nodes[i].riskScore >= 75 });
  }
  // Cross-edges for same scanId assets
  for (let i = 1; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i].scanId === nodes[j].scanId && nodes[i].riskScore >= 50 && nodes[j].riskScore >= 50) {
        edges.push({ from: i, to: j, critical: false });
      }
    }
  }
  return { nodes, edges };
}

export function AttackGraph() {
  const [zoom, setZoom] = useState(100);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [selectedNode, setSelectedNode] = useState<any | null>(null);
  const [riskFilter, setRiskFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const navigate = useNavigate();

  const { scans, completedCount, assets, findingsList, isRunning } = useScanContext();

  const filteredAssets = useMemo(() => {
    return assets.filter(a => {
      if (riskFilter === "critical" && a.riskScore < 75) return false;
      if (riskFilter === "high" && (a.riskScore < 50 || a.riskScore >= 75)) return false;
      if (riskFilter === "medium" && (a.riskScore < 30 || a.riskScore >= 50)) return false;
      if (riskFilter === "low" && a.riskScore >= 30) return false;
      if (typeFilter !== "all" && a.type !== typeFilter) return false;
      return true;
    });
  }, [assets, riskFilter, typeFilter]);

  const { nodes, edges } = useMemo(() => buildGraph(filteredAssets.slice(0, 18)), [filteredAssets]);

  const criticalEdges = edges.filter(e => e.critical).length;
  const criticalNodes = nodes.filter(n => n.riskScore >= 75).length;
  const avgRisk = nodes.length > 0 ? Math.round(nodes.reduce((s, n) => s + n.riskScore, 0) / nodes.length) : 0;
  const assetFindings = (nodeId: string) => findingsList.filter(f => f.assetId === nodeId).length;

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold mb-1">Asset Grouping</h1>
          <p className="text-gray-400">Illustrative grouping of scan assets—not observed network relationships.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            className={`px-3 md:px-4 py-2 rounded-lg border flex items-center gap-2 transition-all text-sm ${filtersOpen ? "bg-cyan-500/20 border-cyan-500/30 text-cyan-400" : "bg-white/5 hover:bg-white/10 border-white/10 text-gray-300"}`}
          >
            {filtersOpen ? <X className="w-4 h-4" /> : <Filter className="w-4 h-4" />}
            <span className="hidden sm:inline">Filters</span>
          </button>
          <button
            onClick={() => setFullscreen((v) => !v)}
            className="px-3 md:px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 flex items-center gap-2 transition-all text-sm text-gray-300"
          >
            <Maximize className="w-4 h-4" />
            <span className="hidden sm:inline">{fullscreen ? "Exit" : "Fullscreen"}</span>
          </button>
        </div>
      </div>

      <div role="note" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
        Lines in this view are generated for layout and grouping only. They do not represent confirmed connectivity, attack paths, or exploit chains.
      </div>

      {filtersOpen && (
        <div className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-300">Risk Level</label>
              <select value={riskFilter} onChange={e => setRiskFilter(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50">
                <option value="all">All Levels</option>
                <option value="critical">Critical (75+)</option>
                <option value="high">High (50–74)</option>
                <option value="medium">Medium (30–49)</option>
                <option value="low">Low (&lt;30)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-300">Asset Type</label>
              <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50">
                <option value="all">All Types</option>
                <option value="Web">Web</option>
                <option value="API">API</option>
                <option value="Database">Database</option>
                <option value="Cloud">Cloud</option>
                <option value="Service">Service</option>
              </select>
            </div>
            <div className="flex items-end">
              <button onClick={() => { setRiskFilter("all"); setTypeFilter("all"); }} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
                Clear filters
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {[
          { label: "Total Nodes", value: nodes.length },
          { label: "Illustrative Links", value: edges.length },
          { label: "Assets with Critical Findings", value: criticalNodes, highlight: criticalNodes > 0 },
          { label: "Average Finding Severity Score", value: avgRisk },
        ].map((item, i) => (
          <div key={i} className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-4">
            <div className={`text-2xl font-bold mb-1 ${item.highlight ? "text-red-400" : "text-gray-100"}`}>{item.value}</div>
            <div className="text-sm text-gray-400">{item.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-4">
          <h3 className="text-sm font-semibold mb-3">Highest Finding Severity Score</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {[
              { color: "bg-red-500", label: "Critical (75+)" },
              { color: "bg-orange-500", label: "High (50–74)" },
              { color: "bg-yellow-500", label: "Medium (30–49)" },
              { color: "bg-green-500", label: "Low (<30)" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className={`w-8 h-0.5 ${item.color} rounded-full flex-shrink-0`} />
                <span className="text-gray-400 text-xs">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Info className="w-4 h-4 text-cyan-400" />
            How to use
          </h3>
          <ul className="space-y-1 text-xs text-gray-400">
            <li>• Click nodes to view asset details and findings</li>
            <li>• Use zoom controls to navigate the graph</li>
            <li>• Links group assets by the scan that discovered them; they are not observed paths</li>
            <li>• Node size reflects the highest severity score in recorded findings</li>
          </ul>
        </div>
      </div>

      <div className={`rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 overflow-hidden relative ${fullscreen ? "fixed inset-4 z-50" : "h-[450px] md:h-[560px]"}`}>
        <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
          <button onClick={() => setZoom(z => Math.min(z + 10, 200))} className="w-10 h-10 rounded-lg bg-black/60 backdrop-blur-xl border border-white/10 flex items-center justify-center hover:bg-black/80 transition-all" aria-label="Zoom in">
            <ZoomIn className="w-5 h-5" />
          </button>
          <button onClick={() => setZoom(z => Math.max(z - 10, 40))} className="w-10 h-10 rounded-lg bg-black/60 backdrop-blur-xl border border-white/10 flex items-center justify-center hover:bg-black/80 transition-all" aria-label="Zoom out">
            <ZoomOut className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-lg bg-black/60 backdrop-blur-xl border border-white/10 flex items-center justify-center text-xs text-gray-300">{zoom}%</div>
        </div>
        {fullscreen && (
          <button onClick={() => setFullscreen(false)} className="absolute top-4 left-4 z-10 px-3 py-2 rounded-lg bg-black/60 backdrop-blur-xl border border-white/10 flex items-center gap-2 text-sm hover:bg-black/80 transition-all">
            <X className="w-4 h-4" /> Exit Fullscreen
          </button>
        )}

        {nodes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
            <svg className="w-full h-full absolute inset-0 opacity-10" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern id="g" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#g)" />
            </svg>
            <Shield className="w-16 h-16 text-gray-700 mb-4 relative z-10" />
            <h3 className="text-base font-semibold text-gray-400 mb-2 relative z-10">
              {isRunning ? "Building attack graph…" : "              No scan assets available"}
            </h3>
            <p className="text-sm text-gray-500 max-w-xs relative z-10">
              {isRunning ? "Assets will appear when the worker records scan results." : "Run an authorized scan with a configured worker to group discovered assets. This view does not derive attack paths."}
            </p>
          </div>
        ) : (
          <svg
            viewBox="0 0 800 500"
            className="w-full h-full"
            style={{ transform: `scale(${zoom / 100})`, transformOrigin: "center center" }}
          >
            <defs>
              <pattern id="attack-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
              </pattern>
              <filter id="glow">
                <feGaussianBlur stdDeviation="4" result="coloredBlur" />
                <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <marker id="arrowRed" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#ef4444" opacity="0.7" />
              </marker>
              <marker id="arrowGray" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="rgba(255,255,255,0.2)" />
              </marker>
            </defs>
            <rect width="800" height="500" fill="url(#attack-grid)" />

            {/* Edges */}
            {edges.map((edge, i) => {
              const from = nodes[edge.from];
              const to = nodes[edge.to];
              if (!from || !to) return null;
              return (
                <line
                  key={i}
                  x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                  stroke={edge.critical ? "#ef4444" : "rgba(255,255,255,0.12)"}
                  strokeWidth={edge.critical ? 1.5 : 1}
                  strokeDasharray={edge.critical ? "6,3" : "none"}
                  markerEnd={edge.critical ? "url(#arrowRed)" : "url(#arrowGray)"}
                  opacity={edge.critical ? 0.7 : 0.4}
                />
              );
            })}

            {/* Nodes */}
            {nodes.map((node, i) => {
              const c = riskColor(node.riskScore);
              const r = 12 + (node.riskScore / 100) * 14;
              const isSelected = selectedNode?.id === node.id;
              const findings = assetFindings(node.id);
              return (
                <g key={node.id} onClick={() => setSelectedNode(isSelected ? null : node)} style={{ cursor: "pointer" }}>
                  {isSelected && (
                    <circle cx={node.x} cy={node.y} r={r + 8} fill="none" stroke={c.stroke} strokeWidth="2" opacity="0.5" filter="url(#glow)" />
                  )}
                  <circle
                    cx={node.x} cy={node.y} r={r}
                    fill={c.fill}
                    stroke={c.stroke}
                    strokeWidth={isSelected ? 2.5 : 1.5}
                    filter={isSelected ? "url(#glow)" : undefined}
                  />
                  {findings > 0 && (
                    <circle cx={node.x + r - 4} cy={node.y - r + 4} r={6} fill="#ef4444" />
                  )}
                  {findings > 0 && (
                    <text x={node.x + r - 4} y={node.y - r + 4} textAnchor="middle" dominantBaseline="central" fontSize="6" fill="white" fontWeight="bold">{findings}</text>
                  )}
                  <text
                    x={node.x} y={node.y + r + 12}
                    textAnchor="middle"
                    fontSize="9"
                    fill={c.text}
                    fontFamily="system-ui, sans-serif"
                  >
                    {node.name?.length > 18 ? node.name.slice(0, 16) + "…" : node.name}
                  </text>
                  <text
                    x={node.x} y={node.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize="8"
                    fill="white"
                    fontWeight="bold"
                    fontFamily="system-ui, sans-serif"
                  >
                    {node.riskScore}
                  </text>
                </g>
              );
            })}
          </svg>
        )}

        {/* Selected node detail panel */}
        {selectedNode && (
          <div className="absolute bottom-4 left-4 right-4 md:left-auto md:w-72 z-20 rounded-xl bg-black/80 backdrop-blur-xl border border-white/20 p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="font-semibold text-sm text-gray-100">{selectedNode.name}</div>
                <div className="text-xs text-gray-400">{selectedNode.type} · {selectedNode.host}</div>
              </div>
              <button onClick={() => setSelectedNode(null)} className="text-gray-500 hover:text-gray-300">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-400">Risk Score</span>
                <span className={`font-semibold ${riskColor(selectedNode.riskScore).text}`}>{selectedNode.riskScore} — {riskColor(selectedNode.riskScore).label}</span>
              </div>
              {selectedNode.ipAddress && (
                <div className="flex justify-between">
                  <span className="text-gray-400">IP Address</span>
                  <span className="text-gray-200 font-mono">{selectedNode.ipAddress}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-400">Open Ports</span>
                <span className="text-gray-200">{selectedNode.ports?.filter((p: any) => p.state === "open").length || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Findings</span>
                <span className={`font-semibold ${assetFindings(selectedNode.id) > 0 ? "text-orange-400" : "text-gray-400"}`}>{assetFindings(selectedNode.id)}</span>
              </div>
              {selectedNode.technologies?.length > 0 && (
                <div className="mt-2">
                  <div className="text-gray-400 mb-1">Technologies</div>
                  <div className="flex flex-wrap gap-1">
                    {selectedNode.technologies.slice(0, 3).map((t: string, i: number) => (
                      <span key={i} className="px-1.5 py-0.5 rounded bg-white/10 text-gray-300">{t.split(" ")[0]}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={() => navigate(`/assets/${selectedNode.id}`)}
              className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 text-xs font-medium transition-all border border-cyan-500/30"
            >
              <ExternalLink className="w-3 h-3" /> View Full Asset Details
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
