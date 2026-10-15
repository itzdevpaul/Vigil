export interface SearchableScan {
  id: string;
  name: string;
  target: string;
  status: string;
  scanType: string;
  _assets?: { id: string; name: string; host: string }[];
  _findings?: {
    id: string;
    title: string;
    severity: string;
    assetId: string;
    assetName?: string;
    cve?: string | null;
    description?: string;
  }[];
}

export interface GlobalSearchResult {
  id: string;
  kind: "scan" | "asset" | "finding";
  title: string;
  description: string;
  href: string;
  searchText: string;
}

export function filterScans<T extends { status: string; scanType: string }>(
  scans: T[],
  statusFilter: string,
  scanTypeFilter: string,
): T[] {
  return scans.filter(scan =>
    (statusFilter === "all" || scan.status === statusFilter) &&
    (scanTypeFilter === "all" || scan.scanType === scanTypeFilter),
  );
}

export function searchUserScans(queryText: string, scans: SearchableScan[]): GlobalSearchResult[] {
  const query = queryText.trim().toLocaleLowerCase();
  if (!query) return [];

  const results: GlobalSearchResult[] = [];
  for (const scan of scans) {
    results.push({
      id: `scan:${scan.id}`,
      kind: "scan",
      title: scan.name || scan.target,
      description: `Scan · ${scan.status} · ${scan.target}`,
      href: "/monitoring",
      searchText: `${scan.name} ${scan.target} ${scan.status} ${scan.scanType}`,
    });
    for (const asset of scan._assets ?? []) {
      results.push({
        id: `asset:${scan.id}:${asset.id}`,
        kind: "asset",
        title: asset.name || asset.host,
        description: `Asset · ${asset.host}`,
        href: asset.id ? `/assets/${encodeURIComponent(asset.id)}` : "/assets",
        searchText: `${asset.name} ${asset.host}`,
      });
    }
    for (const finding of scan._findings ?? []) {
      results.push({
        id: `finding:${scan.id}:${finding.id}`,
        kind: "finding",
        title: finding.title,
        description: `Finding · ${finding.severity}${finding.assetName ? ` · ${finding.assetName}` : ""}`,
        href: finding.assetId ? `/assets/${encodeURIComponent(finding.assetId)}` : "/monitoring",
        searchText: `${finding.title} ${finding.severity} ${finding.assetName ?? ""} ${finding.cve ?? ""} ${finding.description ?? ""}`,
      });
    }
  }

  return results.filter(result => result.searchText.toLocaleLowerCase().includes(query));
}
