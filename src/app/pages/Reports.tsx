import { useState, useEffect } from "react";
import { onSnapshot } from "firebase/firestore";
import {
  FileText, Download, Calendar, TrendingUp, Shield, AlertTriangle,
  Clock, X, Plus, CheckCircle2, Loader2, BarChart3,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../components/AuthProvider";
import { useScanContext } from "../contexts/ScanContext";
import { createReport, getReportsQuery, incrementReportDownload, type Report } from "../../firebase";
import { formatDistanceToNow } from "date-fns";

const TEMPLATES = [
  { name: "Scan Summary", icon: TrendingUp, color: "cyan", desc: "Overview of scan data recorded in your account" },
  { name: "Technical Findings", icon: Shield, color: "blue", desc: "Findings and scanner-provided details" },
  { name: "Finding Severity Summary", icon: FileText, color: "purple", desc: "Counts by severity in recorded findings" },
  { name: "Scan Activity", icon: AlertTriangle, color: "orange", desc: "Scan status and results from available jobs" },
];

export function Reports() {
  const { user, emailVerified, ensureEmailVerified } = useAuth();
  const { scans, assets, findingsList, completedCount } = useScanContext();
  const [reports, setReports] = useState<(Report & { id: string })[]>([]);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState("Scan Summary");
  const [selectedPeriod, setSelectedPeriod] = useState("Last 30 days");
  const [selectedFormat, setSelectedFormat] = useState("PDF");
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(getReportsQuery(), snap => {
      setReports(snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Report & { id: string }))
        .sort((a, b) => (b.generatedAt?.toMillis?.() || 0) - (a.generatedAt?.toMillis?.() || 0)));
    }, () => {});
    return unsub;
  }, []);

  const criticalFindings = findingsList.filter(f => f.severity === "critical").length;
  const totalDownloads = reports.reduce((s, r) => s + (r.downloadCount || 0), 0);
  const thisMonth = reports.filter(r => {
    if (!r.generatedAt) return false;
    const d = r.generatedAt.toDate ? r.generatedAt.toDate() : new Date(r.generatedAt as any);
    return d.getMonth() === new Date().getMonth();
  }).length;

  const handleGenerate = async () => {
    if (!(await ensureEmailVerified())) return;
    if (!user) { toast.error("You must be signed in."); return; }
    setGenerating(true);
    try {
      await createReport(
        user.uid,
        { title: selectedTemplate, template: selectedTemplate, period: selectedPeriod, format: selectedFormat },
        {
          totalFindings: findingsList.length,
          criticalFindings,
          assetsScanned: assets.length,
          scansIncluded: completedCount,
        }
      );
      setShowGenerateModal(false);
      toast.success("Report ready to export", { description: "Its PDF will be assembled when you download it." });
    } catch (err: any) {
      toast.error("Failed to generate: " + (err?.message || "Unknown error"));
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = async (report: Report & { id: string }) => {
    if (!(await ensureEmailVerified())) return;
    if (report.status !== "ready") { toast.info("Report is still generating…"); return; }
    try {
      await incrementReportDownload(report.id);
      const { jsPDF } = await import("jspdf");
      const autoTable = (await import("jspdf-autotable")).default;

      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();

      // ── Header band ───────────────────────────────────────────────────────
      doc.setFillColor(10, 10, 15);
      doc.rect(0, 0, pageW, 38, "F");
      doc.setFillColor(6, 182, 212);
      doc.rect(0, 0, 4, 38, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(20);
      doc.setTextColor(255, 255, 255);
      doc.text("VIGIL", 12, 17);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(150, 150, 180);
      doc.text("Security Platform · vigil.com.ng", 12, 24);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(220, 230, 255);
      doc.text(report.title, 12, 33);

      // Date + period (right side)
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(100, 120, 150);
      doc.text(new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }), pageW - 12, 17, { align: "right" });
      doc.text(`Period: ${report.period}`, pageW - 12, 24, { align: "right" });

      // ── Summary cards ─────────────────────────────────────────────────────
      const cardY = 46;
      const cards = [
        { label: "Total Findings",    value: String(report.totalFindings ?? findingsList.length), color: [234, 179, 8] as [number,number,number] },
        { label: "Critical Findings", value: String(report.criticalFindings ?? 0),                color: [239, 68, 68] as [number,number,number] },
        { label: "Assets Scanned",   value: String(report.assetsScanned ?? assets.length),       color: [6, 182, 212] as [number,number,number] },
        { label: "Scans Included",   value: String(report.scansIncluded ?? completedCount),      color: [34, 197, 94] as [number,number,number] },
      ];
      const cardW = (pageW - 24 - 9) / 4;
      cards.forEach((c, i) => {
        const x = 12 + i * (cardW + 3);
        doc.setFillColor(15, 15, 25);
        doc.roundedRect(x, cardY, cardW, 20, 2, 2, "F");
        doc.setFillColor(...c.color);
        doc.roundedRect(x, cardY, 3, 20, 1, 1, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        doc.setTextColor(255, 255, 255);
        doc.text(c.value, x + cardW / 2 + 1, cardY + 10, { align: "center" });
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(130, 140, 170);
        doc.text(c.label, x + cardW / 2 + 1, cardY + 16, { align: "center" });
      });

      // ── Findings table ────────────────────────────────────────────────────
      const severityColor = (s: string): [number,number,number] => {
        if (s === "critical") return [220, 50, 50];
        if (s === "high")     return [234, 100, 40];
        if (s === "medium")   return [200, 150, 30];
        return [100, 150, 100];
      };

      const tableRows = findingsList.slice(0, 50).map(f => [
        f.title?.slice(0, 60) ?? "—",
        f.severity?.toUpperCase() ?? "—",
        f.category ?? "—",
        f.assetName ?? "—",
        f.cvss?.toFixed(1) ?? "—",
      ]);

      if (tableRows.length > 0) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(200, 210, 240);
        doc.text("Findings Detail", 12, cardY + 30);

        autoTable(doc, {
          startY: cardY + 35,
          head: [["Finding", "Severity", "Category", "Asset", "CVSS"]],
          body: tableRows,
          theme: "plain",
          styles: {
            font: "helvetica",
            fontSize: 8,
            textColor: [200, 205, 220],
            fillColor: [10, 10, 20],
            lineColor: [30, 30, 50],
            lineWidth: 0.1,
            cellPadding: 2.5,
            overflow: "ellipsize",
          },
          headStyles: {
            fillColor: [15, 15, 30],
            textColor: [100, 160, 220],
            fontStyle: "bold",
            fontSize: 8,
          },
          alternateRowStyles: { fillColor: [13, 13, 22] },
          columnStyles: {
            0: { cellWidth: 72 },
            1: { cellWidth: 22, halign: "center" as const },
            2: { cellWidth: 32 },
            3: { cellWidth: 40 },
            4: { cellWidth: 14, halign: "center" as const },
          },
          didParseCell(data) {
            if (data.column.index === 1 && data.section === "body") {
              const sev = String(data.cell.raw).toLowerCase();
              const [r, g, b] = severityColor(sev);
              data.cell.styles.textColor = [r, g, b];
              data.cell.styles.fontStyle = "bold";
            }
          },
          margin: { left: 12, right: 12 },
        });
      } else {
        doc.setFontSize(9);
        doc.setTextColor(120, 130, 160);
        doc.text("No findings recorded for this period.", 12, cardY + 38);
      }

      // ── Footer ────────────────────────────────────────────────────────────
      const finalY = (doc as any).lastAutoTable?.finalY ?? cardY + 40;
      if (finalY + 18 < pageH) {
        doc.setDrawColor(30, 30, 50);
        doc.setLineWidth(0.3);
        doc.line(12, pageH - 14, pageW - 12, pageH - 14);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(80, 90, 120);
        doc.text("Vigil Security Platform  ·  support@vigil.com.ng  ·  vigil.com.ng", 12, pageH - 8);
        doc.text(`Generated ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`, pageW - 12, pageH - 8, { align: "right" });
      }

      const filename = `${report.template.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.pdf`;
      doc.save(filename);
      toast.success("PDF downloaded");
    } catch (err: any) {
      toast.error("PDF generation failed: " + (err?.message || "Unknown error"));
    }
  };

  const handleScheduleUnavailable = async () => {
    if (!(await ensureEmailVerified())) return;
    toast.info("Scheduled reports are not available yet.");
  };

  const openGenerateModal = async () => {
    if (!(await ensureEmailVerified())) return;
    setShowGenerateModal(true);
  };

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold mb-1">Reports</h1>
          <p className="text-gray-400">Security intelligence reports and analytics</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleScheduleUnavailable} disabled={!emailVerified} title={!emailVerified ? "Verify your email to access report actions" : "Scheduled reports are not available yet"} className="px-3 md:px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 flex items-center gap-2 transition-all text-sm disabled:opacity-50">
            <Calendar className="w-4 h-4" /><span className="hidden sm:inline">Schedule (unavailable)</span>
          </button>
          <button onClick={openGenerateModal} disabled={!emailVerified} title={!emailVerified ? "Verify your email before generating reports" : undefined} className="px-3 md:px-4 py-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-500/30 flex items-center gap-2 transition-all text-sm disabled:opacity-50">
            <Plus className="w-4 h-4" /><span>Generate</span>
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {[
          { label: "Total Reports", icon: FileText, color: "text-cyan-400", value: reports.length },
          { label: "This Month", icon: Calendar, color: "text-green-400", value: thisMonth },
          { label: "Ready", icon: CheckCircle2, color: "text-yellow-400", value: reports.filter(r => r.status === "ready").length },
          { label: "Downloads", icon: Download, color: "text-purple-400", value: totalDownloads },
        ].map((stat, i) => (
          <div key={i} className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-400">{stat.label}</span>
              <stat.icon className={`w-4 h-4 ${stat.color}`} />
            </div>
            <div className={`text-2xl font-bold ${stat.value === 0 ? "text-gray-500" : "text-gray-100"}`}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Data snapshot */}
      {(findingsList.length > 0 || assets.length > 0) && (
        <div className="rounded-xl bg-gradient-to-br from-cyan-500/5 to-blue-500/5 border border-cyan-500/20 p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-cyan-400" />
            Current Data Snapshot
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            {[
              { label: "Total Findings", value: findingsList.length, c: "text-orange-400" },
              { label: "Critical", value: criticalFindings, c: "text-red-400" },
              { label: "Assets Scanned", value: assets.length, c: "text-cyan-400" },
              { label: "Scans Run", value: completedCount, c: "text-green-400" },
            ].map((item, i) => (
              <div key={i}>
                <div className={`text-xl font-bold ${item.c}`}>{item.value}</div>
                <div className="text-gray-400 text-xs">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Reports */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Recent Reports</h2>
        {reports.length === 0 ? (
          <div className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-10 text-center">
            <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8 text-gray-600" />
            </div>
            <h3 className="text-base font-semibold text-gray-300 mb-2">No reports generated yet</h3>
            <p className="text-gray-500 text-sm mb-4 max-w-xs mx-auto">Generate your first report to get a summary of your security posture.</p>
            <button onClick={openGenerateModal} disabled={!emailVerified} title={!emailVerified ? "Verify your email before generating reports" : undefined} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 text-sm font-medium transition-all border border-cyan-500/30 disabled:opacity-50">
              <Plus className="w-4 h-4" /> Generate First Report
            </button>
          </div>
        ) : (
          <div className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 overflow-hidden">
            <div className="divide-y divide-white/5">
              {reports.map(report => (
                <div key={report.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-5 h-5 text-cyan-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-sm text-gray-200">{report.title}</div>
                      <div className="text-xs text-gray-500 flex flex-wrap gap-2">
                        <span>{report.period}</span>
                        <span>·</span>
                        <span>{report.format}</span>
                        <span>·</span>
                        <span>{report.totalFindings} findings, {report.assetsScanned} assets</span>
                        {report.generatedAt && (
                          <>
                            <span>·</span>
                            <span>{formatDistanceToNow(report.generatedAt.toDate ? report.generatedAt.toDate() : new Date(), { addSuffix: true })}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="flex items-center gap-1 text-xs text-green-400">
                      <CheckCircle2 className="w-3 h-3" /> Ready to export
                    </span>
                    <button
                      onClick={() => handleDownload(report)}
                      disabled={report.status !== "ready" || !emailVerified}
                      title={!emailVerified ? "Verify your email before exporting reports" : undefined}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 text-xs border border-cyan-500/30 transition-all disabled:opacity-40"
                    >
                      <Download className="w-3 h-3" /> Download
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Templates */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Available Templates</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          {TEMPLATES.map((template, idx) => (
            <button
              key={idx}
              onClick={() => { setSelectedTemplate(template.name); void openGenerateModal(); }}
              disabled={!emailVerified}
              title={!emailVerified ? "Verify your email before generating reports" : undefined}
              className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-5 hover:bg-white/10 transition-colors text-left group"
            >
              <div className={`w-12 h-12 rounded-lg bg-${template.color}-500/20 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform`}>
                <template.icon className={`w-6 h-6 text-${template.color}-400`} />
              </div>
              <h3 className="font-semibold text-sm mb-1">{template.name}</h3>
              <p className="text-xs text-gray-500">{template.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Generate Modal */}
      {showGenerateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-[#0d0d18] border border-white/10 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold">Generate Report</h3>
              <button onClick={() => setShowGenerateModal(false)} className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-300">Template</label>
                <div className="grid grid-cols-2 gap-2">
                  {TEMPLATES.map(t => (
                    <button key={t.name} onClick={() => setSelectedTemplate(t.name)}
                      className={`p-3 rounded-lg border text-left text-sm transition-all ${selectedTemplate === t.name ? "bg-cyan-500/20 border-cyan-500/30 text-cyan-400" : "bg-white/5 border-white/10 text-gray-400 hover:bg-white/10"}`}>
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-300">Period</label>
                <select value={selectedPeriod} onChange={e => setSelectedPeriod(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50">
                  <option>Last 7 days</option>
                  <option>Last 30 days</option>
                  <option>Last 90 days</option>
                  <option>All time</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-300">Format</label>
                <div className="flex gap-2">
                  {["PDF", "CSV", "JSON"].map(fmt => (
                    <button key={fmt} onClick={() => setSelectedFormat(fmt)}
                      className={`flex-1 py-2 rounded-lg border text-sm transition-all ${selectedFormat === fmt ? "bg-cyan-500/20 border-cyan-500/30 text-cyan-400" : "bg-white/5 border-white/10 text-gray-300 hover:bg-white/10"}`}>
                      {fmt}
                    </button>
                  ))}
                </div>
              </div>
              {/* Data preview */}
              <div className="p-3 rounded-lg bg-black/30 border border-white/10 text-xs text-gray-400">
                Will include: <span className="text-gray-200">{findingsList.length} findings</span> · <span className="text-gray-200">{assets.length} assets</span> · <span className="text-gray-200">{completedCount} scans</span>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowGenerateModal(false)} className="flex-1 px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-medium transition-all">Cancel</button>
              <button onClick={handleGenerate} disabled={generating || !emailVerified} title={!emailVerified ? "Verify your email before generating reports" : undefined} className="flex-1 px-4 py-2.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-500/30 text-sm font-medium transition-all disabled:opacity-60 flex items-center justify-center gap-2">
                {generating ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</> : <><FileText className="w-4 h-4" /> Generate</>}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function buildReportContent(report: Report & { id: string }, findings: any[], assets: any[], scans: any[]): string {
  const now = new Date().toISOString();
  const critical = findings.filter(f => f.severity === "critical");
  const high = findings.filter(f => f.severity === "high");
  const lines = [
    `VIGIL SECURITY PLATFORM — ${report.template.toUpperCase()}`,
    `Generated: ${now}`,
    `Period: ${report.period}`,
    "=".repeat(60),
    "",
    "EXECUTIVE SUMMARY",
    "-".repeat(40),
    `Total Findings:      ${findings.length}`,
    `Critical:            ${critical.length}`,
    `High:                ${high.length}`,
    `Assets Scanned:      ${assets.length}`,
    `Scans Completed:     ${scans.filter(s => s.status === "completed").length}`,
    "",
    "TOP CRITICAL FINDINGS",
    "-".repeat(40),
    ...critical.slice(0, 10).map((f, i) =>
      `${i + 1}. [${f.severity?.toUpperCase()}] ${f.title}\n   CVE: ${f.cve || "N/A"} | CVSS: ${f.cvss || "N/A"} | Asset: ${f.assetName || f.assetId}\n   ${f.remediation || ""}`
    ),
    "",
    "ASSETS",
    "-".repeat(40),
    ...assets.slice(0, 20).map(a =>
      `${a.name} (${a.type}) — Risk: ${a.riskScore} — IP: ${a.ipAddress || "N/A"} — Ports: ${(a.ports || []).filter((p: any) => p.state === "open").map((p: any) => p.port).join(", ") || "N/A"}`
    ),
    "",
    `Report ID: ${report.id}`,
  ];
  return lines.join("\n");
}
