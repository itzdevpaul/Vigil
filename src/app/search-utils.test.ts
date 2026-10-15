import assert from "node:assert/strict";
import test from "node:test";
import { filterScans, searchUserScans } from "./search-utils.ts";

const scans = [{
  id: "scan-1",
  name: "Production check",
  target: "example.org",
  status: "completed",
  scanType: "full",
  _assets: [{ id: "asset-1", name: "Web server", host: "www.example.org" }],
  _findings: [{
    id: "finding-1",
    title: "Missing security header",
    severity: "low",
    assetId: "asset-1",
    assetName: "Web server",
    description: "X-Frame-Options header is absent",
  }],
}];

test("search matches only scan, asset, and finding data supplied for the signed-in user", () => {
  assert.deepEqual(searchUserScans("EXAMPLE.ORG", scans).map(result => result.kind), ["scan", "asset"]);
  assert.equal(searchUserScans("security header", scans)[0]?.kind, "finding");
});

test("search results carry useful destinations and empty queries return no results", () => {
  assert.equal(searchUserScans("web server", scans)[0]?.href, "/assets/asset-1");
  assert.deepEqual(searchUserScans("   ", scans), []);
  assert.deepEqual(searchUserScans("not present", scans), []);
});

test("scan filters compose status and scan type", () => {
  const jobs = [
    { id: "1", status: "completed", scanType: "port" },
    { id: "2", status: "queued", scanType: "port" },
    { id: "3", status: "completed", scanType: "full" },
  ];
  assert.deepEqual(filterScans(jobs, "completed", "port").map(job => job.id), ["1"]);
  assert.deepEqual(filterScans(jobs, "all", "port").map(job => job.id), ["1", "2"]);
});
