import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { randomUUID } from "node:crypto";

const MAX_HOSTS = 256;
const MAX_PORTS = 20;
const MAX_RATE = 50;
const MAX_RESULT_BYTES = 650 * 1024;
const SAFE_SCAN_TYPES = new Set(["full", "port", "vulnerability"]);

export async function claimQueuedScan({ runTransaction, reference, workerId, leaseToken, leaseUntil, startedAt, workerClaimedAt, clearError, clearResultTools }) {
  return runTransaction(async transaction => {
    const latest = await transaction.get(reference);
    if (!latest.exists || latest.get("status") !== "queued" || latest.get("_isReport") === true) return null;
    const data = latest.data();
    transaction.update(reference, {
      status: "running", phase: "Validating authorized target", progress: 1,
      findings: 0, assetsDiscovered: 0, _assets: [], _findings: [],
      workerId, leaseToken, leaseUntil,
      startedAt: latest.get("startedAt") || startedAt,
      ...(workerClaimedAt ? { workerClaimedAt } : {}),
      ...(clearError ? { error: clearError } : {}),
      ...(clearResultTools ? { resultTools: clearResultTools } : {}),
    });
    return { id: reference.id, ...data, workerId, leaseToken };
  });
}

function ipv4Number(ip) {
  if (isIP(ip) !== 4) return null;
  return ip.split(".").reduce((n, octet) => (n * 256 + Number(octet)) >>> 0, 0);
}

function parseCidr(value) {
  const [ip, bitsText] = value.split("/");
  const number = ipv4Number(ip);
  const bits = Number(bitsText);
  if (number === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { start: (number & mask) >>> 0, end: ((number & mask) | (~mask >>> 0)) >>> 0, bits };
}

function isIpAllowed(ip, cidrs) {
  const value = ipv4Number(ip);
  return value !== null && cidrs.some(range => value >= range.start && value <= range.end);
}

function normalizeTarget(raw) {
  if (typeof raw !== "string" || raw.length > 253 || !raw.trim()) throw new Error("Target is required.");
  let value = raw.trim();
  let urlPort;
  if (value.includes("://")) {
    let url;
    try { url = new URL(value); } catch { throw new Error("Target URL is invalid."); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new Error("Only credential-free HTTP(S) target URLs are supported.");
    }
    if (url.port) urlPort = Number(url.port);
    value = url.hostname;
  }
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
  if (isIP(value)) return { kind: "ip", value, urlPort };
  const cidr = parseCidr(value);
  if (cidr) return { kind: "cidr", value, cidr, urlPort };
  if (value.includes("/") || value.includes(":") || value.length > 253) throw new Error("Target must be a domain, IPv4 address, or IPv4 CIDR.");
  const host = value.toLowerCase().replace(/\.$/, "");
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) {
    throw new Error("Target hostname is invalid.");
  }
  return { kind: "domain", value: host, urlPort };
}

