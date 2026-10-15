import { Link } from "react-router";
import { useState, useEffect } from "react";
import {
  Globe, Activity, ChevronRight, CheckCircle2, AlertTriangle, Server,
  Database, ArrowRight, BarChart3, Search, Cpu, FileText, Menu, X, Shield,
} from "lucide-react";

const STATS = [
  { value: "Nmap", label: "TCP connect and service discovery", icon: Server },
  { value: "Nuclei", label: "Safe misconfiguration checks", icon: Shield },
  { value: "Worker-reported", label: "Progress and results", icon: Activity },
  { value: "Optional", label: "OSINT proxy when configured", icon: Globe },
];

const FEATURES = [
  {
    icon: Server,
    color: "cyan",
    title: "Server-Side Scan Jobs",
    desc: "Queue checks for authorized targets. Scans run only through a configured server-side worker; the browser never performs network scans.",
  },
  {
    icon: Search,
    color: "orange",
    title: "Nmap Service Discovery",
    desc: "Use allowlisted Nmap TCP connect scans to discover responding ports and identify services on authorized targets.",
  },
  {
    icon: Shield,
    color: "purple",
    title: "Safe Misconfiguration Checks",
    desc: "Run safe Nuclei checks for supported misconfiguration findings. Results appear only after the worker executes the checks.",
  },
  {
    icon: Globe,
    color: "blue",
    title: "Optional OSINT Proxy",
    desc: "Third-party OSINT lookups are available only when an operator configures the optional proxy. Vigil does not claim cloud inventory coverage.",
  },
  {
    icon: Shield,
    color: "green",
    title: "Findings From Scan Jobs",
    desc: "Review findings and discovered services returned by real scan jobs, with severity details where the scanner provides them.",
  },
  {
    icon: FileText,
    color: "pink",
    title: "Scan Reports",
    desc: "Generate reports from scan data available in your account. Reports are not compliance attestations or certification evidence.",
  },
  {
    icon: Activity,
    color: "yellow",
    title: "Worker-Reported Progress",
    desc: "Follow queued, running, and finished job states reported by the worker. Vigil does not provide continuous monitoring.",
  },
  {
    icon: Database,
    color: "teal",
    title: "Account-Scoped History",
    desc: "Review scan jobs and their returned results within your signed-in account. No sample production targets or fabricated scan counts.",
  },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Choose an Authorized Target",
    desc: "Create a scan job only for a target you are authorized to assess and that is permitted by the server-side worker allowlist.",
    icon: Globe,
  },
  {
    step: "02",
    title: "Queue the Scan",
    desc: "The job waits for a configured server-side worker. The dashboard reports progress only while the worker is running.",
    icon: Cpu,
  },
  {
    step: "03",
    title: "Run Supported Checks",
    desc: "The worker uses Nmap TCP connect and service discovery, with safe Nuclei misconfiguration checks where configured.",
    icon: Shield,
  },
  {
    step: "04",
    title: "Review Returned Results",
    desc: "Inspect the output recorded by the worker and generate a report from actual scan data. No findings are shown until tools have run.",
    icon: BarChart3,
  },
];

const SCAN_TYPES = [
  { name: "Nmap TCP connect scanning", time: "Server-side worker", badge: null },
  { name: "Nmap service discovery", time: "Worker-reported output", badge: null },
  { name: "Safe Nuclei misconfiguration checks", time: "When configured", badge: null },
  { name: "Optional third-party OSINT proxy", time: "Only when enabled", badge: null },
];

const colorMap: Record<string, string> = {
  cyan:   "text-cyan-300 bg-cyan-500/15 border-cyan-500/30",
  orange: "text-orange-300 bg-orange-500/15 border-orange-500/30",
  purple: "text-purple-300 bg-purple-500/15 border-purple-500/30",
  blue:   "text-blue-300 bg-blue-500/15 border-blue-500/30",
  green:  "text-green-300 bg-green-500/15 border-green-500/30",
  pink:   "text-pink-300 bg-pink-500/15 border-pink-500/30",
  yellow: "text-yellow-300 bg-yellow-500/15 border-yellow-500/30",
  teal:   "text-teal-300 bg-teal-500/15 border-teal-500/30",
};

