import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithPopup,
  GoogleAuthProvider,
  GithubAuthProvider,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  updateProfile,
  reload,
  type User as FirebaseUser,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  addDoc,
  collection,
  where,
  query,
  orderBy,
  limit,
  updateDoc,
  serverTimestamp,
  getDocs,
  arrayUnion,
  deleteDoc,
  type DocumentData,
  type Timestamp,
} from "firebase/firestore";
import { isSensitiveActionAllowed } from "./auth-policy.js";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

async function assertVerifiedUser(userId?: string): Promise<FirebaseUser> {
  const currentUser = auth.currentUser;
  if (!currentUser || (userId && currentUser.uid !== userId)) {
    throw new Error("Your sign-in changed. Please sign in again and retry.");
  }
  await reload(currentUser);
  if (!isSensitiveActionAllowed(currentUser.emailVerified)) {
    throw new Error("Verify your email before making this change. Check your inbox for the verification link.");
  }
  await currentUser.getIdToken(true);
  return currentUser;
}

export type UserRole = "Administrator" | "Security Analyst" | "Viewer" | string;

export interface FirestoreUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: UserRole;
  createdAt?: DocumentData;
  updatedAt?: DocumentData;
}

export interface NotificationSettings {
  criticalRiskAlerts: boolean;
  newAssets: boolean;
  weeklyDigest: boolean;
}

export const defaultNotificationSettings: NotificationSettings = {
  criticalRiskAlerts: true,
  newAssets: true,
  weeklyDigest: false,
};

// ── Enriched Asset & Finding Types ────────────────────────────────────────────
export interface PortInfo {
  port: number;
  service: string;
  state: "open" | "filtered";
  version?: string;
  banner?: string;
}

export interface Asset {
  id: string; // local UUID (not Firestore doc id)
  scanId: string;
  name: string;
  host: string;
  ipAddress?: string;
  type: string;
  riskScore: number;
  status?: "active" | "inactive" | "unknown";
  ports?: PortInfo[];
  technologies?: string[];
  certificates?: { issuer?: string; expiry?: string; valid?: boolean };
  discoveredAt?: string; // ISO string
}

export interface Finding {
  id: string; // local UUID
  scanId: string;
  assetId: string;
  assetName?: string;
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  description?: string;
  cve?: string | null;
  cvss?: number;
  port?: number;
  service?: string;
  category?: string;
  remediation?: string;
  references?: string[];
  createdAt?: string; // ISO string
}

// ── Scan Jobs ──────────────────────────────────────────────────────────────────
export type ScanStatus = "queued" | "running" | "completed" | "partial" | "failed" | "paused" | "cancelled";
export type ScanType = "full" | "port" | "subdomain" | "cloud" | "cert" | "vulnerability" | "api";

export type ScheduleInterval = "none" | "daily" | "weekly" | "monthly";

export interface ScanJob {
  id: string;
  name: string;
  target: string;
  scanType: ScanType;
  status: ScanStatus;
  progress: number;
  findings: number;
  duration: string | null;
  phase?: string;
  assetsDiscovered?: number;
  scheduleInterval?: ScheduleInterval;
  nextRunAt?: Timestamp | null;
  createdBy: string;
  createdAt: Timestamp | null;
  startedAt: Timestamp | null;
  workerClaimedAt?: Timestamp | null;
  completedAt: Timestamp | null;
  error?: string;
  resultTools?: ("nmap" | "nuclei")[];
  controlRequest?: "pause" | "resume" | "cancel" | null;
  authorizationAcknowledged?: boolean;
  // Embedded data (stored inside scan doc to avoid separate collection rules)
  _assets?: Asset[];
  _findings?: Finding[];
}

export async function createScanJob(
  userId: string,
  data: { name: string; target: string; scanType: string; authorizationAcknowledged: boolean }
): Promise<string> {
  await assertVerifiedUser(userId);
  const ref = await addDoc(collection(db, "scans"), {
    name: data.name,
    target: data.target,
    scanType: data.scanType,
    authorizationAcknowledged: data.authorizationAcknowledged === true,
    status: "queued" as ScanStatus,
    progress: 0,
    findings: 0,
    duration: null,
    phase: "Queued",
    assetsDiscovered: 0,
    _assets: [],
    _findings: [],
    createdBy: userId,
    createdAt: serverTimestamp(),
    startedAt: null,
    completedAt: null,
  });
  return ref.id;
}

export function getScansQuery(userId = auth.currentUser?.uid || "") {
  return query(collection(db, "scans"), where("createdBy", "==", userId));
}

// ── Integrations ───────────────────────────────────────────────────────────────
export interface Integration {
  name: string;
  type: string;
  configured: boolean;
  lastFour: string;
  updatedAt: string;
}

