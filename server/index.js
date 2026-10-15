import express from "express";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import {
  createAuthMiddleware,
  createCorsMiddleware,
  createUserRateLimiter,
  getAllowedOrigins,
  redactSecretValues,
} from "./api-security.js";
import { createIntegrationSecretHandlers } from "./integration-secrets.js";

const app = express();
const PORT = 3001;

const SHODAN_KEY = process.env.SHODAN_API_KEY;
const CENSYS_KEY = process.env.CENSYS_API_KEY;
const QUALYS_KEY = process.env.QUALYSYS_API_KEY;
const VT_KEY = process.env.VIRUSTOTAL_API_KEY;
const PROVIDER_SECRETS = [SHODAN_KEY, CENSYS_KEY, QUALYS_KEY, VT_KEY];
let firebaseAuth;

function getAdminApp() {
  return getApps()[0] ?? initializeApp({
      credential: applicationDefault(),
      ...(process.env.FIREBASE_PROJECT_ID ? { projectId: process.env.FIREBASE_PROJECT_ID } : {}),
    });
}

async function verifyFirebaseIdToken(token) {
  if (!firebaseAuth) {
    const adminApp = getAdminApp();
    firebaseAuth = getAuth(adminApp);
  }
  return firebaseAuth.verifyIdToken(token);
}

// COOP header: allows Google/GitHub OAuth popups to post back to the opener
app.use((_req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
  next();
});
app.use("/api", createCorsMiddleware(getAllowedOrigins(process.env.VIGIL_ALLOWED_ORIGINS)));
app.use("/api", createAuthMiddleware(verifyFirebaseIdToken));
app.use("/api", createUserRateLimiter());
app.use(express.json({ limit: "16kb" }));

const integrationSecrets = createIntegrationSecretHandlers({
  db: () => getFirestore(getAdminApp()),
  deleteField: () => FieldValue.delete(),
});
app.get("/api/integrations", integrationSecrets.list);
app.post("/api/integrations", integrationSecrets.save);
app.delete("/api/integrations/:type", integrationSecrets.remove);
app.post("/api/integrations/migrate-legacy", integrationSecrets.migrateLegacy);

async function sendUpstreamJson(res, upstream) {
  const responseText = await upstream.text();
  const parsed = JSON.parse(responseText);
  const sanitizedText = redactSecretValues(JSON.stringify(parsed), PROVIDER_SECRETS);
  res.status(upstream.status).type("application/json").send(sanitizedText);
}

// ── Health check ────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    services: {
      shodan:     !!SHODAN_KEY,
      censys:     !!CENSYS_KEY,
      qualys:     !!QUALYS_KEY,
      virustotal: !!VT_KEY,
    },
  });
});

// ── Shodan: domain / subdomain / port intel ──────────────────────────────────
// GET /api/shodan/domain/:domain
app.get("/api/shodan/domain/:domain", async (req, res) => {
  if (!SHODAN_KEY) return res.status(503).json({ error: "Shodan key not configured" });
  try {
    const domain = req.params.domain;
    const upstream = await fetch(
      `https://api.shodan.io/dns/domain/${encodeURIComponent(domain)}?key=${encodeURIComponent(SHODAN_KEY)}`,
      { signal: AbortSignal.timeout(12000) }
    );
    await sendUpstreamJson(res, upstream);
  } catch {
    res.status(502).json({ error: "Shodan request failed" });
  }
});

// GET /api/shodan/host/:ip  – per-IP port & vuln data
app.get("/api/shodan/host/:ip", async (req, res) => {
  if (!SHODAN_KEY) return res.status(503).json({ error: "Shodan key not configured" });
  try {
    const upstream = await fetch(
      `https://api.shodan.io/shodan/host/${encodeURIComponent(req.params.ip)}?key=${encodeURIComponent(SHODAN_KEY)}`,
      { signal: AbortSignal.timeout(12000) }
    );
    await sendUpstreamJson(res, upstream);
  } catch {
    res.status(502).json({ error: "Shodan host request failed" });
  }
});

// ── Censys: certificate & host search ────────────────────────────────────────
// GET /api/censys/certs?q=example.com
app.get("/api/censys/certs", async (req, res) => {
  if (!CENSYS_KEY) return res.status(503).json({ error: "Censys key not configured" });
  try {
    const q = String(req.query.q || "");
    // Key format: "censys_{id}_{secret}" → split after first underscore after "censys_"
    // or plain Base64-able token. Attempt Basic auth with the raw key as id, empty secret.
    const rawKey = CENSYS_KEY.replace(/^censys_/, "");
    const authHeader = `Basic ${Buffer.from(`${rawKey}:`).toString("base64")}`;

    const upstream = await fetch(
      `https://search.censys.io/api/v2/certificates?q=${encodeURIComponent(q)}&per_page=5`,
      {
        headers: { Authorization: authHeader, Accept: "application/json" },
        signal: AbortSignal.timeout(12000),
      }
    );
    await sendUpstreamJson(res, upstream);
  } catch {
    res.status(502).json({ error: "Censys request failed" });
  }
});

// ── VirusTotal: domain reputation ─────────────────────────────────────────────
// GET /api/virustotal/domain/:domain
app.get("/api/virustotal/domain/:domain", async (req, res) => {
  if (!VT_KEY) return res.status(503).json({ error: "VirusTotal key not configured" });
  try {
    const upstream = await fetch(
      `https://www.virustotal.com/api/v3/domains/${encodeURIComponent(req.params.domain)}`,
      {
        headers: { "x-apikey": VT_KEY },
        signal: AbortSignal.timeout(10000),
      }
    );
    await sendUpstreamJson(res, upstream);
  } catch {
    res.status(502).json({ error: "VirusTotal request failed" });
  }
});

// ── SSL Labs (Qualys): TLS grade ──────────────────────────────────────────────
// GET /api/ssllabs/analyze?host=example.com
app.get("/api/ssllabs/analyze", async (req, res) => {
  try {
    const host = String(req.query.host || "");
    const headers = { Accept: "application/json" };
    if (QUALYS_KEY) headers["X-API-Key"] = QUALYS_KEY;
    const upstream = await fetch(
      `https://api.ssllabs.com/api/v3/analyze?host=${encodeURIComponent(host)}&fromCache=on&all=done&ignoreMismatch=on`,
      { headers, signal: AbortSignal.timeout(15000) }
    );
    await sendUpstreamJson(res, upstream);
  } catch {
    res.status(502).json({ error: "SSL Labs request failed" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✓ Vigil proxy server ready on port ${PORT}`);
  console.log(`  Shodan configured:     ${!!SHODAN_KEY}`);
  console.log(`  Censys configured:     ${!!CENSYS_KEY}`);
  console.log(`  Qualys configured:     ${!!QUALYS_KEY}`);
  console.log(`  VirusTotal configured: ${!!VT_KEY}`);
});