function AnimatedOrb({ cx, cy, r, color, dur }: { cx: string; cy: string; r: string; color: string; dur: string }) {
  return (
    <circle cx={cx} cy={cy} r={r} fill={color} opacity="0.06">
      <animate attributeName="r" values={`${r};${parseInt(r) * 1.3};${r}`} dur={dur} repeatCount="indefinite" />
      <animate attributeName="opacity" values="0.06;0.12;0.06" dur={dur} repeatCount="indefinite" />
    </circle>
  );
}

export function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeFeature, setActiveFeature] = useState(0);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler);
    return () => window.removeEventListener("scroll", handler);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setActiveFeature(f => (f + 1) % FEATURES.length), 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-[#07070d] text-gray-100 overflow-x-hidden">
      {/* ── NAV ──────────────────────────────────────────────────────────────── */}
      <nav className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${scrolled ? "bg-[#07070d]/95 backdrop-blur-xl border-b border-[#1a1a2e] shadow-xl" : ""}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0">
                <img src="/logo-icon.jpg" alt="Vigil" className="w-full h-full object-cover" />
              </div>
              <span className="text-xl font-bold tracking-tight text-white">VIGIL</span>
            </div>

            <div className="hidden md:flex items-center gap-8">
              {[["Features", "#features"], ["How It Works", "#how-it-works"], ["Pricing", "#pricing"], ["Privacy", "/privacy"]].map(([label, href]) => (
                href.startsWith("/") ? (
                  <Link key={label} to={href} className="text-sm text-gray-300 hover:text-white transition-colors font-medium">{label}</Link>
                ) : (
                  <a key={label} href={href} className="text-sm text-gray-300 hover:text-white transition-colors font-medium">{label}</a>
                )
              ))}
            </div>

            <div className="flex items-center gap-3">
              <Link
                to="/login"
                className="hidden sm:inline-flex text-sm text-gray-200 hover:text-white transition-colors px-4 py-2 font-medium"
              >
                Sign In
              </Link>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity shadow-lg shadow-cyan-500/20"
              >
                Get Started
                <ArrowRight className="w-4 h-4" />
              </Link>
              <button
                className="md:hidden p-2 text-gray-300 hover:text-white"
                onClick={() => setMenuOpen(v => !v)}
                aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
                aria-expanded={menuOpen}
              >
                {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="md:hidden bg-[#0d0d18] border-b border-[#1a1a2e] px-4 py-4 space-y-3">
            {[["Features", "#features"], ["How It Works", "#how-it-works"], ["Privacy", "/privacy"]].map(([label, href]) => (
              href.startsWith("/") ? (
                <Link key={label} to={href} onClick={() => setMenuOpen(false)} className="block text-sm text-gray-300 hover:text-white py-2 font-medium">{label}</Link>
              ) : (
                <a key={label} href={href} onClick={() => setMenuOpen(false)} className="block text-sm text-gray-300 hover:text-white py-2 font-medium">{label}</a>
              )
            ))}
            <Link to="/login" onClick={() => setMenuOpen(false)} className="block text-sm text-gray-300 hover:text-white py-2 font-medium">Sign In</Link>
          </div>
        )}
      </nav>

      {/* ── HERO ─────────────────────────────────────────────────────────────── */}
      <section className="relative pt-32 pb-24 px-4 overflow-hidden">
        {/* Animated background */}
        <div className="absolute inset-0 pointer-events-none">
          <svg className="w-full h-full" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
            <defs>
              <radialGradient id="g1" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.15" />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
              </radialGradient>
              <radialGradient id="g2" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.12" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
              </radialGradient>
            </defs>
            <AnimatedOrb cx="720" cy="350" r="400" color="url(#g1)" dur="8s" />
            <AnimatedOrb cx="200" cy="200" r="250" color="url(#g2)" dur="12s" />
            <AnimatedOrb cx="1200" cy="600" r="300" color="url(#g1)" dur="10s" />
            {Array.from({ length: 20 }).map((_, i) => (
              <line key={`v${i}`} x1={i * 76} y1="0" x2={i * 76} y2="900" stroke="white" strokeOpacity="0.025" strokeWidth="1" />
            ))}
            {Array.from({ length: 12 }).map((_, i) => (
              <line key={`h${i}`} x1="0" y1={i * 75} x2="1440" y2={i * 75} stroke="white" strokeOpacity="0.025" strokeWidth="1" />
            ))}
          </svg>
        </div>

        <div className="relative max-w-7xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-xs font-medium mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            Authorized scans. Verifiable results.
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-7xl font-extrabold tracking-tight mb-6 leading-tight text-white">
            Run focused checks
            <br />
            <span className="bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-500 bg-clip-text text-transparent">
              on your own targets.
            </span>
          </h1>

          <p className="text-lg sm:text-xl text-gray-300 max-w-3xl mx-auto mb-10 leading-relaxed">
            Vigil queues authorized jobs for an allowlisted server-side worker using Nmap TCP connect and service discovery, plus safe Nuclei misconfiguration checks. Scan status and results appear only when tools run.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <Link
              to="/login"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold text-lg hover:opacity-90 transition-all shadow-2xl shadow-cyan-500/25 w-full sm:w-auto justify-center"
            >
              Open Vigil
              <ArrowRight className="w-5 h-5" />
            </Link>
            <a
              href="#features"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-[#111118] border border-[#2a2a3e] text-gray-200 font-semibold text-lg hover:bg-[#16161f] hover:border-[#363650] transition-all w-full sm:w-auto justify-center"
            >
              See How Vigil Works
              <ChevronRight className="w-5 h-5" />
            </a>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl mx-auto">
            {STATS.map((s) => (
              <div key={s.label} className="rounded-xl bg-[#111118] border border-[#1e1e2e] p-4 text-center">
                <s.icon className="w-5 h-5 text-cyan-400 mx-auto mb-2" />
                <div className="text-2xl font-bold text-white">{s.value}</div>
                <div className="text-xs text-gray-400 mt-0.5 font-medium">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRODUCT PREVIEW ──────────────────────────────────────────────────── */}
      <section className="py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="rounded-2xl bg-[#0d0d18] border border-[#1e1e2e] overflow-hidden shadow-2xl shadow-black/50">
            {/* Illustrative interface, not live account data */}
            <div className="bg-[#0a0a12] border-b border-[#1a1a28] px-4 py-3 flex items-center gap-3">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/70" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
                <div className="w-3 h-3 rounded-full bg-green-500/70" />
              </div>
              <div className="flex-1 bg-[#111118] rounded-md px-3 py-1 text-xs text-gray-400 font-mono text-center border border-[#1e1e2e]">
                Illustrative dashboard — not live scan data
              </div>
            </div>
            {/* Mock dashboard content */}
            <div className="p-6 space-y-4">
              <p className="text-xs text-cyan-300 border border-cyan-500/20 bg-cyan-500/5 rounded-lg px-3 py-2">
                Product illustration only. Live scan status and findings appear in your account after an authorized worker runs a job.
              </p>
              {/* Capabilities, not fabricated live counts */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Port discovery", val: "Nmap TCP connect", color: "text-cyan-300" },
                  { label: "Service details", val: "Worker output", color: "text-green-300" },
                  { label: "Misconfiguration", val: "Safe Nuclei checks", color: "text-orange-300" },
                  { label: "OSINT proxy", val: "Optional setup", color: "text-purple-300" },
                ].map(m => (
                  <div key={m.label} className="bg-[#111118] rounded-lg border border-[#1e1e2e] p-3">
                    <div className={`text-2xl font-bold ${m.color}`}>{m.val}</div>
                    <div className="text-xs text-gray-400 mt-0.5 font-medium">{m.label}</div>
                  </div>
                ))}
              </div>
              {/* Illustrative output types, not sample scan results */}
              <div className="rounded-lg bg-[#0a0a12] border border-[#1a1a28] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[#1a1a28] flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-orange-400" />
                  <span className="text-sm font-semibold text-gray-100">Possible output categories</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 text-sm">
                  <div className="rounded-lg border border-[#1e1e2e] bg-[#111118] p-3"><strong className="block text-gray-100">Open TCP ports</strong><span className="text-xs text-gray-400">Reported by Nmap when found</span></div>
                  <div className="rounded-lg border border-[#1e1e2e] bg-[#111118] p-3"><strong className="block text-gray-100">Detected services</strong><span className="text-xs text-gray-400">Details depend on scanner output</span></div>
                  <div className="rounded-lg border border-[#1e1e2e] bg-[#111118] p-3"><strong className="block text-gray-100">Misconfigurations</strong><span className="text-xs text-gray-400">Safe Nuclei checks, if returned</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURES ─────────────────────────────────────────────────────────── */}
      <section id="features" className="py-24 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-xs font-semibold text-cyan-400 tracking-widest uppercase">Platform Capabilities</span>
            <h2 className="text-3xl sm:text-4xl font-bold mt-3 mb-4 text-white">Focused Scanning With<br className="hidden sm:inline" /> Results You Can Verify</h2>
            <p className="text-gray-300 max-w-2xl mx-auto text-base">
              A practical view of authorized scan jobs, worker-reported progress, discovered services, and safe misconfiguration checks.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {FEATURES.map((f, i) => {
              const colors = colorMap[f.color] || colorMap["cyan"];
              const isActive = activeFeature === i;
              return (
                <div
                  key={f.title}
                  onMouseEnter={() => setActiveFeature(i)}
                  className={`rounded-xl border p-5 cursor-pointer transition-all duration-300 ${
                    isActive
                      ? `${colors} shadow-lg`
                      : "bg-[#0f0f1a] border-[#1e1e2e] hover:bg-[#13131f] hover:border-[#2a2a3e]"
                  }`}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-4 ${isActive ? "bg-white/10" : "bg-[#1a1a28]"}`}>
                    <f.icon className={`w-5 h-5 ${isActive ? colors.split(" ")[0] : "text-gray-300"}`} />
                  </div>
                  <h3 className="font-semibold mb-2 text-sm text-white">{f.title}</h3>
                  <p className="text-xs text-gray-300 leading-relaxed">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-24 px-4 bg-gradient-to-b from-transparent via-cyan-500/5 to-transparent">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-xs font-semibold text-cyan-400 tracking-widest uppercase">Process</span>
            <h2 className="text-3xl sm:text-4xl font-bold mt-3 mb-4 text-white">How Vigil Works</h2>
            <p className="text-gray-300 max-w-xl mx-auto text-base">
              Scan jobs require an available server-side worker and only return data produced by the configured tools.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {HOW_IT_WORKS.map((step, i) => (
              <div key={step.step} className="relative">
                {i < HOW_IT_WORKS.length - 1 && (
                  <div className="hidden lg:block absolute top-8 left-[calc(100%_-_12px)] w-full h-px bg-gradient-to-r from-cyan-500/40 to-transparent z-10" />
                )}
                <div className="rounded-2xl bg-[#0f0f1a] border border-[#1e1e2e] p-6 h-full">
                  <div className="text-5xl font-black text-[#1e1e2e] mb-4 leading-none select-none">{step.step}</div>
                  <div className="w-10 h-10 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center mb-4">
                    <step.icon className="w-5 h-5 text-cyan-400" />
                  </div>
                  <h3 className="font-semibold mb-2 text-white">{step.title}</h3>
                  <p className="text-sm text-gray-300 leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SCAN CAPABILITIES ────────────────────────────────────────────────── */}
      <section className="py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <span className="text-xs font-semibold text-cyan-400 tracking-widest uppercase">Scan Capabilities</span>
              <h2 className="text-3xl font-bold mt-3 mb-4 text-white">What the Worker Runs</h2>
              <p className="text-gray-300 mb-8 leading-relaxed text-base">
                These are the supported scanner components, not separate cloud, API, certificate, or continuous-monitoring products. Availability depends on your server-side worker configuration.
              </p>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold hover:opacity-90 transition-opacity shadow-lg shadow-cyan-500/20"
              >
                Run Your First Scan
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
            <div className="space-y-3">
              {SCAN_TYPES.map(s => (
                <div key={s.name} className="flex items-center justify-between rounded-xl bg-[#0f0f1a] border border-[#1e1e2e] px-4 py-3 hover:bg-[#13131f] hover:border-[#2a2a3e] transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-cyan-400 flex-shrink-0" />
                    <span className="text-sm font-medium text-gray-100">{s.name}</span>
                    {s.badge && (
                      <span className="px-2 py-0.5 text-xs rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 font-semibold">{s.badge}</span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 flex-shrink-0 font-medium">{s.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── TECH STACK / INTEGRATIONS ────────────────────────────────────────── */}
      <section className="py-16 px-4 border-y border-[#1a1a28]">
        <div className="max-w-6xl mx-auto">
          <p className="text-center text-xs text-gray-500 uppercase tracking-widest mb-8 font-semibold">Scanning Components</p>
          <div className="flex flex-wrap items-center justify-center gap-8 opacity-70">
            {[
              { name: "Nmap TCP connect", icon: Server },
              { name: "Nmap service discovery", icon: Search },
              { name: "Safe Nuclei checks", icon: Shield },
              { name: "Optional OSINT proxy", icon: Globe },
            ].map(t => (
              <div key={t.name} className="flex items-center gap-2 text-gray-300">
                <t.icon className="w-4 h-4" />
                <span className="text-sm font-semibold">{t.name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ──────────────────────────────────────────────────────────── */}
      <section id="pricing" className="py-24 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-xs font-semibold text-cyan-400 tracking-widest uppercase">Availability</span>
            <h2 className="text-3xl sm:text-4xl font-bold mt-3 mb-4 text-white">Current Capabilities and Limits</h2>
            <p className="text-gray-300 max-w-xl mx-auto text-base">No commercial plan tiers or usage quotas are currently configured in Vigil.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            {[
              {
                name: "Available",
                price: "Scan jobs",
                sub: "worker required",
                highlight: true,
                features: [
                  { text: "Authorized, allowlisted server-side jobs", available: true },
                  { text: "Nmap TCP connect and service discovery", available: true },
                  { text: "Safe Nuclei misconfiguration checks", available: true },
                  { text: "Progress and results only when tools run", available: true },
                ],
              },
              {
                name: "Not offered",
                price: "Unavailable",
                sub: "not part of this product",
                highlight: false,
                features: [
                  { text: "Managed or continuous scanning service", available: false },
                  { text: "Broad CVE coverage or AI/ML risk scoring", available: false },
                  { text: "Cloud inventory, compliance readiness, or certification", available: false },
                  { text: "Unlimited quotas, API keys, or an SLA", available: false },
                ],
              },
            ].map(plan => (
              <div key={plan.name} className={`rounded-2xl border p-6 flex flex-col ${plan.highlight ? "bg-gradient-to-b from-cyan-500/10 to-blue-500/5 border-cyan-500/40 shadow-xl shadow-cyan-500/10" : "bg-[#0f0f1a] border-[#1e1e2e]"}`}>
                {plan.highlight && (
                  <div className="flex justify-center mb-4">
                    <span className="px-3 py-1 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-xs font-bold">Most Popular</span>
                  </div>
                )}
                <h3 className="text-lg font-bold mb-1 text-white">{plan.name}</h3>
                <div className="flex items-baseline gap-1 mb-1">
                  <span className="text-3xl font-extrabold text-white">{plan.price}</span>
                  <span className="text-sm text-gray-400 font-medium">{plan.sub}</span>
                </div>
                <div className="border-t border-[#1e1e2e] my-5" />
                <ul className="space-y-3 flex-1 mb-6">
                  {plan.features.map(feature => (
                    <li key={feature.text} className="flex items-start gap-2 text-sm text-gray-200">
                      {feature.available
                        ? <CheckCircle2 className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
                        : <X className="w-4 h-4 text-gray-500 flex-shrink-0 mt-0.5" />}
                      {feature.text}
                    </li>
                  ))}
                </ul>
                {plan.highlight ? (
                  <Link
                    to="/login"
                    className="block text-center py-3 rounded-xl font-semibold text-sm transition-all bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:opacity-90 shadow-lg shadow-cyan-500/20"
                  >
                    Open Vigil
                  </Link>
                ) : (
                  <div className="text-center py-3 rounded-xl border border-[#2a2a3e] text-gray-500 text-sm">Not currently available</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ───────────────────────────────────────────────────────── */}
      <section className="py-24 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="rounded-3xl bg-gradient-to-br from-cyan-500/10 via-blue-500/10 to-purple-500/10 border border-[#2a2a3e] p-12 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-blue-500/5" />
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-cyan-500/30">
                <Shield className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold mb-4 text-white">
                Ready to Review Authorized Scan Results?
              </h2>
              <p className="text-gray-300 text-lg mb-8 max-w-xl mx-auto">
                Use your configured server-side worker to run allowlisted checks. A dashboard alone does not perform scans.
              </p>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold text-lg hover:opacity-90 transition-opacity shadow-2xl shadow-cyan-500/25"
              >
                Sign In or Create an Account
                <ArrowRight className="w-5 h-5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────────────── */}
      <footer className="border-t border-[#1a1a28] py-12 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 mb-10">
            <div className="col-span-2 sm:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-7 h-7 rounded-lg overflow-hidden flex-shrink-0">
                  <img src="/logo-icon.jpg" alt="Vigil" className="w-full h-full object-cover" />
                </div>
                <span className="font-bold text-white">VIGIL</span>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed max-w-xs">
                Authorized server-side scan jobs with Nmap discovery and safe Nuclei checks.
              </p>
            </div>
            <div>
              <h4 className="text-sm font-semibold mb-4 text-white">Platform</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#features" className="hover:text-gray-200 transition-colors">Features</a></li>
                <li><a href="#how-it-works" className="hover:text-gray-200 transition-colors">How It Works</a></li>
                <li><a href="#pricing" className="hover:text-gray-200 transition-colors">Pricing</a></li>
                <li><Link to="/login" className="hover:text-gray-200 transition-colors">Sign In</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold mb-4 text-white">Security</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li>Nmap TCP connect scans</li>
                <li>Service discovery</li>
                <li>Safe misconfiguration checks</li>
                <li>Optional OSINT proxy</li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold mb-4 text-white">Legal</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><Link to="/privacy" className="hover:text-gray-200 transition-colors">Privacy Policy</Link></li>
                <li>Terms of Service</li>
                <li>Cookie Policy</li>
                <li>Security</li>
              </ul>
            </div>
          </div>
          <div className="border-t border-[#1a1a28] pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-xs text-gray-400">
              © {new Date().getFullYear()} Vigil Security Platform. All rights reserved.
            </p>
            <div className="flex items-center gap-4 text-xs text-gray-400">
              <Link to="/privacy" className="hover:text-gray-200 transition-colors">Privacy Policy</Link>
              <span className="text-gray-600">·</span>
              <span>Not a managed or certified scanning service</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