async function integrationApiRequest<T>(path: string, method: "GET" | "POST" | "DELETE", body?: unknown): Promise<T> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("You must be signed in.");
  const token = await currentUser.getIdToken();
  const response = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof result?.error === "string" ? result.error : "Integration API request failed.");
  }
  return result as T;
}

export async function saveIntegration(
  userId: string,
  name: string,
  type: string,
  secret: string,
): Promise<Integration> {
  await assertVerifiedUser(userId);
  const result = await integrationApiRequest<{ integration: Integration }>("/api/integrations", "POST", {
    name, type, secret,
  });
  return result.integration;
}

export async function deleteIntegration(userId: string, type: string): Promise<void> {
  await assertVerifiedUser(userId);
  await integrationApiRequest(`/api/integrations/${encodeURIComponent(type)}`, "DELETE");
}

export async function getIntegrations(userId: string): Promise<Integration[]> {
  if (!auth.currentUser || auth.currentUser.uid !== userId) {
    throw new Error("Your sign-in changed. Please sign in again and retry.");
  }
  const result = await integrationApiRequest<{ integrations: Integration[] }>("/api/integrations", "GET");
  return result.integrations;
}

// ── Risk History ──────────────────────────────────────────────────────────────
export interface RiskSnapshot {
  userId: string;
  date: string; // YYYY-MM-DD
  score: number;
  scanId: string;
  target: string;
  totalFindings: number;
  criticalFindings: number;
  recordedAt: Timestamp | null;
}

export async function writeRiskSnapshot(userId: string, snap: Omit<RiskSnapshot, "userId" | "recordedAt">) {
  await assertVerifiedUser(userId);
  const ref = doc(db, "riskHistory", `${userId}_${snap.date}_${snap.scanId.slice(0, 8)}`);
  await setDoc(ref, { ...snap, userId, recordedAt: serverTimestamp() }, { merge: true });
}

export function getRiskHistoryQuery(userId: string) {
  return query(
    collection(db, "riskHistory"),
    where("userId", "==", userId),
    orderBy("date", "desc"),
    limit(30)
  );
}

// ── Team Invites ──────────────────────────────────────────────────────────────
export type InviteStatus = "pending" | "accepted" | "declined";

export interface TeamInvite {
  id?: string;
  invitedBy: string;
  inviterName: string;
  inviterEmail: string;
  invitedEmail: string;
  role: string;
  status: InviteStatus;
  createdAt: Timestamp | null;
}

export async function sendTeamInvite(
  invitedBy: string, inviterName: string, inviterEmail: string,
  invitedEmail: string, role: string
) {
  await assertVerifiedUser(invitedBy);
  await addDoc(collection(db, "invites"), {
    invitedBy, inviterName, inviterEmail,
    invitedEmail: invitedEmail.toLowerCase(),
    role, status: "pending" as InviteStatus,
    createdAt: serverTimestamp(),
  });
}

export function getMyInvitesSentQuery(userId: string) {
  return query(
    collection(db, "invites"),
    where("invitedBy", "==", userId),
    orderBy("createdAt", "desc")
  );
}

export function getPendingInvitesByEmailQuery(email: string) {
  return query(
    collection(db, "invites"),
    where("invitedEmail", "==", email.toLowerCase()),
    where("status", "==", "pending")
  );
}

export async function updateInviteStatus(inviteId: string, status: InviteStatus) {
  await assertVerifiedUser();
  await updateDoc(doc(db, "invites", inviteId), { status });
}

// ── Auth helpers ───────────────────────────────────────────────────────────────
export async function loginWithEmailPassword(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function signUpWithEmailPassword(email: string, password: string) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  // Send verification email — non-fatal if it fails (e.g. emulator)
  try { await sendEmailVerification(cred.user); } catch { /* ignore */ }
  return cred;
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider);
}

export async function signInWithGithub() {
  const provider = new GithubAuthProvider();
  return signInWithPopup(auth, provider);
}

export async function logoutFirebase() {
  return firebaseSignOut(auth);
}

export async function getIdToken(): Promise<string | null> {
  const currentUser = auth.currentUser;
  if (!currentUser) return null;
  return currentUser.getIdToken();
}

export async function createOrUpdateUserProfile(
  user: FirebaseUser,
  defaultRole: UserRole = "Viewer"
): Promise<FirestoreUser> {
  const userRef = doc(db, "users", user.uid);
  const snapshot = await getDoc(userRef);
  const storedRole = snapshot.exists()
    ? (snapshot.data()?.role as UserRole)
    : defaultRole;
  const profile: FirestoreUser = {
    uid: user.uid,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    role: storedRole,
    updatedAt: serverTimestamp(),
  };
  await setDoc(
    userRef,
    {
      email: profile.email,
      displayName: profile.displayName,
      role: profile.role,
      updatedAt: profile.updatedAt,
      createdAt: snapshot.exists() ? snapshot.data()?.createdAt : serverTimestamp(),
    },
    { merge: true }
  );
  return profile;
}

