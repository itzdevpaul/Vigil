import { Outlet, NavLink, useNavigate, Link } from "react-router";
import {
  LayoutDashboard,
  Database,
  Network,
  Globe,
  Activity,
  FileText,
  Settings as SettingsIcon,
  Search,
  Bell,
  ChevronDown,
  Menu,
  X,
  XCircle,
  CheckCircle2,
  AlertTriangle,
  Clock,
  LogOut,
  Sun,
  Moon,
  User,
} from "lucide-react";
import { useAuth, type Alert } from "./AuthProvider";
import { MailCheck } from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { useScanContext } from "../contexts/ScanContext";
import { searchUserScans, type GlobalSearchResult } from "../search-utils";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";

function alertAge(alert: Alert): string {
  if (!alert.timestamp) return "just now";
  try {
    return formatDistanceToNow(alert.timestamp.toDate(), { addSuffix: true });
  } catch {
    return "just now";
  }
}

function AlertIcon({ type }: { type: Alert["type"] }) {
  if (type === "critical") return <XCircle className="w-4 h-4" />;
  if (type === "warning") return <AlertTriangle className="w-4 h-4" />;
  if (type === "success") return <CheckCircle2 className="w-4 h-4" />;
  return <Activity className="w-4 h-4" />;
}

function alertColors(type: Alert["type"]) {
  if (type === "critical") return "bg-red-500/20 text-red-400";
  if (type === "warning") return "bg-orange-500/20 text-orange-400";
  if (type === "success") return "bg-green-500/20 text-green-400";
  return "bg-cyan-500/20 text-cyan-400";
}

