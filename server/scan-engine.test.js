import test from "node:test";
import assert from "node:assert/strict";
import {
  claimQueuedScan,
  boundScanResults,
  executeScan,
  nmapArgs,
  nucleiArgs,
  parseNmapXml,
  parseNucleiJsonl,
  processClaimedScan,
  resolveAuthorizedTargets,
  validateScanInput,
} from "./scan-engine.js";

const allowedTargets = ["example.test", "192.0.2.0/24"];
const documentationNetwork = [{ start: 3221225984, end: 3221226239, bits: 24 }];

test("transactional claim allows only one competing worker", async () => {
  const reference = { id: "queued-1" };
  const state = { status: "queued", createdBy: "user-1", name: "test", findings: 4, _assets: [{ id: "simulated" }], _findings: [{ id: "simulated" }] };
  let lock = Promise.resolve();
  const runTransaction = async callback => {
    const previous = lock;
    let release;
    lock = new Promise(resolve => { release = resolve; });
    await previous;
    const transaction = {
      get: async () => ({
        exists: true,
        get: key => state[key],
        data: () => ({ ...state }),
      }),
      update: (_reference, patch) => Object.assign(state, patch),
    };
    try { return await callback(transaction); }
    finally { release(); }
  };
  const claim = workerId => claimQueuedScan({
    runTransaction: callback => runTransaction(callback),
    reference, workerId, leaseToken: `lease-${workerId}`, leaseUntil: new Date(), startedAt: new Date(),
  });
  const results = await Promise.all([claim("worker-a"), claim("worker-b")]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(state.status, "running");
  assert.equal(state.findings, 0);
  assert.deepEqual(state._assets, []);
  assert.deepEqual(state._findings, []);
  assert(["worker-a", "worker-b"].includes(state.workerId));
  assert.equal(await claim("worker-c"), null);
});

test("validates authorization, allowlist, scan type, ports, rate, and CIDR size", async () => {
  const base = { name: "test scan", target: "example.test", scanType: "full", authorizationAcknowledged: true };
  assert.equal(validateScanInput(base, { allowedTargets }).target, "example.test");
  assert.deepEqual(validateScanInput({ ...base, target: "https://example.test:8443/a" }, { allowedTargets }).ports, [8443]);
  assert.throws(() => validateScanInput(base, { allowedTargets: [] }), /allowlist/);
  assert.throws(() => validateScanInput({ ...base, authorizationAcknowledged: false }, { allowedTargets }), /acknowledgement/);
  assert.throws(() => validateScanInput({ ...base, target: "example.org" }, { allowedTargets }), /allowlist/);
  assert.throws(() => validateScanInput({ ...base, scanType: "cloud" }, { allowedTargets }), /not supported/);
  assert.throws(() => validateScanInput({ ...base, ports: [22, "80"] }, { allowedTargets }), /Ports/);
  assert.throws(() => validateScanInput({ ...base, rate: 500 }, { allowedTargets }), /rate/);
  const range = validateScanInput({ ...base, target: "192.0.2.0/16", scanType: "port" }, { allowedTargets });
  await assert.rejects(resolveAuthorizedTargets(range), /host limit/);
});

test("resolves authorized hostnames and rejects oversized or out-of-allowlist networks", async () => {
  const domain = validateScanInput({
    name: "test", target: "example.test", scanType: "full", authorizationAcknowledged: true,
  }, { allowedTargets });
  assert.deepEqual(await resolveAuthorizedTargets(domain, async () => [
    { address: "192.0.2.4", family: 4 },
  ]), ["192.0.2.4"]);
  await assert.rejects(resolveAuthorizedTargets(domain, async () => []), /did not resolve/);
  const outside = validateScanInput({
    name: "test", target: "198.51.100.2", scanType: "port", authorizationAcknowledged: true,
  }, { allowedTargets: ["example.test", "192.0.2.0/24"] });
  await assert.rejects(resolveAuthorizedTargets(outside), /not in the configured allowlist/);
});

test("hostname resolution cannot redirect scans to non-public addresses without an explicit CIDR allowlist", async () => {
  const input = validateScanInput({
    name: "test", target: "example.test", scanType: "port", authorizationAcknowledged: true,
  }, { allowedTargets: ["example.test"] });
  for (const address of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "192.168.1.10"]) {
    await assert.rejects(
      resolveAuthorizedTargets(input, async () => [{ address, family: 4 }]),
      /non-public address/,
    );
  }
  assert.deepEqual(await resolveAuthorizedTargets(input, async () => [
    { address: "8.8.8.8", family: 4 },
  ]), ["8.8.8.8"]);

  const explicitlyAllowed = validateScanInput({
    name: "test", target: "example.test", scanType: "port", authorizationAcknowledged: true,
  }, { allowedTargets: ["example.test", "192.168.1.0/24"] });
  assert.deepEqual(await resolveAuthorizedTargets(explicitlyAllowed, async () => [
    { address: "192.168.1.10", family: 4 },
  ]), ["192.168.1.10"]);
});