export async function getUserProfile(uid: string): Promise<FirestoreUser | null> {
  const snapshot = await getDoc(doc(db, "users", uid));
  if (!snapshot.exists()) return null;
  return {
    uid,
    email: snapshot.data()?.email ?? null,
    displayName: snapshot.data()?.displayName ?? null,
    role: snapshot.data()?.role ?? "Viewer",
    createdAt: snapshot.data()?.createdAt,
    updatedAt: snapshot.data()?.updatedAt,
  };
}

export async function getNotificationSettings(uid: string): Promise<NotificationSettings> {
  const snapshot = await getDoc(doc(db, "notificationSettings", uid));
  if (!snapshot.exists()) return defaultNotificationSettings;
  const data = snapshot.data();
  return {
    criticalRiskAlerts: Boolean(data?.criticalRiskAlerts ?? true),
    newAssets: Boolean(data?.newAssets ?? true),
    weeklyDigest: Boolean(data?.weeklyDigest ?? false),
  };
}

export async function saveNotificationSettings(
  uid: string,
  settings: NotificationSettings
): Promise<NotificationSettings> {
  await assertVerifiedUser(uid);
  await setDoc(
    doc(db, "notificationSettings", uid),
    { ...settings, updatedAt: serverTimestamp() },
    { merge: true }
  );
  return settings;
}

export async function seedAlert(
  userId: string,
  type: "critical" | "warning" | "success" | "info",
  title: string,
  asset: string
): Promise<void> {
  await assertVerifiedUser(userId);
  await addDoc(collection(db, "alerts"), {
    type,
    title,
    asset,
    createdBy: userId,
    timestamp: serverTimestamp(),
    read: false,
  });
}

export { onAuthStateChanged } from "firebase/auth";

// ── Reports (stored in scans collection as a dedicated report doc) ─────────────
export interface Report {
  id?: string;
  title: string;
  template: string;
  period: string;
  format: string;
  status: "generating" | "ready" | "failed";
  totalFindings: number;
  criticalFindings: number;
  assetsScanned: number;
  scansIncluded: number;
  generatedBy: string;
  generatedAt: Timestamp | null;
  downloadCount: number;
  _isReport: true; // marker to distinguish from scan docs
}

export async function createReport(
  userId: string,
  data: { title: string; template: string; period: string; format: string },
  stats: { totalFindings: number; criticalFindings: number; assetsScanned: number; scansIncluded: number }
): Promise<string> {
  await assertVerifiedUser(userId);
  const ref = await addDoc(collection(db, "scans"), {
    ...data,
    ...stats,
    _isReport: true,
    status: "ready",
    generatedBy: userId,
    generatedAt: serverTimestamp(),
    downloadCount: 0,
    createdBy: userId,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function incrementReportDownload(reportId: string): Promise<void> {
  await assertVerifiedUser();
  const snap = await getDoc(doc(db, "scans", reportId));
  if (snap.exists()) {
    if (snap.data()?.createdBy !== auth.currentUser?.uid || snap.data()?._isReport !== true) {
      throw new Error("This report does not belong to your account.");
    }
    await updateDoc(doc(db, "scans", reportId), {
      downloadCount: (snap.data()?.downloadCount || 0) + 1,
    });
  }
}

export async function saveAccountProfile(userId: string, displayName: string): Promise<void> {
  const currentUser = await assertVerifiedUser(userId);
  const normalizedName = displayName.trim();
  if (!normalizedName) throw new Error("Display name cannot be empty.");
  await updateProfile(currentUser, { displayName: normalizedName });
  await setDoc(
    doc(db, "users", userId),
    { email: currentUser.email ?? null, displayName: normalizedName, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export async function changeAccountPassword(currentPassword: string, newPassword: string): Promise<void> {
  const currentUser = await assertVerifiedUser();
  if (!currentUser.email || !currentUser.providerData.some(provider => provider.providerId === "password")) {
    throw new Error("Password changes are only available for accounts using email and password.");
  }
  const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
  await reauthenticateWithCredential(currentUser, credential);
  await updatePassword(currentUser, newPassword);
}

export function getReportsQuery(userId = auth.currentUser?.uid || "") {
  return query(
    collection(db, "scans"),
    where("createdBy", "==", userId),
    where("_isReport", "==", true),
  );
}

export function getScansOnlyQuery(userId = auth.currentUser?.uid || "") {
  return query(collection(db, "scans"), where("createdBy", "==", userId));
}

// Helpers for backward compat
export function getAssetsQuery(scanId?: string) {
  const col = collection(db, "scans");
  if (scanId) return query(col, where("id", "==", scanId));
  return query(col, where("createdBy", "==", auth.currentUser?.uid || ""));
}

export function getFindingsQuery(scanId?: string) {
  const col = collection(db, "scans");
  if (scanId) return query(col, where("id", "==", scanId));
  return query(col, where("createdBy", "==", auth.currentUser?.uid || ""));
}
