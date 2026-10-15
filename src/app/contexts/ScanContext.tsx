import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { auth, db, getScansQuery, type Asset, type Finding, type ScanJob } from "../../firebase";

interface ScanContextValue {
  scans: ScanJob[];
  assets: Asset[];
  findingsList: Finding[];
  activeCount: number;
  queuedCount: number;
  completedCount: number;
  findings: number;
  hasScans: boolean;
  isRunning: boolean;
  firestoreOk: boolean;
  workerStatus: "online" | "offline" | "unknown";
  workerReady: boolean | null;
  createScan: (userId: string, data: { name: string; target: string; scanType: string; authorizationAcknowledged: boolean }) => Promise<string>;
  deleteScan: (id: string) => Promise<void>;
  pauseScan: (scan: ScanJob) => Promise<void>;
}

const ScanContext = createContext<ScanContextValue | undefined>(undefined);

export function ScanProvider({ children }: { children: ReactNode }) {
  const [scans, setScans] = useState<ScanJob[]>([]);
  const [firestoreOk, setFirestoreOk] = useState(true);
  const [workerStatus, setWorkerStatus] = useState<"online" | "offline" | "unknown">("unknown");
  const [workerReady, setWorkerReady] = useState<boolean | null>(null);

  useEffect(() => {
    let unsubscribeScans: (() => void) | undefined;
    let unsubscribeWorker: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeScans?.();
      unsubscribeWorker?.();
      setScans([]);
      setWorkerStatus("unknown");
      setWorkerReady(null);
      if (!user) return;
      unsubscribeScans = onSnapshot(
        getScansQuery(user.uid),
        snapshot => {
          const ownJobs = snapshot.docs
            .map(document => ({ id: document.id, ...document.data() } as ScanJob))
            .filter(scan => !(scan as any)._isReport)
            .map(scan => {
              const hasScannerEvidence = scan.resultTools?.includes("nmap") === true;
              const terminal = scan.status === "completed" || scan.status === "partial";
              const unclaimedActivity = (scan.status === "running" || scan.status === "paused") && !scan.workerClaimedAt;
              const unverified = terminal && !hasScannerEvidence || unclaimedActivity;
              if (hasScannerEvidence) return scan;
              return {
                ...scan,
                status: "failed",
                findings: 0,
                assetsDiscovered: 0,
                _assets: [],
                _findings: [],
                ...(unverified ? {
                  phase: "Unverified legacy result",
                  error: "This scan state predates the server-side worker and has been hidden because its execution/output cannot be verified.",
                } : {}),
              } as ScanJob;
            })
            .sort((a, b) => {
              const aTime = a.createdAt?.toMillis?.() || 0;
              const bTime = b.createdAt?.toMillis?.() || 0;
              return bTime - aTime;
            });
          setScans(ownJobs);
          setFirestoreOk(true);
        },
        error => {
          console.info("Unable to load scan jobs:", error.code || error.message);
          setScans([]);
          setFirestoreOk(false);
        },
      );
      unsubscribeWorker = onSnapshot(doc(db, "system", "scanWorker"), snapshot => {
        if (!snapshot.exists()) {
          setWorkerStatus("offline");
          setWorkerReady(false);
          return;
        }
        const data = snapshot.data();
        const heartbeatAt = data.updatedAt?.toMillis?.() || 0;
        const online = data.status === "online" && Date.now() - heartbeatAt < 60_000;
        setWorkerStatus(online ? "online" : "offline");
        setWorkerReady(online ? data.ready === true : false);
      }, () => {
        setWorkerStatus("unknown");
        setWorkerReady(null);
      });
    });
    return () => { unsubscribeAuth(); unsubscribeScans?.(); unsubscribeWorker?.(); };
  }, []);

  const createScan = async (
    userId: string,
    data: { name: string; target: string; scanType: string; authorizationAcknowledged: boolean },
  ) => {
    if (!auth.currentUser || auth.currentUser.uid !== userId) throw new Error("Sign-in changed; please retry.");
    const reference = await addDoc(collection(db, "scans"), {
      name: data.name.trim(),
      target: data.target.trim(),
      scanType: data.scanType,
      authorizationAcknowledged: data.authorizationAcknowledged === true,
      status: "queued",
      progress: 0,
      findings: 0,
      assetsDiscovered: 0,
      duration: null,
      phase: "Waiting for scan worker",
      _assets: [],
      _findings: [],
      createdBy: userId,
      createdAt: serverTimestamp(),
      startedAt: null,
      completedAt: null,
    });
    return reference.id;
  };

  const deleteScan = async (id: string) => {
    const scan = scans.find(item => item.id === id);
    if (!scan) return;
    if (scan.status === "running" || scan.status === "queued" || scan.status === "paused") {
      await updateDoc(doc(db, "scans", id), {
        controlRequest: "cancel",
        controlUpdatedAt: serverTimestamp(),
      });
      return;
    }
    await deleteDoc(doc(db, "scans", id));
  };

  const pauseScan = async (scan: ScanJob) => {
    await updateDoc(doc(db, "scans", scan.id), {
      controlRequest: scan.status === "paused" ? "resume" : "pause",
      controlUpdatedAt: serverTimestamp(),
    });
  };

  const assets = useMemo(() => scans.flatMap(scan => scan._assets || []), [scans]);
  const findingsList = useMemo(() => scans.flatMap(scan => scan._findings || []), [scans]);
  const stats = useMemo(() => ({
    activeCount: scans.filter(scan => scan.status === "running").length,
    queuedCount: scans.filter(scan => scan.status === "queued").length,
    completedCount: scans.filter(scan =>
      (scan.status === "completed" || scan.status === "partial") && scan.resultTools?.includes("nmap"),
    ).length,
    findings: scans.reduce((sum, scan) => sum + (scan.findings || 0), 0),
    hasScans: scans.length > 0,
    isRunning: scans.some(scan => scan.status === "running"),
  }), [scans]);

  return (
    <ScanContext.Provider value={{ scans, assets, findingsList, firestoreOk, workerStatus, workerReady, createScan, deleteScan, pauseScan, ...stats }}>
      {children}
    </ScanContext.Provider>
  );
}

export function useScanContext() {
  const context = useContext(ScanContext);
  if (!context) throw new Error("useScanContext must be used inside a ScanProvider");
  return context;
}
