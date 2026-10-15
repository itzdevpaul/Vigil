import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { claimQueuedScan, processClaimedScan, validateScanInput } from "./scan-engine.js";

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
if (!projectId) throw new Error("Set FIREBASE_PROJECT_ID or GCLOUD_PROJECT for the scan worker.");
initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();
const scans = db.collection("scans");
const workerStatusRef = db.collection("system").doc("scanWorker");
const workerInstance = `${process.env.WORKER_ID || "worker"}-${randomUUID()}`;
const leaseMs = 5 * 60 * 1000;
const maxToolOutputBytes = 12 * 1024 * 1024;
const allowedTargets = (process.env.VIGIL_SCAN_ALLOWED_TARGETS || "").split(",").map(x => x.trim()).filter(Boolean);
const maxHosts = Number(process.env.VIGIL_SCAN_MAX_HOSTS || 256);
const pollMs = Number(process.env.VIGIL_SCAN_POLL_MS || 3000);
let stopping = false;
let workerReady = false;
let activeChild = null;

async function claimNext() {
  const queued = await scans.where("status", "==", "queued").limit(10).get();
  for (const candidate of queued.docs) {
    const leaseToken = randomUUID();
    const claimed = await claimQueuedScan({
      runTransaction: callback => db.runTransaction(callback),
      reference: candidate.ref,
      workerId: workerInstance,
      leaseToken,
      leaseUntil: Timestamp.fromMillis(Date.now() + leaseMs),
      startedAt: FieldValue.serverTimestamp(),
      workerClaimedAt: FieldValue.serverTimestamp(),
      clearError: FieldValue.delete(),
      clearResultTools: FieldValue.delete(),
    });
    if (claimed) return claimed;
  }
  return null;
}

function makeRepository(scan) {
  const ref = scans.doc(scan.id);
  async function activeTransaction(transaction, change) {
    const latest = await transaction.get(ref);
    if (!latest.exists || latest.get("workerId") !== workerInstance || latest.get("leaseToken") !== scan.leaseToken) return false;
    transaction.update(ref, {
      ...change,
      leaseUntil: Timestamp.fromMillis(Date.now() + leaseMs),
    });
    return true;
  }
  return {
    async progress(_id, values) {
      await db.runTransaction(transaction => activeTransaction(transaction, values));
    },
    async heartbeat() {
      await db.runTransaction(transaction => activeTransaction(transaction, {}));
      await publishWorkerStatus("online", workerReady);
    },
    async getControl(_id) {
      const snapshot = await ref.get();
      if (!snapshot.exists || snapshot.get("workerId") !== workerInstance || snapshot.get("leaseToken") !== scan.leaseToken) return "cancel";
      return snapshot.get("controlRequest") || null;
    },
    async setState(_id, status, values) {
      await db.runTransaction(async transaction => {
        const latest = await transaction.get(ref);
        if (!latest.exists || latest.get("workerId") !== workerInstance || latest.get("leaseToken") !== scan.leaseToken) return;
        transaction.update(ref, {
          ...values, status,
          controlRequest: null,
          workerId: FieldValue.delete(),
          leaseToken: FieldValue.delete(),
          leaseUntil: FieldValue.delete(),
        });
      });
    },
  };
}

