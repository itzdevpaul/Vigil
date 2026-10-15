import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { reload, sendEmailVerification } from "firebase/auth";
import {
  auth,
  loginWithEmailPassword,
  logoutFirebase,
  signUpWithEmailPassword,
  signInWithGoogle,
  signInWithGithub,
  db,
} from "../../firebase";
import {
  createOrUpdateUserProfile,
  getNotificationSettings,
  getUserProfile,
  saveNotificationSettings,
  saveAccountProfile,
  changeAccountPassword,
  type FirestoreUser,
  type NotificationSettings,
  defaultNotificationSettings,
} from "../../firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  type Timestamp,
} from "firebase/firestore";
import { toast } from "sonner";
import type { ReactNode } from "react";

export interface Alert {
  id: string;
  type: "critical" | "warning" | "success" | "info";
  title: string;
  asset: string;
  timestamp: Timestamp | null;
  effectivelyRead: boolean;
}

interface AuthContextValue {
  user: FirestoreUser | null;
  loading: boolean;
  emailVerified: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithGithub: () => Promise<void>;
  logout: () => Promise<void>;
  resendVerification: () => Promise<void>;
  ensureEmailVerified: () => Promise<boolean>;
  updateAccountProfile: (displayName: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  getIdToken: () => Promise<string | null>;
  refreshToken: () => Promise<string | null>;
  notificationSettings: NotificationSettings;
  updateNotificationSettings: (settings: NotificationSettings) => Promise<void>;
  isAdmin: boolean;
  alerts: Alert[];
  unreadAlertCount: number;
  markAlertRead: (id: string) => void;
  markAllAlertsRead: () => void;
  firestoreError: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirestoreUser | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [firestoreError, setFirestoreError] = useState(false);
  const [notificationSettings, setNotificationSettings] =
    useState<NotificationSettings>(defaultNotificationSettings);
  const [rawAlerts, setRawAlerts] = useState<Omit<Alert, "effectivelyRead">[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const alertsUnsubRef = useRef<(() => void) | null>(null);
  const seenAlertIdsRef = useRef<Set<string>>(new Set());
  const isFirstSnapshotRef = useRef(true);

  useEffect(() => {
    // Safety timeout: if onAuthStateChanged never fires (bad config), stop loading
    const timeout = setTimeout(() => setLoading(false), 6000);

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      clearTimeout(timeout);
      setLoading(true);

      if (firebaseUser) {
        // Track email verification status from Firebase Auth (not Firestore)
        setEmailVerified(firebaseUser.emailVerified);

        try {
          const profile = await getUserProfile(firebaseUser.uid);
          const currentUser =
            profile ?? (await createOrUpdateUserProfile(firebaseUser, "Viewer"));
          setUser(currentUser);
        } catch {
          setFirestoreError(true);
          setUser({
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            role: "Viewer",
          });
        }

        try {
          const settings = await getNotificationSettings(firebaseUser.uid);
          setNotificationSettings(settings);
        } catch {
          // Use defaults if Firestore is inaccessible
        }

        subscribeToAlerts(firebaseUser.uid);
      } else {
        setUser(null);
        setEmailVerified(true);
        setNotificationSettings(defaultNotificationSettings);
        setRawAlerts([]);
        seenAlertIdsRef.current = new Set();
        isFirstSnapshotRef.current = true;
        alertsUnsubRef.current?.();
        alertsUnsubRef.current = null;
      }

      setLoading(false);
    });

    return () => {
      clearTimeout(timeout);
      unsubscribe();
      alertsUnsubRef.current?.();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function subscribeToAlerts(uid: string) {
    alertsUnsubRef.current?.();
    isFirstSnapshotRef.current = true;

    try {
      const q = query(
        collection(db, "alerts"),
        where("createdBy", "==", uid),
        orderBy("timestamp", "desc"),
        limit(20)
      );

      alertsUnsubRef.current = onSnapshot(
        q,
        (snapshot) => {
          const incoming = snapshot.docs.map((doc) => ({
            id: doc.id,
            type: (doc.data().type ?? "info") as Alert["type"],
            title: doc.data().title ?? "Alert",
            asset: doc.data().asset ?? "",
            timestamp: (doc.data().timestamp as Timestamp) ?? null,
          }));

          // On subsequent snapshots, fire toasts for genuinely new alerts
          if (!isFirstSnapshotRef.current) {
            for (const alert of incoming) {
              if (!seenAlertIdsRef.current.has(alert.id)) {
                fireToast(alert);
              }
            }
          }
          isFirstSnapshotRef.current = false;
          seenAlertIdsRef.current = new Set(incoming.map((a) => a.id));

          setRawAlerts(incoming);
          setFirestoreError(false);
        },
        (err) => {
          console.warn("Alerts listener:", err.message);
          setFirestoreError(true);
          setRawAlerts([]);
          seenAlertIdsRef.current.clear();
          isFirstSnapshotRef.current = false;
        }
      );
    } catch {
      setFirestoreError(true);
      setRawAlerts([]);
      seenAlertIdsRef.current.clear();
      isFirstSnapshotRef.current = false;
    }
  }

  function fireToast(alert: Omit<Alert, "effectivelyRead">) {
    const msg = `${alert.title}`;
    const desc = alert.asset;
    if (alert.type === "critical") {
      toast.error(msg, { description: desc, duration: 7000 });
    } else if (alert.type === "warning") {
      toast.warning(msg, { description: desc, duration: 6000 });
    } else if (alert.type === "success") {
      toast.success(msg, { description: desc, duration: 5000 });
    } else {
      toast.info(msg, { description: desc, duration: 5000 });
    }
  }

  const markAlertRead = (id: string) =>
    setReadIds((prev) => new Set([...prev, id]));

  const markAllAlertsRead = () =>
    setReadIds(new Set(rawAlerts.map((a) => a.id)));

  const alerts: Alert[] = useMemo(
    () =>
      rawAlerts.map((a) => ({
        ...a,
        effectivelyRead: readIds.has(a.id),
      })),
    [rawAlerts, readIds]
  );

  const unreadAlertCount = alerts.filter((a) => !a.effectivelyRead).length;

  const login = async (email: string, password: string) =>
    loginWithEmailPassword(email, password).then(() => {});

  const signup = async (email: string, password: string) =>
    signUpWithEmailPassword(email, password).then(() => {});

  const signInWithGoogleProvider = async () =>
    signInWithGoogle().then(() => {});

  const signInWithGithubProvider = async () =>
    signInWithGithub().then(() => {});

  const logout = async () => logoutFirebase();

  const resendVerification = async () => {
    if (auth.currentUser && !auth.currentUser.emailVerified) {
      await sendEmailVerification(auth.currentUser);
    }
  };

  const ensureEmailVerified = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      toast.error("You must be signed in.");
      return false;
    }
    try {
      await reload(currentUser);
      const verified = currentUser.emailVerified;
      setEmailVerified(verified);
      if (!verified) {
        toast.error("Verify your email before making this change. Check your inbox for the verification link.");
      }
      return verified;
    } catch {
      toast.error("Unable to refresh email verification status. Please try again.");
      return false;
    }
  };

  const updateAccountProfile = async (displayName: string) => {
    if (!user) throw new Error("You must be signed in.");
    try {
      await saveAccountProfile(user.uid, displayName);
      setUser((current) => current ? { ...current, displayName: displayName.trim() } : current);
    } catch (error) {
      const authDisplayName = auth.currentUser?.displayName;
      setUser((current) => current && authDisplayName
        ? { ...current, displayName: authDisplayName }
        : current);
      throw error;
    }
  };

  const changePassword = async (currentPassword: string, newPassword: string) =>
    changeAccountPassword(currentPassword, newPassword);

  const getIdToken = async () => auth.currentUser?.getIdToken() ?? null;

  const refreshToken = async () =>
    auth.currentUser?.getIdToken(true) ?? null;

  const updateNotificationSettings = async (settings: NotificationSettings) => {
    if (!user) return;
    const updated = await saveNotificationSettings(user.uid, settings);
    setNotificationSettings(updated);
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      emailVerified,
      login,
      signup,
      signInWithGoogle: signInWithGoogleProvider,
      signInWithGithub: signInWithGithubProvider,
      logout,
      resendVerification,
      ensureEmailVerified,
      updateAccountProfile,
      changePassword,
      getIdToken,
      refreshToken,
      notificationSettings,
      updateNotificationSettings,
      isAdmin: user?.role === "Administrator",
      alerts,
      unreadAlertCount,
      markAlertRead,
      markAllAlertsRead,
      firestoreError,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, loading, emailVerified, notificationSettings, alerts, unreadAlertCount, firestoreError]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
