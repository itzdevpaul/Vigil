import { useState, useEffect } from "react";
import {
  User, Bell, Shield, Key, Zap, Palette, Users,
  Save, X, Check, UserPlus, Clock,
} from "lucide-react";
import { onSnapshot } from "firebase/firestore";
import { useAuth } from "../components/AuthProvider";
import { useTheme, ACCENT_CONFIGS, type AccentColor } from "../contexts/ThemeContext";
import {
  saveIntegration, deleteIntegration, getIntegrations, sendTeamInvite, getMyInvitesSentQuery,
  updateInviteStatus, type Integration, type TeamInvite,
} from "../../firebase";
import { toast } from "sonner";

type Section = "account" | "notifications" | "security" | "api-keys" | "integrations" | "appearance" | "team";

const NAV: { id: Section; label: string; icon: typeof User }[] = [
  { id: "account",       label: "Account",       icon: User },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "security",      label: "Security",      icon: Shield },
  { id: "api-keys",      label: "API Keys",      icon: Key },
  { id: "integrations",  label: "Integrations",  icon: Zap },
  { id: "appearance",    label: "Appearance",    icon: Palette },
  { id: "team",          label: "Team",          icon: Users },
];

const INTEGRATIONS = [
  { name: "Slack", type: "slack", desc: "Credential record only; delivery is not verified here", icon: "💬", field: "webhookUrl", placeholder: "https://hooks.slack.com/services/..." },
  { name: "PagerDuty", type: "pagerduty", desc: "Credential record only; connection is not verified here", icon: "🔔", field: "apiKey", placeholder: "pdp_..." },
  { name: "Jira", type: "jira", desc: "Credential record only; connection is not verified here", icon: "📋", field: "apiKey", placeholder: "ATL..." },
  { name: "AWS Security Hub", type: "aws", desc: "Credential record only; connection is not verified here", icon: "☁️", field: "apiKey", placeholder: "AKIA..." },
  { name: "Shodan", type: "shodan", desc: "Credential record only; connection is not verified here", icon: "🔍", field: "apiKey", placeholder: "Your Shodan API key" },
  { name: "VirusTotal", type: "virustotal", desc: "Credential record only; connection is not verified here", icon: "🦠", field: "apiKey", placeholder: "Your VirusTotal API key" },
];

