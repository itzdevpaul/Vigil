# Vigil Security Platform

Vigil is a React/Vite dashboard backed by Firebase Authentication and Firestore. Scan jobs are queued in Firestore and executed by a separately deployed Node worker using Nmap and Nuclei. The Express provider proxy is also a separate service; the Vercel configuration serves the SPA and does not deploy either backend.

## Local development

Install dependencies with `npm ci`, then run `npm run dev` to start Vite and the Express proxy. Configure the Firebase web-app `VITE_FIREBASE_*` settings for the client. The proxy requires Firebase Admin Application Default Credentials and a matching `FIREBASE_PROJECT_ID`. API calls require a Firebase ID token from a verified account.

Run offline tests with `npm test`; create a production frontend bundle with `npm run build`. Scanner tests use fixtures and mocks and do not make network connections.

## Production deployment

Deploy the Vercel SPA, authenticated Express proxy, and Docker scan worker as separate services. Configure a same-origin proxy/rewrite for `/api/*` to Express, set `VIGIL_ALLOWED_ORIGINS` to the exact browser origins, and configure least-privilege Firebase Admin credentials. Deploy [firestore.rules](./firestore.rules) before enabling scan creation or integration storage.

Provider credentials must be server-only environment variables: `SHODAN_API_KEY`, `CENSYS_API_KEY`, `VIRUSTOTAL_API_KEY`, and `QUALYSYS_API_KEY`. Never use `VITE_` prefixes for provider secrets. **Any provider keys previously present in repository configuration must be revoked and replaced by an operator before deployment.** Removing tracked values does not invalidate exposed credentials.

## Server-side scan worker

Scan jobs are queued in each user's Firestore `scans` collection. The browser cannot write scan progress, assets, or findings. The worker claims jobs transactionally and runs Nmap/Nuclei; an expired worker lease is recorded as failed instead of being reported as success.

### Docker Compose setup

1. Configure Firebase Admin Application Default Credentials for the project. Locally, use `GOOGLE_APPLICATION_CREDENTIALS`; in production, prefer workload identity or an attached service account to a downloaded key.
2. Set `FIREBASE_PROJECT_ID` and `VIGIL_SCAN_ALLOWED_TARGETS`, a comma-separated list of authorized exact hostnames/domain suffixes and/or IPv4 CIDRs (for example, `assets.example.test,192.0.2.0/24`). A domain entry also permits its subdomains. Only add targets for which the operator has verified written authorization.
3. Run `docker compose -f compose.scan-worker.yaml up --build -d`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VIGIL_SCAN_MAX_HOSTS` | `256` | Maximum number of hosts (hard-capped at 256); CIDRs must be fully inside an allowlisted range. |
| `VIGIL_SCAN_POLL_MS` | `3000` | Queue polling delay. |
| `WORKER_ID` | `compose-worker` | Worker instance label. |

The worker and web app must use the same Firebase project. Firestore rules must be deployed before scan creation. Admin SDK writes bypass Firestore rules and remain server-owned. The worker publishes a read-only heartbeat for dashboard status.

### Authorization, behavior, and limits

Users must acknowledge authorization when creating a scan. The worker independently validates each job and requires the operator-configured allowlist. Hostnames are resolved server-side; private, link-local, and other non-public IPv4 results are rejected unless explicitly included in the worker's IP/CIDR allowlist. Only IPv4 hosts/CIDRs are supported. CIDRs exceeding the host bound, unsupported scan types, scheduled jobs, unsafe port lists, and rates outside 1–50 packets/second are rejected.

The worker supports **Full Infrastructure**, **Port Scan**, and **Vulnerability Scan** jobs. Nmap uses TCP connect scanning, light service detection, a top-100 port default, low timing, and a bounded packet rate. Nuclei runs only on web services Nmap found, with low/medium/info misconfiguration templates; intrusive, fuzz, DoS, and brute-force tags are excluded, and OAST/interactsh is disabled. Templates are installed during image build and should be refreshed by rebuilding the image. These are active network requests: do not run the worker without a reviewed allowlist and written permission for every target.

Progress is updated at real phase boundaries, not estimated by a browser timer. Completion requires successful scanner output. Setup/validation failures are **failed**; a later tool failure after useful Nmap output is **partial** and retains only parsed scanner output. Results are size-bounded and truncation is marked partial. Pause/cancel requests are handled between tools and while they run; pausing stops the process and a resumed scan reruns it. Without a deployed worker, jobs remain queued. Scheduled scans are intentionally disabled.

Legacy browser-generated results have no worker provenance. The dashboard hides legacy assets/findings and marks legacy completed or unclaimed running/paused scans as unverified failures rather than presenting them as scanner evidence.

Run focused offline scanner tests with `npm run test:worker`; tests use fixtures and mocked tools and never scan a network target.

## Authenticated provider API proxy

Every actual Express `/api/*` request, including `/api/health`, requires a Firebase ID token from an email-verified account in the `Authorization` request header. CORS allows only origins listed in `VIGIL_ALLOWED_ORIGINS`. Development defaults allow localhost Vite origins; production has no defaults and must be configured explicitly. Browser preflight requests are answered before authentication.

Firestore rules also require the Firebase `email_verified` claim for scan creation/control, report updates, invites, alert writes, and risk-history/notification-setting writes. Client account changes reload the Firebase user and force-refresh its ID token before protected operations.

Use Firebase Admin credentials for the same project as the web app, via Application Default Credentials locally or workload identity in production; optionally set `FIREBASE_PROJECT_ID`. The proxy reports only whether each provider key is configured. It applies an in-memory limit of 60 requests per user per minute, bounded to 10,000 user windows per process. Counters reset on restart and are not shared across instances. Proxy failures omit upstream exception details and credential material.

## Integration secret storage

Integration keys and webhook URLs are submitted to the authenticated Express API and encrypted with AES-256-GCM before persistence in the server-only `integrationSecrets` collection. Responses contain configuration metadata and only the last four characters. These credentials are not currently used to connect to external services.

Before enabling this feature, configure server-only `VIGIL_INTEGRATION_ENCRYPTION_KEY` as either 64 hexadecimal characters or canonical base64 representing exactly 32 bytes. Generate it through the deployment secret manager (for example, `openssl rand -base64 32`); do not commit or log it. Storage fails closed if the key is missing or invalid. Losing the key makes credentials unrecoverable; rotation requires a separately planned re-encryption operation.

Legacy migration is an operator action. Deploy the updated Firestore rules first; client access to both `integrations` and `integrationSecrets` is denied. Then deploy the proxy with Firebase Admin credentials and the encryption key. For each account to retain existing credentials, make an authenticated `POST /api/integrations/migrate-legacy` request using that account's Firebase ID token (no body is needed). The endpoint migrates only that verified owner's known legacy documents, atomically writes encrypted records and removes legacy secret fields, and returns metadata only. Malformed records fail without partial changes; handle them through a controlled server-admin process rather than restoring client access.

## Current capability boundaries

In-app invites create records but do not send email. Notification settings are preferences; automated alert and digest delivery is not configured. Integration credentials are encrypted but are not connected to external services. Two-factor authentication and API-key management are not available. See [firestore.rules](./firestore.rules) for client access boundaries.