function runTool(command, args, { shouldStop, heartbeat }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    activeChild = child;
    let stdout = "";
    let stdoutBytes = 0;
    let stderr = "";
    child.stdout.on("data", chunk => {
      if (stdoutBytes + chunk.length > maxToolOutputBytes) {
        child.kill("SIGTERM");
        return;
      }
      stdoutBytes += chunk.length;
      stdout += chunk.toString();
    });
    child.stderr.on("data", chunk => { stderr = `${stderr}${chunk.toString()}`.slice(-8000); });
    let checks = 0;
    const monitor = setInterval(async () => {
      try {
        if (await shouldStop()) child.kill("SIGTERM");
        if (++checks % 10 === 0) await heartbeat?.();
      } catch { child.kill("SIGTERM"); }
    }, 2000);
    child.on("error", error => {
      clearInterval(monitor);
      if (activeChild === child) activeChild = null;
      reject(error);
    });
    child.on("close", code => {
      clearInterval(monitor);
      if (activeChild === child) activeChild = null;
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function runOne(scan) {
  const repository = makeRepository(scan);
  try {
    const validated = validateScanInput(scan, { allowedTargets, maxHosts });
    await processClaimedScan({ ...scan, ...validated }, { repository, runTool });
  } catch (error) {
    await repository.setState(scan.id, "failed", {
      phase: "Failed", error: error.message || "Worker setup or validation failed.", progress: 0,
      completedAt: FieldValue.serverTimestamp(),
    });
  }
}

async function failExpiredLeases() {
  const expired = await scans.where("leaseUntil", "<=", Timestamp.now()).limit(50).get();
  for (const document of expired.docs) {
    await db.runTransaction(async transaction => {
      const latest = await transaction.get(document.ref);
      if (!latest.exists || latest.get("status") !== "running" ||
          !latest.get("leaseUntil") || latest.get("leaseUntil").toMillis() > Date.now()) return;
      transaction.update(document.ref, {
        status: "failed", phase: "Worker lease expired", error: "Worker stopped before recording a final result.",
        completedAt: FieldValue.serverTimestamp(),
        workerId: FieldValue.delete(), leaseToken: FieldValue.delete(),
        leaseUntil: FieldValue.delete(),
      });
    });
  }
}

async function processPausedControls() {
  const controlled = await scans.where("controlRequest", "in", ["resume", "cancel"]).limit(50).get();
  for (const document of controlled.docs) {
    const control = document.get("controlRequest");
    if ((control !== "resume" && control !== "cancel") || document.get("status") !== "paused") continue;
    await db.runTransaction(async transaction => {
      const latest = await transaction.get(document.ref);
      if (!latest.exists || latest.get("status") !== "paused" || latest.get("controlRequest") !== control) return;
      transaction.update(document.ref, {
        status: control === "resume" ? "queued" : "cancelled",
        phase: control === "resume" ? "Waiting for scan worker" : "Cancelled",
        controlRequest: null,
        ...(control === "cancel" ? { completedAt: FieldValue.serverTimestamp() } : {}),
      });
    });
  }
}

function commandAvailable(command, args) {
  const result = spawnSync(command, args, { stdio: "ignore", timeout: 5000 });
  return !result.error && result.status === 0;
}

async function publishWorkerStatus(status, ready) {
  await workerStatusRef.set({
    status, ready, workerId: workerInstance,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function main() {
  workerReady = allowedTargets.length > 0 && commandAvailable("nmap", ["--version"]) && commandAvailable("nuclei", ["-version"]);
  if (!workerReady) console.error("Worker is not ready: configure the target allowlist and install Nmap/Nuclei.");
  console.log(`Vigil scan worker ${workerInstance} started.`);
  let lastHeartbeat = 0;
  await publishWorkerStatus("online", workerReady);
  try {
    while (!stopping) {
      try {
        if (Date.now() - lastHeartbeat >= 15_000) {
          await publishWorkerStatus("online", workerReady);
          lastHeartbeat = Date.now();
        }
        await failExpiredLeases();
        await processPausedControls();
        const scan = await claimNext();
        if (scan) await runOne(scan);
        else await sleep(pollMs);
      } catch (error) {
        console.error("Worker loop error:", error.message);
        await sleep(pollMs);
      }
    }
  } finally {
    await publishWorkerStatus("offline", false);
  }
}

process.on("SIGTERM", () => { stopping = true; activeChild?.kill("SIGTERM"); });
process.on("SIGINT", () => { stopping = true; activeChild?.kill("SIGTERM"); });
main().catch(error => { console.error("Worker startup failed:", error.message); process.exitCode = 1; });