const nmapFixture = `<?xml version="1.0"?><nmaprun><host><status state="up"/><address addr="192.0.2.4" addrtype="ipv4"/><hostnames><hostname name="example.test" type="user"/></hostnames><ports><port protocol="tcp" portid="443"><state state="open"/><service name="https" product="nginx" version="1.2"/></port></ports></host></nmaprun>`;

test("maps actual Nmap XML to the existing asset shape", () => {
  const { assets, findings } = parseNmapXml(nmapFixture, "scan-1", "2026-01-01T00:00:00.000Z");
  assert.equal(findings.length, 0);
  assert.deepEqual(assets[0], {
    id: assets[0].id, scanId: "scan-1", name: "example.test", host: "example.test",
    ipAddress: "192.0.2.4", type: "Web", riskScore: 0, status: "active",
    ports: [{ port: 443, service: "https", state: "open", version: "nginx 1.2" }],
    technologies: [], discoveredAt: "2026-01-01T00:00:00.000Z",
  });
  assert.throws(() => parseNmapXml("", "scan-1"), /complete XML/);
});

test("maps actual Nuclei JSONL to findings and ignores malformed or unmatched rows", () => {
  const assets = parseNmapXml(nmapFixture, "scan-1").assets;
  const findings = parseNucleiJsonl([
    "{bad json",
    JSON.stringify({ host: "192.0.2.4", "matched-at": "https://192.0.2.4:443/admin", "template-id": "test-misconfig", info: { name: "Exposed admin", severity: "medium", description: "Observed exposure", tags: ["misconfig"] } }),
    JSON.stringify({ host: "203.0.113.1", info: { name: "unmatched", severity: "critical" } }),
  ].join("\n"), assets, "scan-1", "2026-01-01T00:00:00.000Z");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].assetId, assets[0].id);
  assert.equal(findings[0].title, "Exposed admin");
  assert.equal(findings[0].severity, "medium");
  assert.equal(findings[0].port, 443);
});

test("builds constrained scanner arguments without a shell or user-controlled flags", () => {
  const args = nmapArgs(["192.0.2.4"], [443], 25);
  assert(args.includes("--"));
  assert.deepEqual(args.slice(-1), ["192.0.2.4"]);
  assert(args.includes("443"));
  assert(nucleiArgs(["192.0.2.4"]).includes("-exclude-tags"));
  assert(!nucleiArgs(["192.0.2.4"]).some(arg => arg.includes("example")));
});