export function validateScanInput(data, { allowedTargets, maxHosts = MAX_HOSTS } = {}) {
  if (!data || typeof data !== "object") throw new Error("Scan request is invalid.");
  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name || name.length > 100) throw new Error("Scan name must be between 1 and 100 characters.");
  if (data.authorizationAcknowledged !== true) throw new Error("Explicit authorization acknowledgement is required.");
  if (!SAFE_SCAN_TYPES.has(data.scanType)) throw new Error("This scan type is not supported by the configured worker.");
  if (data.scheduleInterval && data.scheduleInterval !== "none") {
    throw new Error("Scheduled scans are not supported by this worker.");
  }
  if (!Array.isArray(allowedTargets) || allowedTargets.length === 0) {
    throw new Error("The worker has no configured target allowlist.");
  }
  if (!Number.isInteger(maxHosts) || maxHosts < 1) throw new Error("Worker host limit must be a positive integer.");
  maxHosts = Math.min(MAX_HOSTS, maxHosts);
  const target = normalizeTarget(data.target);
  const domainEntries = allowedTargets.filter(x => typeof x === "string" && !x.includes("/") && isIP(x) === 0);
  const domains = domainEntries.map(x => x.toLowerCase().replace(/\.$/, ""));
  const cidrs = allowedTargets
    .filter(x => typeof x === "string" && x.includes("/")).map(parseCidr).filter(Boolean);
  for (const address of allowedTargets.filter(x => typeof x === "string" && isIP(x) === 4)) {
    const value = ipv4Number(address);
    cidrs.push({ start: value, end: value, bits: 32 });
  }
  if (target.kind === "domain" && !domains.some(allowed => target.value === allowed || target.value.endsWith(`.${allowed}`))) {
    throw new Error("Target hostname is not in the configured allowlist.");
  }

  let ports = data.ports;
  if (data.ports !== undefined) {
    if (!Array.isArray(data.ports) || !data.ports.length || data.ports.length > MAX_PORTS ||
        data.ports.some(p => !Number.isInteger(p) || p < 1 || p > 65535)) {
      throw new Error(`Ports must contain 1-${MAX_PORTS} integers from 1 to 65535.`);
    }
    ports = [...new Set(data.ports)];
  }
  if (target.urlPort !== undefined) {
    ports = [...new Set([...(ports || []), target.urlPort])];
    if (ports.length > MAX_PORTS) throw new Error(`Ports must contain at most ${MAX_PORTS} values.`);
  }
  const rate = data.rate === undefined ? MAX_RATE : data.rate;
  if (!Number.isInteger(rate) || rate < 1 || rate > MAX_RATE) throw new Error(`Scan rate must be between 1 and ${MAX_RATE} packets per second.`);

  return {
    name,
    scanType: data.scanType,
    target: target.value,
    targetKind: target.kind,
    targetCidr: target.cidr,
    authorizationAcknowledged: true,
    ports,
    rate,
    allowedDomains: domains,
    allowedCidrs: cidrs,
    maxHosts,
  };
}

export async function resolveAuthorizedTargets(input, resolve = lookup) {
  let addresses;
  if (input.targetKind === "cidr") {
    const { start, end, bits } = input.targetCidr;
    const count = Math.min(2 ** (32 - bits), input.maxHosts + 1);
    if (count > input.maxHosts) throw new Error(`CIDR exceeds the ${input.maxHosts}-host limit.`);
    addresses = Array.from({ length: count }, (_, i) => {
      const n = (start + i) >>> 0;
      return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
    });
    if (!input.allowedCidrs.some(range => start >= range.start && end <= range.end)) {
      throw new Error("CIDR is not fully contained by a configured allowlist range.");
    }
  } else if (input.targetKind === "ip") {
    addresses = [input.target];
    if (!isIpAllowed(input.target, input.allowedCidrs)) throw new Error("IP address is not in the configured allowlist.");
  } else {
    const resolved = await resolve(input.target, { all: true, verbatim: true });
    addresses = [...new Set(resolved.map(item => item.address))];
    if (!addresses.length) throw new Error("Target hostname did not resolve to any address.");
    if (addresses.length > input.maxHosts) throw new Error(`Resolved target exceeds the ${input.maxHosts}-host limit.`);
    if (addresses.some(address => isIP(address) !== 4)) throw new Error("Only IPv4-resolved targets are supported.");
    if (addresses.some(address => !isIpAllowed(address, input.allowedCidrs) && isNonPublicIpv4(address))) {
      throw new Error("Hostname resolves to a non-public address that is not explicitly in the worker allowlist.");
    }
  }
  return addresses;
}

function isNonPublicIpv4(ip) {
  const ranges = [
    "0.0.0.0/8",
    "10.0.0.0/8",
    "100.64.0.0/10",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "172.16.0.0/12",
    "192.0.0.0/24",
    "192.0.2.0/24",
    "192.88.99.0/24",
    "192.168.0.0/16",
    "198.18.0.0/15",
    "198.51.100.0/24",
    "203.0.113.0/24",
    "224.0.0.0/4",
    "240.0.0.0/4",
  ];
  return ranges.some(range => {
    const parsed = parseCidr(range);
    return parsed !== null && isIpAllowed(ip, [parsed]);
  });
}