export function Settings() {
  const {
    user, emailVerified, ensureEmailVerified, updateAccountProfile, changePassword,
    notificationSettings, updateNotificationSettings, isAdmin,
  } = useAuth();
  const { theme, setTheme, accentColor, setAccentColor, isDark } = useTheme();
  const [active, setActive] = useState<Section>("account");
  const [nameVal, setNameVal] = useState(user?.displayName || "");
  const [saving, setSaving] = useState(false);
  const [connectModal, setConnectModal] = useState<typeof INTEGRATIONS[0] | null>(null);
  const [connectValue, setConnectValue] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [savedIntegrations, setSavedIntegrations] = useState<Map<string, Integration>>(new Map());
  const [integrationLoadError, setIntegrationLoadError] = useState("");
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", confirm: "" });
  const [passwordSaving, setPasswordSaving] = useState(false);

  // ── Team state ─────────────────────────────────────────────────────────────
  const [invites, setInvites] = useState<(TeamInvite & { id: string })[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("Viewer");
  const [inviting, setInviting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = onSnapshot(getMyInvitesSentQuery(user.uid), (snap) => {
      setInvites(snap.docs.map(d => ({ id: d.id, ...d.data() } as TeamInvite & { id: string })));
    }, () => {});
    return unsub;
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    let active = true;
    setIntegrationLoadError("");
    void getIntegrations(user.uid).then((items) => {
      if (active) setSavedIntegrations(new Map(items.map((item) => [item.type, item])));
    }).catch((error) => {
      if (!active) return;
      setSavedIntegrations(new Map());
      setIntegrationLoadError(error?.message || "Unable to load saved integration configuration.");
    });
    return () => { active = false; };
  }, [user?.uid]);

  useEffect(() => {
    setNameVal(user?.displayName || "");
  }, [user?.displayName]);

  const handleSendInvite = async () => {
    if (!(await ensureEmailVerified())) return;
    if (!inviteEmail.trim()) { toast.error("Enter an email address."); return; }
    if (!user) return;
    setInviting(true);
    try {
      await sendTeamInvite(
        user.uid,
        user.displayName || user.email || "Team Owner",
        user.email || "",
        inviteEmail.trim(),
        inviteRole,
      );
      const invitedAddress = inviteEmail.trim();
      setInviteEmail("");
      toast.success(`In-app invite record created for ${invitedAddress}`, {
        description: "The record was saved in Vigil. No email notification was sent.",
      });
    } catch (err: any) {
      toast.error("Failed to create invite record: " + (err?.message || "Unknown error"));
    } finally {
      setInviting(false);
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    if (!(await ensureEmailVerified())) return;
    setRevokingId(inviteId);
    try {
      await updateInviteStatus(inviteId, "declined");
      toast.success("Invite revoked");
    } catch {
      toast.error("Failed to revoke invite");
    } finally {
      setRevokingId(null);
    }
  };

  const handleSaveProfile = async () => {
    if (!(await ensureEmailVerified())) return;
    if (!user) { toast.error("You must be signed in."); return; }
    if (!nameVal.trim()) { toast.error("Display name cannot be empty."); return; }
    setSaving(true);
    try {
      await updateAccountProfile(nameVal);
      toast.success("Account profile saved.");
    } catch (err: any) {
      toast.error("Failed to save account profile: " + (err?.message || "Unknown error"));
    } finally {
      setSaving(false);
    }
  };

  const handleNotificationToggle = async (key: keyof typeof notificationSettings, value: boolean) => {
    if (!(await ensureEmailVerified())) return;
    try {
      await updateNotificationSettings({ ...notificationSettings, [key]: value });
    } catch (err: any) {
      toast.error("Failed to save notification preference: " + (err?.message || "Unknown error"));
    }
  };

  const handlePasswordChange = async () => {
    if (!(await ensureEmailVerified())) return;
    if (!passwordForm.current) { toast.error("Enter your current password."); return; }
    if (passwordForm.next.length < 6) { toast.error("New password must be at least 6 characters."); return; }
    if (passwordForm.next !== passwordForm.confirm) { toast.error("New password and confirmation do not match."); return; }
    setPasswordSaving(true);
    try {
      await changePassword(passwordForm.current, passwordForm.next);
      setPasswordForm({ current: "", next: "", confirm: "" });
      toast.success("Password changed successfully.");
    } catch (err: any) {
      const code = err?.code;
      const message = code === "auth/wrong-password" || code === "auth/invalid-credential"
        ? "Current password is incorrect."
        : code === "auth/weak-password"
          ? "New password must be at least 6 characters."
          : code === "auth/requires-recent-login"
            ? "Please sign out and sign in again before changing your password."
            : err?.message || "Unknown error";
      toast.error("Failed to change password: " + message);
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleConnect = async () => {
    if (!(await ensureEmailVerified())) return;
    if (!connectModal || !connectValue.trim()) {
      toast.error("Please enter a value.");
      return;
    }
    if (!user) { toast.error("You must be signed in."); return; }
    setConnecting(true);
    try {
      const saved = await saveIntegration(user.uid, connectModal.name, connectModal.type, connectValue);
      setSavedIntegrations((prev) => new Map(prev).set(saved.type, saved));
      toast.success(`${connectModal.name} credential stored securely`);
      setConnectModal(null);
      setConnectValue("");
    } catch (err: any) {
      toast.error("Failed to save integration configuration: " + (err?.message || "Unknown error"));
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (integrationType: string, integrationName: string) => {
    if (!(await ensureEmailVerified())) return;
    if (!user) { toast.error("You must be signed in."); return; }
    try {
      await deleteIntegration(user.uid, integrationType);
      setSavedIntegrations((prev) => {
        const next = new Map(prev);
        next.delete(integrationType);
        return next;
      });
      toast.success(`${integrationName} configuration removed.`);
    } catch (err: any) {
      toast.error("Failed to remove integration configuration: " + (err?.message || "Unknown error"));
    }
  };

  const accentStyle = {
    muted: { backgroundColor: "var(--accent-muted)" },
    border: { borderColor: "var(--accent-border)" },
    text: { color: "var(--accent-text)" },
  };

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">Settings</h1>
        <p className="text-gray-400">Manage your account and platform preferences</p>
      </div>

      <div className="flex flex-col md:flex-row gap-4 md:gap-6">
        {/* Sidebar nav */}
        <div className="md:w-52 lg:w-60 flex-shrink-0">
          <nav className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-2 flex flex-row md:flex-col gap-1 overflow-x-auto md:overflow-visible">
            {NAV.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActive(id)}
                style={active === id ? { ...accentStyle.muted, ...accentStyle.border, ...accentStyle.text } : {}}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm whitespace-nowrap w-auto md:w-full border ${
                  active === id ? "border" : "border-transparent text-gray-400 hover:text-gray-200 hover:bg-white/5"
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content panels */}
        <div className="flex-1 min-w-0">

          {/* ── Account ── */}
          {active === "account" && (
            <div className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-5 md:p-6 space-y-6">
              <h2 className="text-lg font-semibold">Account Information</h2>
              <div className="flex items-center gap-4">
                <div style={{ background: "linear-gradient(135deg, var(--accent-primary), #818cf8)" }} className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0 text-black">
                  {(user?.displayName || user?.email || "U")[0].toUpperCase()}
                </div>
                <div>
                  <div className="font-semibold">{user?.displayName || "No name set"}</div>
                  <div className="text-sm text-gray-400">{user?.email}</div>
                  {isAdmin && (
                    <span style={accentStyle.muted} className="text-xs px-2 py-0.5 rounded-full text-purple-400 border border-purple-500/30 mt-1 inline-block">
                      Admin
                    </span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5 text-gray-300">Display Name</label>
                  <input type="text" value={nameVal} onChange={(e) => setNameVal(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--accent-muted)]" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5 text-gray-300">Email</label>
                  <input type="email" value={user?.email || ""} readOnly className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm opacity-60 cursor-not-allowed" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5 text-gray-300">Role</label>
                  <input type="text" value={isAdmin ? "Admin" : "Member"} readOnly className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm opacity-60 cursor-not-allowed" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5 text-gray-300">Workspace</label>
                  <input type="text" value="Default Workspace" readOnly className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm opacity-60 cursor-not-allowed" />
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <button onClick={handleSaveProfile} disabled={saving || !emailVerified} title={!emailVerified ? "Verify your email before changing account settings" : undefined} style={{ ...accentStyle.muted, ...accentStyle.border, ...accentStyle.text }} className="flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all disabled:opacity-60 hover:opacity-90">
                  {saving ? <div style={{ borderTopColor: "var(--accent-primary)" }} className="w-4 h-4 border-2 border-gray-600 rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                  {saving ? "Saving..." : "Save Changes"}
                </button>
                <button onClick={() => { setNameVal(user?.displayName || ""); toast.info("Changes discarded"); }} className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-gray-300 transition-all">
                  <X className="w-4 h-4" /> Cancel
                </button>
              </div>
            </div>
          )}

          {/* ── Notifications ── */}
          {active === "notifications" && (
            <div className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-5 md:p-6 space-y-6">
              <h2 className="text-lg font-semibold">Notification Preferences</h2>
              <div className="space-y-3">
                {[
                  { key: "criticalRiskAlerts" as const, label: "Critical Risk Alerts", desc: "Preference saved; delivery automation is not configured" },
                  { key: "newAssets" as const, label: "New Asset Discovery", desc: "Notify when new assets are discovered" },
                  { key: "weeklyDigest" as const, label: "Weekly Digest", desc: "Preference saved; scheduled email delivery is not configured" },
                ].map(({ key, label, desc }) => {
                  const on = notificationSettings?.[key] ?? false;
                  return (
                    <div key={key} className="flex items-center justify-between gap-4 p-4 rounded-lg bg-black/40 border border-white/10">
                      <div className="min-w-0">
                        <div className="font-medium text-sm mb-0.5">{label}</div>
                        <div className="text-xs text-gray-500">{desc}</div>
                      </div>
                      <button
                        onClick={() => { void handleNotificationToggle(key, !on); }}
                        disabled={!emailVerified}
                        title={!emailVerified ? "Verify your email before changing account settings" : undefined}
                        style={on ? { backgroundColor: "var(--accent-primary)" } : {}}
                        className={`w-11 h-6 rounded-full transition-colors flex-shrink-0 relative disabled:opacity-50 ${!on ? "bg-white/20" : ""}`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0"}`} />
                      </button>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-gray-500">Preferences are stored in your account. Alert and digest delivery automation is not configured.</p>
            </div>
          )}

          {/* ── Security ── */}
          {active === "security" && (
            <div className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-5 md:p-6 space-y-4">
              <h2 className="text-lg font-semibold">Security Settings</h2>
              <div className="p-4 rounded-lg bg-black/40 border border-white/10 space-y-3">
                <h3 className="font-medium text-sm">Change Password</h3>
                <p className="text-sm text-gray-400">Re-enter your current password to confirm this change. Email/password accounts only.</p>
                <input type="password" autoComplete="current-password" required value={passwordForm.current} onChange={(event) => setPasswordForm((form) => ({ ...form, current: event.target.value }))} placeholder="Current password" className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[color:var(--accent-muted)] text-gray-100" />
                <input type="password" autoComplete="new-password" minLength={6} required value={passwordForm.next} onChange={(event) => setPasswordForm((form) => ({ ...form, next: event.target.value }))} placeholder="New password (at least 6 characters)" className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[color:var(--accent-muted)] text-gray-100" />
                <input type="password" autoComplete="new-password" minLength={6} required value={passwordForm.confirm} onChange={(event) => setPasswordForm((form) => ({ ...form, confirm: event.target.value }))} placeholder="Confirm new password" className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[color:var(--accent-muted)] text-gray-100" />
                <button onClick={handlePasswordChange} disabled={passwordSaving || !emailVerified} title={!emailVerified ? "Verify your email before changing account settings" : undefined} style={{ ...accentStyle.muted, ...accentStyle.border, ...accentStyle.text }} className="px-4 py-2 rounded-lg border text-sm font-medium transition-all hover:opacity-90 disabled:opacity-60">
                  {passwordSaving ? "Updating…" : "Update Password"}
                </button>
              </div>
              <div className="p-4 rounded-lg bg-black/40 border border-white/10">
                <h3 className="font-medium text-sm mb-1">Two-Factor Authentication</h3>
                <p className="text-sm text-gray-400">Two-factor authentication is not configured or available for this account in Vigil.</p>
              </div>
              <div className="p-4 rounded-lg bg-black/40 border border-white/10">
                <h3 className="font-medium text-sm mb-1">Active Sessions</h3>
                <p className="text-sm text-gray-500">Current session: This browser</p>
              </div>
            </div>
          )}

          {/* ── API Keys ── */}
          {active === "api-keys" && (
            <div className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-5 md:p-6 space-y-4">
              <h2 className="text-lg font-semibold">API Keys</h2>
              <div role="status" className="p-4 rounded-lg bg-black/40 border border-white/10">
                <p className="font-medium text-sm mb-1">Not available</p>
                <p className="text-sm text-gray-400">Vigil does not currently provide a local application API-key service. No API key has been generated for this account.</p>
              </div>
            </div>
          )}

          {/* ── Integrations ── */}
          {active === "integrations" && (
            <div className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-5 md:p-6 space-y-4">
              <h2 className="text-lg font-semibold">Integrations</h2>
              <p className="text-sm text-gray-400">Credentials are encrypted and stored for future integration support. Saving does not connect to or verify an external service, and saved credentials are never returned to this screen.</p>
              {integrationLoadError && <p role="alert" className="text-sm text-red-400">{integrationLoadError}</p>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {INTEGRATIONS.map((intg) => {
                  const saved = savedIntegrations.get(intg.type);
                  const configured = Boolean(saved?.configured);
                  return (
                    <div key={intg.type} className={`p-4 rounded-lg border transition-all ${configured ? "bg-green-500/5 border-green-500/20" : "bg-black/40 border-white/10"}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center text-lg flex-shrink-0">{intg.icon}</div>
                          <div className="min-w-0">
                            <div className="font-medium text-sm">{intg.name}</div>
                            <div className="text-xs text-gray-500 truncate">{intg.desc}</div>
                          </div>
                        </div>
                        {configured ? (
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <div className="flex items-center gap-1 px-2 py-1 rounded bg-green-500/20 text-green-400 text-xs">
                              <Check className="w-3 h-3" /> •••• {saved?.lastFour}
                            </div>
                            <button
                              onClick={() => { void handleDisconnect(intg.type, intg.name); }}
                              disabled={!emailVerified}
                              title={!emailVerified ? "Verify your email before changing integrations" : `Remove the saved ${intg.name} configuration`}
                              className="px-2 py-1 rounded border border-red-500/30 bg-red-500/10 text-red-400 text-xs hover:bg-red-500/20 disabled:opacity-50"
                            >
                              Remove Configuration
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setConnectModal(intg); setConnectValue(""); }}
                            disabled={!emailVerified}
                            title={!emailVerified ? "Verify your email before changing integrations" : undefined}
                            style={{ ...accentStyle.muted, ...accentStyle.border, ...accentStyle.text }}
                            className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-all flex-shrink-0 hover:opacity-90 disabled:opacity-50"
                          >
                            Save Configuration
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Appearance ── */}
          {active === "appearance" && (
            <div className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-5 md:p-6 space-y-6">
              <h2 className="text-lg font-semibold">Appearance</h2>

              {/* Theme */}
              <div>
                <h3 className="text-sm font-medium text-gray-300 mb-3">Theme</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(["dark", "light"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTheme(t)}
                      style={theme === t ? { ...accentStyle.muted, ...accentStyle.border } : {}}
                      className={`p-4 rounded-lg border text-left transition-all ${theme === t ? "border" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
                    >
                      <div className={`w-full h-14 rounded-lg mb-3 flex items-center justify-center border ${t === "dark" ? "bg-black/60 border-white/10" : "bg-white border-gray-200"}`}>
                        <div style={theme === t ? { backgroundColor: "var(--accent-primary)" } : {}} className={`w-6 h-6 rounded-full ${theme !== t ? (t === "dark" ? "bg-gray-600" : "bg-gray-300") : ""}`} />
                      </div>
                      <div style={theme === t ? accentStyle.text : {}} className="font-medium text-sm capitalize">{t} Mode</div>
                      <div className="text-xs text-gray-500 mt-0.5">{theme === t ? "Currently active" : "Click to switch"}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Accent Color */}
              <div>
                <h3 className="text-sm font-medium text-gray-300 mb-3">Accent Color</h3>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                  {(Object.entries(ACCENT_CONFIGS) as [AccentColor, typeof ACCENT_CONFIGS[AccentColor]][]).map(([key, cfg]) => (
                    <button
                      key={key}
                      onClick={() => setAccentColor(key)}
                      className="flex flex-col items-center gap-2 p-2 rounded-lg hover:bg-white/5 transition-all"
                      title={cfg.label}
                    >
                      <div
                        style={{ backgroundColor: cfg.primary }}
                        className={`w-10 h-10 rounded-full transition-transform hover:scale-110 ${accentColor === key ? "ring-2 ring-white/60 ring-offset-2 ring-offset-transparent scale-110" : ""}`}
                      />
                      <span className="text-xs text-gray-400">{cfg.label}</span>
                      {accentColor === key && (
                        <Check className="w-3 h-3 text-green-400" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview */}
              <div className="p-4 rounded-lg bg-black/40 border border-white/10">
                <h3 className="text-sm font-medium text-gray-300 mb-3">Preview</h3>
                <div className="flex flex-wrap gap-2">
                  <button style={{ ...accentStyle.muted, ...accentStyle.border, ...accentStyle.text }} className="px-3 py-1.5 rounded-lg border text-sm font-medium">Primary Button</button>
                  <div style={{ backgroundColor: "var(--accent-primary)" }} className="w-6 h-6 rounded-full self-center" />
                  <span style={accentStyle.text} className="text-sm self-center">Accent text</span>
                  <div style={accentStyle.muted} className="px-2 py-1 rounded text-xs self-center">Badge</div>
                </div>
              </div>
            </div>
          )}

          {/* ── Team ── */}
          {active === "team" && (
            <div className="rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 p-5 md:p-6 space-y-6">
              <div>
                <h2 className="text-lg font-semibold">Team Management</h2>
                <p className="text-sm text-gray-400 mt-1">Create in-app invite records for teammates to collaborate on scans and findings. Vigil does not send an invite email.</p>
              </div>

              {/* Invite form */}
              <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-4">
                <h3 className="text-sm font-semibold flex items-center gap-2 text-gray-200">
                  <UserPlus className="w-4 h-4 text-cyan-400" />
                  Create an In-App Invite
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium mb-1.5 text-gray-400">Email Address</label>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleSendInvite()}
                      placeholder="teammate@company.com"
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--accent-muted)] text-gray-100 placeholder:text-gray-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5 text-gray-400">Role</label>
                    <select
                      value={inviteRole}
                      onChange={e => setInviteRole(e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--accent-muted)] text-gray-100"
                    >
                      <option value="Viewer">Viewer</option>
                      <option value="Analyst">Analyst</option>
                      <option value="Administrator">Administrator</option>
                    </select>
                  </div>
                </div>
                <button
                  onClick={handleSendInvite}
                  disabled={inviting || !inviteEmail.trim() || !emailVerified}
                  title={!emailVerified ? "Verify your email before inviting teammates" : undefined}
                  style={{ ...accentStyle.muted, ...accentStyle.border, ...accentStyle.text }}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all disabled:opacity-60 hover:opacity-90"
                >
                  {inviting
                    ? <div style={{ borderTopColor: "var(--accent-primary)" }} className="w-4 h-4 border-2 border-gray-600 rounded-full animate-spin" />
                    : <UserPlus className="w-4 h-4" />}
                  {inviting ? "Creating…" : "Create Invite Record"}
                </button>
              </div>

              {/* Invite list */}
              <div>
                <h3 className="text-sm font-semibold text-gray-300 mb-3">In-App Invite Records</h3>
                {invites.length === 0 ? (
                  <div className="rounded-xl border border-white/10 p-8 text-center">
                    <Users className="w-8 h-8 text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-500 text-sm">No invite records yet</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {invites.map(inv => (
                      <div key={inv.id} className="flex items-center justify-between gap-3 rounded-lg bg-black/20 border border-white/10 px-4 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 text-sm font-semibold text-gray-300">
                            {inv.invitedEmail[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{inv.invitedEmail}</div>
                            <div className="text-xs text-gray-500">{inv.role}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            inv.status === "accepted"  ? "bg-green-500/20 text-green-400" :
                            inv.status === "declined"  ? "bg-red-500/20 text-red-400" :
                            "bg-yellow-500/20 text-yellow-400"
                          }`}>
                            {inv.status === "pending"
                              ? <span className="flex items-center gap-1"><Clock className="w-3 h-3 inline" /> Pending</span>
                              : inv.status}
                          </span>
                          {inv.status === "pending" && (
                            <button
                              onClick={() => handleRevokeInvite(inv.id)}
                              disabled={revokingId === inv.id || !emailVerified}
                              title={!emailVerified ? "Verify your email before changing team invites" : "Revoke invite"}
                              className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 transition-all disabled:opacity-50"
                            >
                              {revokingId === inv.id
                                ? <div className="w-3 h-3 border border-red-400 border-t-transparent rounded-full animate-spin" />
                                : <X className="w-3 h-3" />}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Integration Connect Modal */}
      {connectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-xl bg-[#0d0d18] border border-white/10 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{connectModal.icon}</span>
                <h3 className="text-lg font-semibold">Save {connectModal.name} Configuration</h3>
              </div>
              <button onClick={() => { setConnectModal(null); setConnectValue(""); }} className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400" aria-label="Close integration dialog">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5 text-gray-300">
                  {connectModal.field === "webhookUrl" ? "Webhook URL" : "API Key"} <span className="text-red-400">*</span>
                </label>
                <input
                  type={connectModal.field === "webhookUrl" ? "url" : "password"}
                  autoComplete="off"
                  placeholder={connectModal.placeholder}
                  value={connectValue}
                  onChange={(e) => setConnectValue(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[color:var(--accent-muted)] text-gray-100"
                />
                <p className="text-xs text-gray-500 mt-1.5">
                  The value is encrypted on the server. Saving it only stores a credential record; Vigil does not currently connect to or use it.
                </p>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => { setConnectModal(null); setConnectValue(""); }} className="flex-1 px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-medium transition-all text-gray-300">
                Cancel
              </button>
              <button
                onClick={handleConnect}
                disabled={connecting}
                style={{ ...accentStyle.muted, ...accentStyle.border, ...accentStyle.text }}
                className="flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all disabled:opacity-60 flex items-center justify-center gap-2 hover:opacity-90"
              >
                {connecting ? <div style={{ borderTopColor: "var(--accent-primary)" }} className="w-4 h-4 border-2 border-gray-600 rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
                {connecting ? "Saving..." : "Save Configuration"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