export function RootLayout() {
  const navigate = useNavigate();
  const { user, emailVerified, resendVerification, ensureEmailVerified, logout, alerts, unreadAlertCount, markAlertRead, markAllAlertsRead, firestoreError } = useAuth();
  const { scans, firestoreOk } = useScanContext();
  const [verifySent, setVerifySent] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);

  const handleResendVerification = async () => {
    try {
      await resendVerification();
      setVerifySent(true);
    } catch { /* ignore */ }
  };
  const { theme, setTheme, isDark } = useTheme();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchResults = useMemo(
    () => user ? searchUserScans(searchQuery, scans).slice(0, 8) : [],
    [searchQuery, scans, user],
  );

  const chooseSearchResult = (result: GlobalSearchResult) => {
    navigate(result.href);
    setSearchOpen(false);
    setSearchQuery("");
    setActiveSearchIndex(0);
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setNotifOpen(false);
        setUserMenuOpen(false);
        setSearchOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    function handleSearchShortcut(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isEditable = target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "");
      if ((e.key === "/" && !isEditable) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) {
        e.preventDefault();
        setSearchOpen(true);
        searchInputRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleSearchShortcut);
    return () => document.removeEventListener("keydown", handleSearchShortcut);
  }, []);

  const navItems = [
    { path: "/", label: "Overview", icon: LayoutDashboard },
    { path: "/assets", label: "Assets", icon: Database },
    { path: "/attack-graph", label: "Attack Graph", icon: Network },
    { path: "/exposure-map", label: "Exposure Map", icon: Globe },
    { path: "/ai-risk", label: "Findings Analysis", icon: AlertTriangle },
    { path: "/monitoring", label: "Monitoring", icon: Activity },
    { path: "/reports", label: "Reports", icon: FileText },
    { path: "/settings", label: "Settings", icon: SettingsIcon },
  ];

  function SidebarContent() {
    return (
      <>
        <div className="p-6 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0">
              <img src="/logo-icon.jpg" alt="Vigil" className="w-full h-full object-cover" />
            </div>
            <span className="text-xl font-semibold">Vigil</span>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/"}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                  isActive
                    ? "bg-[color:var(--accent-muted)] border border-[color:var(--accent-border)] text-[color:var(--accent-text)]"
                    : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
                }`
              }
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-white/5">
          <button className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-all">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex-shrink-0" />
            <div className="flex-1 text-left text-sm min-w-0">
              <div className="font-medium text-gray-200 truncate">
                {user?.displayName || user?.email?.split("@")[0] || "Workspace"}
              </div>
              <div className="text-xs text-gray-500">
                {user?.role || "Member"}
              </div>
            </div>
            <ChevronDown className="w-4 h-4 flex-shrink-0" />
          </button>
        </div>
      </>
    );
  }

  return (
    <div className={`flex h-screen ${isDark ? "bg-[#0a0a0f] text-gray-100" : "bg-slate-100 text-slate-900"} overflow-hidden`}>
      {/* Desktop Sidebar */}
      <aside className={`hidden md:flex w-64 ${isDark ? "bg-black/40" : "bg-white/80"} backdrop-blur-xl border-r ${isDark ? "border-white/5" : "border-slate-200"} flex-col flex-shrink-0`}>
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Mobile Sidebar Drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 ${isDark ? "bg-[#0d0d18]" : "bg-white"} border-r ${isDark ? "border-white/10" : "border-slate-200"} flex flex-col transform transition-transform duration-300 md:hidden ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="absolute top-4 right-4">
          <button
            onClick={() => setSidebarOpen(false)}
            className="p-1 rounded-lg hover:bg-white/10 text-gray-400"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <SidebarContent />
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Header */}
        <header className={`relative z-20 h-16 ${isDark ? "bg-black/40" : "bg-white/80"} backdrop-blur-xl border-b ${isDark ? "border-white/5" : "border-slate-200"} flex items-center justify-between px-4 md:px-6 flex-shrink-0`}>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* Mobile hamburger */}
            <button
              className="md:hidden p-2 rounded-lg hover:bg-white/5 text-gray-400 transition-all flex-shrink-0"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Mobile logo (shown only when sidebar is hidden) */}
            <div className="md:hidden flex items-center gap-2 flex-shrink-0">
              <div className="w-7 h-7 rounded-md overflow-hidden">
                <img src="/logo-icon.jpg" alt="Vigil" className="w-full h-full object-cover" />
              </div>
              <span className="text-sm font-semibold">Vigil</span>
            </div>

            {/* Search */}
            <div className="flex-1 max-w-2xl min-w-0" ref={searchRef}>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  placeholder="Search scans, assets, findings…"
                  aria-label="Search your scans, assets, and findings"
                  aria-keyshortcuts="Control+K Meta+K /"
                  aria-haspopup="listbox"
                  aria-expanded={searchOpen}
                  aria-controls="global-search-results"
                  aria-activedescendant={searchOpen && searchResults[activeSearchIndex] ? `search-result-${activeSearchIndex}` : undefined}
                  onFocus={() => setSearchOpen(true)}
                  onChange={event => {
                    setSearchQuery(event.target.value);
                    setActiveSearchIndex(0);
                    setSearchOpen(true);
                  }}
                  onKeyDown={event => {
                    if (event.key === "ArrowDown" && searchResults.length) {
                      event.preventDefault();
                      setActiveSearchIndex(index => (index + 1) % searchResults.length);
                    } else if (event.key === "ArrowUp" && searchResults.length) {
                      event.preventDefault();
                      setActiveSearchIndex(index => (index - 1 + searchResults.length) % searchResults.length);
                    } else if (event.key === "Enter" && searchOpen && searchResults[activeSearchIndex]) {
                      event.preventDefault();
                      chooseSearchResult(searchResults[activeSearchIndex]);
                    } else if (event.key === "Escape") {
                      setSearchOpen(false);
                    }
                  }}
                  className={`w-full ${isDark ? "bg-white/5 border-white/10" : "bg-slate-100 border-slate-200"} border rounded-lg pl-10 pr-4 py-2 text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[color:var(--accent-muted)]`}
                />
                {searchOpen && (
                  <div
                    id="global-search-results"
                    role="listbox"
                    aria-label="Search results"
                    className={`absolute left-0 top-full mt-2 w-[min(90vw,36rem)] max-h-96 overflow-y-auto rounded-xl border shadow-2xl z-50 ${
                      isDark ? "bg-[#0d0d18] border-white/10" : "bg-white border-slate-200"
                    }`}
                  >
                    {!searchQuery.trim() ? (
                      <p className="px-4 py-3 text-sm text-gray-500">Search your scans, discovered assets, and findings. Press / or Ctrl+K to focus.</p>
                    ) : !firestoreOk ? (
                      <p className="px-4 py-3 text-sm text-amber-400" role="status">Search unavailable because scan data could not be loaded.</p>
                    ) : searchResults.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-gray-500" role="status">No matching scans, assets, or findings.</p>
                    ) : (
                      searchResults.map((result, index) => (
                        <button
                          key={result.id}
                          id={`search-result-${index}`}
                          type="button"
                          role="option"
                          aria-selected={index === activeSearchIndex}
                          onMouseEnter={() => setActiveSearchIndex(index)}
                          onClick={() => chooseSearchResult(result)}
                          className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
                            index === activeSearchIndex ? "bg-[color:var(--accent-muted)]" : "hover:bg-white/5"
                          }`}
                        >
                          <span className="mt-0.5 text-[color:var(--accent-text)]" aria-hidden="true">
                            {result.kind === "scan" ? <Activity className="w-4 h-4" /> : result.kind === "asset" ? <Database className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{result.title}</span>
                            <span className="block truncate text-xs text-gray-500">{result.description}</span>
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-3 ml-3 flex-shrink-0">
            {/* Theme toggle */}
            <button
              onClick={() => setTheme(isDark ? "light" : "dark")}
              className="p-2 hover:bg-white/5 rounded-lg transition-all text-gray-400 hover:text-gray-200"
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>

            {/* Notification Bell */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => { setNotifOpen((prev) => !prev); setUserMenuOpen(false); }}
                className="relative p-2 hover:bg-white/5 rounded-lg transition-all"
                aria-label="Open notifications"
                aria-expanded={notifOpen}
              >
                <Bell className="w-5 h-5 text-gray-400" />
                {unreadAlertCount > 0 && (
                  <span
                    style={{ backgroundColor: "var(--accent-primary)" }}
                    className="absolute top-1 right-1 min-w-[16px] h-4 rounded-full text-[9px] font-bold text-black flex items-center justify-center px-0.5"
                  >
                    {unreadAlertCount > 9 ? "9+" : unreadAlertCount}
                  </span>
                )}
              </button>

              {/* Notification Dropdown */}
              {notifOpen && (
                <div className={`absolute right-0 mt-2 w-80 sm:w-96 rounded-xl ${isDark ? "bg-[#0d0d18]" : "bg-white"} border ${isDark ? "border-white/10" : "border-slate-200"} shadow-2xl z-50 overflow-hidden`}>
                  <div className={`flex items-center justify-between px-4 py-3 border-b ${isDark ? "border-white/5" : "border-slate-100"}`}>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm">Notifications</h3>
                      {unreadAlertCount > 0 && (
                        <span style={{ color: "var(--accent-text)", backgroundColor: "var(--accent-muted)" }} className="px-1.5 py-0.5 rounded-full text-xs font-medium">
                          {unreadAlertCount} new
                        </span>
                      )}
                    </div>
                    {unreadAlertCount > 0 && (
                      <button
                        onClick={markAllAlertsRead}
                        style={{ color: "var(--accent-text)" }}
                        className="text-xs hover:opacity-80 transition-opacity"
                      >
                        Mark all read
                      </button>
                    )}
                  </div>

                  <div className={`max-h-96 overflow-y-auto divide-y ${isDark ? "divide-white/5" : "divide-slate-100"}`}>
                    {alerts.length === 0 ? (
                      <div className="px-4 py-8 text-center text-gray-500 text-sm">
                        {firestoreError ? "Notifications unavailable — check Firestore access and try again." : "No notifications yet"}
                      </div>
                    ) : (
                      alerts.map((alert) => (
                        <div
                          key={alert.id}
                          onClick={() => markAlertRead(alert.id)}
                          className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors ${
                            alert.effectivelyRead ? "hover:bg-white/5" : "bg-[color:var(--accent-muted)] hover:opacity-90"
                          }`}
                        >
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${alertColors(alert.type)}`}>
                            <AlertIcon type={alert.type} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-medium leading-tight">{alert.title}</p>
                              {!alert.effectivelyRead && (
                                <div style={{ backgroundColor: "var(--accent-primary)" }} className="w-2 h-2 rounded-full flex-shrink-0 mt-1" />
                              )}
                            </div>
                            <p className="text-xs text-gray-400 truncate mt-0.5">{alert.asset}</p>
                            <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {alertAge(alert)}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className={`px-4 py-3 border-t ${isDark ? "border-white/5" : "border-slate-100"}`}>
                    <button
                      onClick={() => { setNotifOpen(false); navigate("/monitoring"); }}
                      style={{ color: "var(--accent-text)" }}
                      className="w-full text-center text-xs hover:opacity-80 transition-opacity"
                    >
                      View all activity in Monitoring →
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* User */}
            {user ? (
              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={() => { setUserMenuOpen(prev => !prev); setNotifOpen(false); }}
                  aria-label="Open account menu"
                  aria-expanded={userMenuOpen}
                  className={`flex items-center gap-2 rounded-lg border ${isDark ? "border-white/10 bg-white/5 hover:bg-white/10" : "border-slate-200 bg-white hover:bg-slate-50"} px-2 py-1.5 transition-all`}
                >
                  <div
                    style={{ backgroundColor: "var(--accent-primary)" }}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-black flex-shrink-0"
                  >
                    {user.email?.charAt(0).toUpperCase() ?? "U"}
                  </div>
                  <div className="text-left hidden sm:block">
                    <div className="text-xs font-medium truncate max-w-[120px]">{user.email}</div>
                    <div className="text-[10px] text-gray-400">{user.role}</div>
                  </div>
                  <ChevronDown className={`w-3.5 h-3.5 text-gray-400 flex-shrink-0 transition-transform duration-200 ${userMenuOpen ? "rotate-180" : ""}`} />
                </button>

                {userMenuOpen && (
                  <div className={`absolute right-0 mt-2 w-52 rounded-xl ${isDark ? "bg-[#0d0d18]" : "bg-white"} border ${isDark ? "border-white/10" : "border-slate-200"} shadow-2xl z-50 overflow-hidden`}>
                    <div className={`px-4 py-3 border-b ${isDark ? "border-white/5" : "border-slate-100"}`}>
                      <p className="text-xs font-semibold truncate">{user.email}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{user.role || "Member"}</p>
                    </div>
                    <div className="py-1">
                      <Link
                        to="/settings"
                        onClick={() => setUserMenuOpen(false)}
                        className={`flex items-center gap-3 px-4 py-2.5 text-sm ${isDark ? "hover:bg-white/5 text-gray-300" : "hover:bg-slate-50 text-slate-700"} transition-colors`}
                      >
                        <User className="w-4 h-4" />
                        Profile & Settings
                      </Link>
                      <button
                        onClick={() => { setUserMenuOpen(false); logout(); }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 ${isDark ? "hover:bg-red-500/10" : "hover:bg-red-50"} transition-colors`}
                      >
                        <LogOut className="w-4 h-4" />
                        Sign out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => navigate("/login")}
                style={{ backgroundColor: "var(--accent-muted)", borderColor: "var(--accent-border)", color: "var(--accent-text)" }}
                className="rounded-lg border px-3 py-1.5 text-sm font-medium transition hover:opacity-90"
              >
                Sign in
              </button>
            )}
          </div>
        </header>

        {/* Email verification banner */}
        {user && !emailVerified && (
          <div className="relative z-10 flex items-center justify-between gap-3 bg-amber-500/10 border-b border-amber-500/30 px-4 py-2.5 text-sm flex-wrap">
            <div className="flex items-center gap-2 text-amber-300">
              <MailCheck className="w-4 h-4 flex-shrink-0" />
              <span>Check your inbox — verify your email before starting scans, exporting reports, or changing account and team settings.</span>
            </div>
            <button
              onClick={handleResendVerification}
              disabled={verifySent}
              className="text-xs font-medium text-amber-400 hover:text-amber-200 underline underline-offset-2 disabled:opacity-50 flex-shrink-0"
            >
              {verifySent ? "Email sent ✓" : "Resend email"}
            </button>
            <button
              onClick={() => { void ensureEmailVerified(); }}
              className="text-xs font-medium text-amber-400 hover:text-amber-200 underline underline-offset-2 flex-shrink-0"
            >
              I verified — refresh
            </button>
          </div>
        )}

        {/* Page Content */}
        <main className={`flex-1 overflow-auto ${isDark ? "bg-gradient-to-br from-[#0a0a0f] via-[#0f0f1a] to-[#0a0a0f]" : "bg-gradient-to-br from-slate-100 via-slate-50 to-slate-100"}`}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