function xmlUnescape(value = "") {
  return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

export function parseNmapXml(xml, scanId, now = new Date().toISOString()) {
  if (typeof xml !== "string" || !xml.includes("<nmaprun") || !xml.includes("</nmaprun>")) {
    throw new Error("Nmap did not return a complete XML result.");
  }
  const assets = [];
  const findings = [];
  for (const hostMatch of xml.matchAll(/<host\b[^>]*>([\s\S]*?)<\/host>/g)) {
    const body = hostMatch[1];
    const status = body.match(/<status\b[^>]*state="([^"]+)"/)?.[1];
    if (status && status !== "up") continue;
    const ipv4 = body.match(/<address\b[^>]*addr="([^"]+)"[^>]*addrtype="ipv4"/)?.[1];
    const hostname = xmlUnescape(body.match(/<hostname\b[^>]*name="([^"]+)"/)?.[1] || ipv4 || "");
    if (!hostname) continue;
    const ports = [];
    for (const match of body.matchAll(/<port\b[^>]*portid="(\d+)"[^>]*>([\s\S]*?)<\/port>/g)) {
      const state = match[2].match(/<state\b[^>]*state="(open|filtered)"/)?.[1];
      if (!state) continue;
      const port = Number(match[1]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
      const service = match[2].match(/<service\b[^>]*name="([^"]+)"[^>]*\/?>/)?.[1] || "unknown";
      const product = match[2].match(/<service\b[^>]*product="([^"]+)"/)?.[1];
      const version = match[2].match(/<service\b[^>]*version="([^"]+)"/)?.[1];
      ports.push({ port, service: xmlUnescape(service), state, ...(product || version ? { version: [product, version].filter(Boolean).map(xmlUnescape).join(" ") } : {}) });
    }
    assets.push({
      id: randomUUID(), scanId, name: hostname, host: hostname, ...(ipv4 ? { ipAddress: ipv4 } : {}),
      type: ports.some(port => [80, 443, 8080, 8443].includes(port.port)) ? "Web" : "Service",
      riskScore: 0, status: "active", ports, technologies: [],
      discoveredAt: now,
    });
  }
  return { assets, findings };
}