test("bounds persisted tool output without generating replacement results", () => {
  const assets = [{ id: "a", ports: Array.from({ length: 30 }, (_, i) => ({ port: i + 1, service: "http", state: "open" })) }];
  const findings = Array.from({ length: 205 }, (_, i) => ({
    id: `f-${i}`, assetId: "a", title: "Observed", severity: "low", references: [],
  }));
  const bounded = boundScanResults(assets, findings, 1000);
  assert.equal(bounded.truncated, true);
  assert(bounded.assets.length <= 1);
  assert(bounded.findings.length <= 200);
  assert(Buffer.byteLength(JSON.stringify({ assets: bounded.assets, findings: bounded.findings })) <= 1000);
});

test("completes only after real successful tool output and records truthful results", async () => {
  const writes = [];
  const repository = {
    getControl: async () => null,
    progress: async (_id, update) => writes.push(["progress", update]),
    setState: async (_id, status, update) => writes.push([status, update]),
  };
  const runTool = async command => command === "nmap"
    ? { code: 0, stdout: nmapFixture, stderr: "" }
    : { code: 0, stdout: `${JSON.stringify({ host: "192.0.2.4", info: { name: "Observed issue", severity: "low" } })}\n`, stderr: "" };
  await processClaimedScan({
    id: "scan-1", target: "example.test", targetKind: "domain", targetCidr: undefined,
    allowedDomains: ["example.test"], allowedCidrs: documentationNetwork, maxHosts: 256, rate: 50, scanType: "full",
  }, {
    repository, runTool, resolveTarget: async () => [{ address: "192.0.2.4", family: 4 }],
    now: (() => { let n = 100; return () => n += 1000; })(),
  });
  const complete = writes.find(([state]) => state === "completed");
  assert(complete);
  assert.equal(complete[1].assetsDiscovered, 1);
  assert.equal(complete[1].findings, 1);
  assert.equal(complete[1].duration, "0m 1s");
});

test("fails explicitly on tool setup failure and records partial results on Nuclei failure", async () => {
  const states = [];
  const repository = {
    getControl: async () => null, progress: async () => {},
    setState: async (_id, status, data) => states.push([status, data]),
  };
  await processClaimedScan({ id: "x", target: "example.test", targetKind: "domain", allowedDomains: ["example.test"], allowedCidrs: documentationNetwork, maxHosts: 10, rate: 50, scanType: "full" }, {
    repository, resolveTarget: async () => [{ address: "192.0.2.4", family: 4 }],
    runTool: async () => { throw new Error("nmap missing"); },
  });
  assert.equal(states.at(-1)[0], "failed");
  assert.match(states.at(-1)[1].error, /Nmap failed/);

  const input = { id: "x", target: "example.test", targetKind: "domain", allowedDomains: ["example.test"], allowedCidrs: documentationNetwork, maxHosts: 10, rate: 50, scanType: "full" };
  const partial = await executeScan(input, {
    runTool: async command => command === "nmap" ? { code: 0, stdout: nmapFixture } : { code: 1, stdout: "", stderr: "nuclei unavailable" },
    onProgress: async () => {}, shouldStop: async () => false,
    resolveTarget: async () => [{ address: "192.0.2.4", family: 4 }],
  });
  assert.equal(partial.state, "partial");
  assert.equal(partial.assets.length, 1);
});

test("honors pause/cancel control without inventing completion", async () => {
  for (const action of ["pause", "cancel"]) {
    const states = [];
    const repository = {
      getControl: async () => action, progress: async () => {},
      setState: async (_id, status, data) => states.push([status, data]),
    };
    await processClaimedScan({ id: "x", target: "example.test", targetKind: "domain", allowedDomains: ["example.test"], allowedCidrs: documentationNetwork, maxHosts: 10, rate: 50, scanType: "full" }, {
      repository, resolveTarget: async () => [{ address: "192.0.2.4", family: 4 }],
      runTool: async () => ({ code: 0, stdout: nmapFixture }),
    });
    assert.equal(states.at(-1)[0], action === "pause" ? "paused" : "cancelled");
    assert(!states.some(([status]) => status === "completed"));
  }
});
