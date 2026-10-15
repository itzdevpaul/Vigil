import { useParams, Link } from "react-router";
import {
  ArrowLeft, Shield, Activity, Clock, AlertTriangle,
  Activity, Lock, Database, Cpu, Globe, ExternalLink,
  CheckCircle2, XCircle, Server,
} from "lucide-react";
import { useScanContext } from "../contexts/ScanContext";

function severityColor(sev: string) {
  if (sev === "critical") return { bg: "bg-red-500/20", text: "text-red-400", border: "border-red-500/30" };
  if (sev === "high") return { bg: "bg-orange-500/20", text: "text-orange-400", border: "border-orange-500/30" };
  if (sev === "medium") return { bg: "bg-yellow-500/20", text: "text-yellow-400", border: "border-yellow-500/30" };
  return { bg: "bg-green-500/20", text: "text-green-400", border: "border-green-500/30" };
}

function riskLabel(score: number) {
  if (score >= 75) return { label: "Critical", color: "text-red-400" };
  if (score >= 50) return { label: "High", color: "text-orange-400" };
  if (score >= 30) return { label: "Medium", color: "text-yellow-400" };
  return { label: "Low", color: "text-green-400" };
}

export function AssetDetail() {
  const { assetId } = useParams();
  const { assets, findingsList, scans } = useScanContext();
  const asset = assets.find((a) => a.id === assetId);
  const assetFindings = findingsList.filter((f) => f.assetId === assetId);
  const connectedAssets = assets.filter((a) => a.host !== asset?.host && a.scanId === asset?.scanId && a.id !== assetId);
  const scan = scans.find(s => s.id === asset?.scanId);

  const openPorts = (asset?.ports || []).filter((p: any) => p.state === "open");
  const filteredPorts = (asset?.ports || []).filter((p: any) => p.state === "filtered");
  const risk = asset ? riskLabel(asset.riskScore) : null;

  const criticalFindings = assetFindings.filter(f => f.severity === "critical");
  const highFindings = assetFindings.filter(f => f.severity === "high");

  const certExpiry = asset?.certificates?.expiry ? new Date(asset.certificates.expiry) : null;
  const certExpired = certExpiry ? certExpiry < new Date() : false;
  const certExpiringSoon = certExpiry && !certExpired ? (certExpiry.getTime() - Date.now()) < 30 * 24 * 60 * 60 * 1000 : false;

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <Link to="/assets" className="inline-flex items-center gap-2 text-gray-400 hover:text-gray-200 transition-colors text-sm">
        <ArrowLeft className="w-4 h-4" />
        Back to Assets
      </Link>

      {/* Header */}
      <div className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-5 md:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 md:w-16 md:h-16 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center flex-shrink-0">
              <Database className="w-7 h-7 md:w-8 md:h-8 text-white" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold mb-1">
                {asset ? asset.name : `Asset #${assetId}`}
              </h1>
              <div className="flex flex-wrap gap-2 mt-1">
                {asset && (
                  <>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-gray-300">{asset.type}</span>
                    {asset.status && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">Active</span>
                    )}
                    {scan && <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-gray-400">{scan.name}</span>}
                  </>
                )}
              </div>
              <p className="text-sm text-gray-400 mt-1">
                {asset ? `Discovered ${asset.discoveredAt?.toDate ? asset.discoveredAt.toDate().toLocaleString() : "recently"}` : "No data available for this asset"}
              </p>
            </div>
          </div>
          <div className="sm:text-right">
            <div className="text-sm text-gray-400 mb-1">Finding Severity Score</div>
            <div className={`text-4xl font-bold ${risk?.color || "text-gray-500"}`}>{asset ? asset.riskScore : "--"}</div>
            {risk && <div className={`text-sm font-semibold mt-1 ${risk.color}`}>{risk.label} severity</div>}
            {asset?.ipAddress && (
              <div className="text-xs text-gray-500 mt-1 font-mono">{asset.ipAddress}</div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Host", value: asset?.host || "--" },
            { label: "IP Address", value: asset?.ipAddress || "Resolving..." },
            { label: "Open Ports", value: openPorts.length || "--" },
            { label: "Findings", value: assetFindings.length || "--" },
          ].map((item, i) => (
            <div key={i} className="px-4 py-3 rounded-lg bg-black/40 border border-white/10">
              <div className="text-xs text-gray-400 mb-1">{item.label}</div>
              <div className="font-semibold text-gray-200 text-sm truncate">{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Finding Summary */}
      <div className="rounded-xl bg-gradient-to-br from-purple-500/10 to-blue-500/10 backdrop-blur-xl border border-purple-500/30 p-5 md:p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-lg bg-purple-500/20 flex items-center justify-center flex-shrink-0">
            <Activity className="w-6 h-6 text-purple-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold mb-2">Finding Summary</h3>
            <p className="text-xs text-gray-500 mb-2">Based on scanner output only; not an AI assessment or validated risk score.</p>
            {assetFindings.length === 0 ? (
              <p className="text-gray-400 text-sm">No findings are recorded for this asset in the available scan results.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-gray-300 text-sm">
                  {criticalFindings.length > 0
                    ? `${criticalFindings.length} critical finding${criticalFindings.length > 1 ? "s are" : " is"} recorded for this asset.`
                    : highFindings.length > 0
                    ? `${highFindings.length} high-severity finding${highFindings.length > 1 ? "s" : ""} detected.`
                    : `${assetFindings.length} finding${assetFindings.length > 1 ? "s are" : " is"} recorded. No critical findings are present in these results.`}
                  {" "}
                  {asset?.technologies?.length > 0 && `Technologies detected: ${asset.technologies.slice(0, 2).join(", ")}.`}
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {criticalFindings.length > 0 && (
                    <span className="text-xs px-2 py-1 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">{criticalFindings.length} Critical</span>
                  )}
                  {highFindings.length > 0 && (
                    <span className="text-xs px-2 py-1 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30">{highFindings.length} High</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        {/* Technologies */}
        <div className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-5">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-cyan-400" />
            Detected Technologies
          </h3>
          {asset?.technologies?.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {asset.technologies.map((tech: string, i: number) => (
                <span key={i} className="px-3 py-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 text-sm border border-cyan-500/20">
                  {tech}
                </span>
              ))}
            </div>
          ) : asset ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Type</span>
                <span className="text-gray-200 font-medium">{asset.type}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Host</span>
                <span className="text-gray-200 font-mono">{asset.host}</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6">
              <Shield className="w-10 h-10 text-gray-700 mb-2" />
              <p className="text-sm text-gray-500">No technologies detected yet</p>
            </div>
          )}
        </div>

        {/* Open Ports */}
        <div className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-5">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Server className="w-5 h-5 text-cyan-400" />
            Port Scan Results
          </h3>
          {openPorts.length > 0 || filteredPorts.length > 0 ? (
            <div className="space-y-2">
              {[...openPorts, ...filteredPorts].map((port: any, i: number) => (
                <div key={i} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-black/30 border border-white/5">
                  <div className="flex items-center gap-2">
                    {port.state === "open"
                      ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                      : <XCircle className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />}
                    <span className="font-mono text-sm text-gray-200">{port.port}/{port.service}</span>
                  </div>
                  <div className="text-right">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${port.state === "open" ? "bg-green-500/20 text-green-400" : "bg-white/10 text-gray-500"}`}>
                      {port.state}
                    </span>
                    {port.version && <div className="text-xs text-gray-500 mt-0.5 truncate max-w-28">{port.version}</div>}
                  </div>
                </div>
              ))}
            </div>
          ) : asset ? (
            <div className="flex flex-col items-center justify-center py-6">
              <Lock className="w-10 h-10 text-gray-700 mb-2" />
              <p className="text-sm text-gray-500">Port scan in progress or no open ports found</p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6">
              <Lock className="w-10 h-10 text-gray-700 mb-2" />
              <p className="text-sm text-gray-500">No port data available</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        {/* Certificate Info */}
        <div className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-5">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Globe className="w-5 h-5 text-cyan-400" />
            SSL Certificate
          </h3>
          {asset?.certificates ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Issuer</span>
                <span className="text-gray-200">{asset.certificates.issuer || "Unknown"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Expiry</span>
                <span className={certExpired ? "text-red-400" : certExpiringSoon ? "text-yellow-400" : "text-green-400"}>
                  {asset.certificates.expiry || "Unknown"}
                  {certExpired ? " (EXPIRED)" : certExpiringSoon ? " (expiring soon)" : ""}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Valid</span>
                <span className={asset.certificates.valid ? "text-green-400" : "text-red-400"}>
                  {asset.certificates.valid ? "✓ Valid" : "✗ Invalid / Self-signed"}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6">
              <Globe className="w-10 h-10 text-gray-700 mb-2" />
              <p className="text-sm text-gray-500">No certificate data available</p>
            </div>
          )}
        </div>

        {/* Connected Assets */}
        <div className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-5">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-cyan-400" />
            Connected Assets
          </h3>
          {connectedAssets.length > 0 ? (
            <div className="space-y-2">
              {connectedAssets.slice(0, 4).map((a, i) => (
                <Link
                  key={i}
                  to={`/assets/${a.id}`}
                  className="flex items-center justify-between gap-2 p-2 rounded-lg bg-black/30 border border-white/5 hover:bg-white/5 transition-colors"
                >
                  <div>
                    <div className="text-sm text-gray-200">{a.name}</div>
                    <div className="text-xs text-gray-500">{a.type}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold ${riskLabel(a.riskScore).color}`}>{a.riskScore}</span>
                    <ExternalLink className="w-3 h-3 text-gray-500" />
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6">
              <Activity className="w-10 h-10 text-gray-700 mb-2" />
              <p className="text-sm text-gray-500">No connected assets in this scan</p>
            </div>
          )}
        </div>
      </div>

      {/* Findings */}
      <div className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-5">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-cyan-400" />
          Security Findings ({assetFindings.length})
        </h3>
        {assetFindings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8">
            <AlertTriangle className="w-10 h-10 text-gray-700 mb-2" />
            <p className="text-sm text-gray-500">No findings recorded for this asset</p>
          </div>
        ) : (
          <div className="space-y-3">
            {assetFindings.map((f, i) => {
              const c = severityColor(f.severity);
              return (
                <div key={i} className={`rounded-lg p-4 ${c.bg} border ${c.border}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${c.text} bg-black/30`}>
                        {f.severity?.toUpperCase()}
                      </span>
                      {f.cve && (
                        <a
                          href={`https://nvd.nist.gov/vuln/detail/${f.cve}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-purple-400 hover:text-purple-300 font-mono flex items-center gap-1"
                        >
                          {f.cve} <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      {f.cvss && (
                        <span className="text-xs text-gray-400">CVSS {f.cvss}</span>
                      )}
                    </div>
                    {f.port && (
                      <span className="text-xs text-gray-400 font-mono">Port {f.port}/{f.service}</span>
                    )}
                  </div>
                  <div className="font-semibold text-sm text-gray-100 mb-1">{f.title}</div>
                  {f.description && <p className="text-xs text-gray-400 mb-2">{f.description}</p>}
                  {f.remediation && (
                    <div className="mt-2 p-2 rounded-lg bg-black/30 border border-white/5">
                      <div className="text-xs font-semibold text-gray-300 mb-1 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-green-400" /> Remediation
                      </div>
                      <div className="text-xs text-gray-400">{f.remediation}</div>
                    </div>
                  )}
                  {f.category && (
                    <div className="mt-2">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-white/10 text-gray-400">{f.category}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