export function parseNucleiJsonl(output, assets, scanId, now = new Date().toISOString()) {
  const byHost = new Map();
  for (const asset of assets) {
    byHost.set(asset.host.toLowerCase(), asset);
    if (asset.ipAddress) byHost.set(asset.ipAddress, asset);
  }
  const findings = [];
  for (const line of String(output || "").split(/\r?\n/).filter(Boolean)) {
    let item;
    try { item = JSON.parse(line); } catch { continue; }
    const host = String(item.host || item['matched-at'] || "").replace(/^https?:\/\//, "").split("/")[0].split(":")[0].toLowerCase();
    const asset = byHost.get(host) || assets.find(a => a.host.toLowerCase() === host || a.ipAddress === host);
    if (!asset) continue;
    const info = item.info || {};
    const severity = String(info.severity || "").toLowerCase();
    if (!["critical", "high", "medium", "low"].includes(severity)) continue;
    const matcher = item['matcher-name'] || item['template-id'] || "Nuclei detection";
    const matchedUrl = String(item['matched-at'] || "");
    const portNumber = Number(matchedUrl.match(/:(\d+)(?:\/|$)/)?.[1]);
    const port = Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535 ? portNumber : undefined;
    const cveIds = info.classification?.["cve-id"];
    const cveCandidate = Array.isArray(cveIds) ? cveIds[0] : cveIds;
    const cve = typeof cveCandidate === "string" ? cveCandidate.slice(0, 100) : null;
    const references = (Array.isArray(info.reference) ? info.reference : typeof info.reference === "string" ? [info.reference] : [])
      .filter(reference => typeof reference === "string");
    const cvssValue = info.classification?.["cvss-score"];
    const cvss = Number(cvssValue);
    findings.push({
      id: randomUUID(), scanId, assetId: asset.id, assetName: asset.name,
      title: String(info.name || matcher).slice(0, 200), severity,
      description: String(info.description || item['matched-at'] || "Detection reported by Nuclei.").slice(0, 2000),
      cve,
      ...(cvssValue !== undefined && cvssValue !== null && Number.isFinite(cvss) ? { cvss } : {}),
      ...(port ? { port, ...((asset.ports || []).find(p => p.port === port)?.service ? { service: (asset.ports || []).find(p => p.port === port).service } : {}) } : {}),
      category: String(Array.isArray(info.tags) ? info.tags[0] || "Nuclei" : "Nuclei").slice(0, 100),
      references: references.slice(0, 5).map(reference => reference.slice(0, 500)),
      ...(typeof info.remediation === "string" ? { remediation: info.remediation.slice(0, 1000) } : {}),
      createdAt: now,
    });
  }
  return findings;
}

export function boundScanResults(assets, findings, maxBytes = MAX_RESULT_BYTES) {
  const boundedAssets = assets.map(asset => ({
    ...asset,
    ports: (asset.ports || []).slice(0, 20).map(port => ({
      ...port, service: String(port.service || "unknown").slice(0, 50),
      ...(port.version ? { version: String(port.version).slice(0, 150) } : {}),
      ...(port.banner ? { banner: String(port.banner).slice(0, 150) } : {}),
    })),
  }));
  const boundedFindings = findings.slice(0, 200).map(finding => ({
    ...finding,
    title: String(finding.title).slice(0, 200),
    ...(finding.assetName ? { assetName: String(finding.assetName).slice(0, 253) } : {}),
    ...(finding.service ? { service: String(finding.service).slice(0, 50) } : {}),
    ...(finding.category ? { category: String(finding.category).slice(0, 100) } : {}),
    ...(typeof finding.cve === "string" ? { cve: finding.cve.slice(0, 100) } : {}),
    ...(finding.description ? { description: String(finding.description).slice(0, 1200) } : {}),
    ...(finding.remediation ? { remediation: String(finding.remediation).slice(0, 1000) } : {}),
    references: (Array.isArray(finding.references) ? finding.references : []).slice(0, 5).map(reference => String(reference).slice(0, 500)),
  }));
  let truncated = boundedAssets.some((asset, i) => (assets[i].ports || []).length > 20) || findings.length > 200;
  const size = () => {
    const severityScores = { critical: 100, high: 80, medium: 60, low: 30 };
    for (const asset of boundedAssets) {
      asset.riskScore = boundedFindings
        .filter(finding => finding.assetId === asset.id)
        .reduce((score, finding) => Math.max(score, severityScores[finding.severity] || 0), 0);
    }
    return Buffer.byteLength(JSON.stringify({ assets: boundedAssets, findings: boundedFindings }));
  };
  while (size() > maxBytes && boundedFindings.length) {
    boundedFindings.pop();
    truncated = true;
  }
  while (size() > maxBytes && boundedAssets.length) {
    const removed = boundedAssets.pop();
    const remainingIds = new Set(boundedAssets.map(asset => asset.id));
    for (let i = boundedFindings.length - 1; i >= 0; i--) {
      if (boundedFindings[i].assetId === removed.id || !remainingIds.has(boundedFindings[i].assetId)) boundedFindings.splice(i, 1);
    }
    truncated = true;
  }
  size();
  return { assets: boundedAssets, findings: boundedFindings, truncated };
}

export function nmapArgs(targets, ports, rate) {
  return ["-n", "-Pn", "-sT", "-sV", "--version-light", "-T2", "--max-rate", String(rate),
    ...(ports?.length ? ["-p", ports.join(",")] : ["--top-ports", "100"]), "-oX", "-", "--", ...targets];
}

export function nucleiArgs(targets, hostHeader, rate = MAX_RATE) {
  return ["-jsonl", "-silent", "-no-interactsh", "-severity", "info,low,medium", "-tags", "misconfig",
    "-exclude-tags", "dos,fuzz,bruteforce,intrusive", "-rl", String(Math.min(MAX_RATE, rate)), "-timeout", "5",
    "-retries", "0", ...(hostHeader ? ["-H", `Host: ${hostHeader}`] : []),
    ...targets];
}

export async function executeScan(scan, { runTool, onProgress, shouldStop, heartbeat = async () => {}, resolveTarget = lookup }) {
  if (await shouldStop()) return { state: "cancelled", reason: "Scan cancelled before tools started." };
  const targets = await resolveAuthorizedTargets(scan, resolveTarget);
  if (await shouldStop()) return { state: "cancelled", reason: "Scan cancelled during target resolution." };
  await onProgress(10, "Nmap port/service discovery");
  let nmap;
  try {
    nmap = await runTool("nmap", nmapArgs(targets, scan.ports, scan.rate), { shouldStop, heartbeat });
  } catch (error) {
    return { state: "failed", error: `Nmap failed: ${error.message}` };
  }
  if (await shouldStop()) return { state: "cancelled", reason: "Scan stopped during Nmap." };
  let parsed;
  try { parsed = parseNmapXml(nmap.stdout, scan.id); } catch (error) {
    return { state: "failed", error: error.message };
  }
  if (nmap.code !== 0) return parsed.assets.length
    ? { state: "partial", tools: ["nmap"], error: `Nmap exited with code ${nmap.code}.`, ...parsed }
    : { state: "failed", error: `Nmap exited with code ${nmap.code}.` };
  if (await shouldStop()) return { state: "cancelled", reason: "Scan cancelled after Nmap.", ...parsed };
  const webTargets = parsed.assets.flatMap(asset => (asset.ports || [])
    .filter(port => port.state === "open" && (/https?/i.test(port.service) || [80, 443, 8080, 8443].includes(port.port)))
    .map(port => `${/https/i.test(port.service) || [443, 8443].includes(port.port) ? "https" : "http"}://${asset.ipAddress || asset.host}:${port.port}`));
  if (!webTargets.length || scan.scanType === "port") {
    return { state: "completed", tools: ["nmap"], assets: parsed.assets, findings: [] };
  }
  await onProgress(55, "Nuclei safe misconfiguration checks", parsed.assets.length);
  let nuclei;
  try { nuclei = await runTool("nuclei", nucleiArgs(webTargets, scan.targetKind === "domain" ? scan.target : undefined, scan.rate), { shouldStop, heartbeat }); }
  catch (error) { return parsed.assets.length ? { state: "partial", tools: ["nmap"], error: `Nuclei failed: ${error.message}`, ...parsed } : { state: "failed", error: `Nuclei failed: ${error.message}` };   }
  if (await shouldStop()) return { state: "cancelled", reason: "Scan stopped during Nuclei.", ...parsed };
  const findings = parseNucleiJsonl(nuclei.stdout, parsed.assets, scan.id);
  if (nuclei.code !== 0) return parsed.assets.length || findings.length
    ? { state: "partial", tools: findings.length ? ["nmap", "nuclei"] : ["nmap"], error: `Nuclei exited with code ${nuclei.code}.`, assets: parsed.assets, findings }
    : { state: "failed", error: `Nuclei exited with code ${nuclei.code}.` };
  return { state: "completed", tools: ["nmap", "nuclei"], assets: parsed.assets, findings };
}

export async function processClaimedScan(scan, { repository, runTool, onProgress = async () => {}, now = () => Date.now(), resolveTarget = lookup }) {
  const started = now();
  const stop = async () => {
    const control = await repository.getControl(scan.id);
    if (control === "pause") {
      await repository.setState(scan.id, "paused", { phase: "Paused", controlRequest: null });
      return true;
    }
    if (control === "cancel") {
      await repository.setState(scan.id, "cancelled", { phase: "Cancelled", controlRequest: null, completedAt: new Date() });
      return true;
    }
    return false;
  };
  try {
    const result = await executeScan(scan, {
      runTool,
      shouldStop: stop,
      onProgress: async (progress, phase, assetsDiscovered) => {
        await repository.progress(scan.id, { progress, phase, ...(assetsDiscovered === undefined ? {} : { assetsDiscovered }) });
        await onProgress(progress, phase);
      },
      heartbeat: repository.heartbeat ? () => repository.heartbeat(scan.id) : async () => {},
      resolveTarget,
    });
    if (result.state === "cancelled") return;
    const durationSeconds = Math.max(0, Math.floor((now() - started) / 1000));
    if (result.state === "completed" || result.state === "partial") {
      const bounded = boundScanResults(result.assets || [], result.findings || []);
      const assets = bounded.assets;
      const findings = bounded.findings;
      const finalState = bounded.truncated && result.state === "completed" ? "partial" : result.state;
      const error = [result.error, bounded.truncated ? "Result storage limit reached; only a subset of actual tool output was retained." : ""]
        .filter(Boolean).join(" ");
      await repository.setState(scan.id, finalState, {
        progress: 100,
        phase: finalState === "completed" ? "Completed" : "Partial results",
        findings: findings.length,
        assetsDiscovered: assets.length,
        duration: `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`,
        _assets: assets,
        _findings: findings,
        resultTools: result.tools,
        ...(error ? { error } : {}),
        completedAt: new Date(),
      });
    } else {
      await repository.setState(scan.id, "failed", {
        phase: "Failed", progress: 0, error: result.error || "Scan failed before usable tool output was received.",
        duration: `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`, completedAt: new Date(),
      });
    }
  } catch (error) {
    await repository.setState(scan.id, "failed", {
      phase: "Failed", error: error.message || "Worker failure.", completedAt: new Date(),
    });
  }
}
