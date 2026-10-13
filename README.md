# Code Guardian Service

Backend service that wraps the [Trivy](https://trivy.dev) scanner. Give it a GitHub repository URL: it scans the repository in the background and returns only the **CRITICAL** vulnerabilities.

The point of the design is memory safety. A Trivy report can be hundreds of megabytes, so it is never loaded into memory: it is read from disk as a **stream** and filtered object by object. The service has been run under a 150 MB Node heap and inside a 200 MB container.

- **API:** REST (`/api/scan`) and GraphQL (`/graphql`), both served by the same service code.
- **Queue:** BullMQ on Redis, so queued and running scans survive a crash or restart.
- **Scanner:** Trivy runs as a throwaway Docker container per scan.
- **UI:** a small React page that starts up to 5 scans and shows each as a card (`web/`).

## How it works

```
POST /api/scan ──► validate URL ──► scan record (Queued) + job in Redis ──► 202 { scanId, status: "Queued" }

BullMQ worker (same process), per job:
  1. git clone --depth 1          → <SCAN_WORK_DIR>/<scanId>/repo        (one at a time, see Concurrency)
  2. docker run aquasec/trivy     → <SCAN_WORK_DIR>/<scanId>/report.json (can be 500 MB+)
  3. stream report.json           → keep only CRITICAL → Redis in batches of 500
  4. status Finished (or Failed), then delete <SCAN_WORK_DIR>/<scanId>

GET /api/scan/:scanId  or  GraphQL scan(id)  →  status, and the criticals once Finished
```

**The stream** (`src/services/report-parser.ts`):

```
file → stream-json tokenizer → pick Results.*.Vulnerabilities.* → assemble ONE vulnerability
     → filter Severity == CRITICAL → batch of 500 → Redis
```

Memory depends on the size of one vulnerability, not on the file. The batch sink waits for Redis, so a slow Redis slows the disk read instead of piling data up in memory. There is no `readFile` and no `JSON.parse` on the report. (`JSON.parse` appears once, in `redis-scan.store.ts`, to read back our own small records from Redis.)

**Code layout**

| Folder | Role |
|---|---|
| `src/controllers/` | REST layer (HTTP only) |
| `src/graphql/` | GraphQL layer (schema, resolvers, handler) |
| `src/services/` | Scan lifecycle, scan store (Redis), report stream parser |
| `src/workers/` | Job handlers: the BullMQ worker and the scan pipeline |
| `src/queue/` | BullMQ producer |
| `src/clients/` | Adapters for external tools: git, Trivy (Docker) |
| `src/utils/` | Helpers: command runner, URL validation, semaphore, directory cleanup |
| `web/` | React + Vite page (own `package.json`) |
| `test/` | Unit tests, e2e, test doubles, big-report generator and memory check |

## Prerequisites

- Node.js 24 (`.nvmrc`; run `nvm use`)
- Docker (Trivy and Redis run in containers) and network access to pull images and clone repositories

## Run in dev mode

The API runs on your machine; Redis and the Trivy database run in Docker.

```bash
nvm use                                    # Node 24
npm install
cp .env.example .env                       # optional: every value has a default

docker compose up -d redis trivy-init      # Redis + one-shot download of the Trivy vulnerability DB

npm run build
node --env-file=.env dist/index.js         # API on http://localhost:3000 (REST + GraphQL)
```

While editing code, run `npm run dev` in a second terminal (TypeScript watch mode), and restart the server after a rebuild.

To run with the strict heap limit from the task: `npm run start:oom`.

The web page (second terminal):

```bash
npm run web:install                        # once
npm run web:dev                            # http://localhost:5173, forwards /graphql to http://localhost:3000
```

Use `API_TARGET=http://localhost:3101 npm run web:dev` to point the page at another backend.

## Run in Docker

Starts the web page (nginx), the API with a **200 MB memory limit**, Redis and the Trivy DB warm-up:

```bash
docker compose up -d --build
```

| What | Where |
|---|---|
| Web page | http://localhost:8080 (`WEB_PORT`) |
| API (REST and `/graphql`) | http://localhost:3000 (`APP_PORT`) |

If a port is taken, set it: `WEB_PORT=8085 APP_PORT=3100 docker compose up -d --build`. Stop everything with `docker compose down` (add `-v` to also delete the Redis data and the Trivy DB cache).

The API container starts Trivy with `docker run`, so it gets the Docker socket and the scan folder mounted at the same path as on the host (`SCAN_HOST_DIR`, default `/tmp/code-guardian`). See *Known limitations* for the security trade-off. Compose also sets `memswap_limit: 200m`, so the limit cannot be hidden by swapping.

## Try it

REST:

```bash
curl -s -X POST localhost:3000/api/scan -H 'content-type: application/json' \
  -d '{"repoUrl":"https://github.com/Shnyrkevich/NodeGoat"}'
# {"scanId":"…","status":"Queued"}          ← returns immediately

curl -s localhost:3000/api/scan/<scanId>
# status: Queued | Scanning | Finished | Failed. When Finished: criticalCount, truncated, criticalVulnerabilities
# Page the results with ?limit=…&offset=… (default 1000, max 5000)
```

GraphQL (`POST /graphql`):

```bash
curl -s localhost:3000/graphql -H 'content-type: application/json' \
  -d '{"query":"mutation { startScan(repoUrl: \"https://github.com/Shnyrkevich/NodeGoat\") { id status } }"}'

curl -s localhost:3000/graphql -H 'content-type: application/json' \
  -d '{"query":"{ scan(id: \"<scanId>\") { status criticalCount criticalVulnerabilities(limit: 5) { id pkgName fixedVersion } } }"}'
```

`criticalVulnerabilities` is `null` until the scan is `Finished`, and Redis is read for it only when the query asks for it. Invalid input returns `400` (REST) or `BAD_USER_INPUT` (GraphQL); a queue outage returns `503` or `SERVICE_UNAVAILABLE`.

For NodeGoat, expect `Finished` with 12 criticals within a few seconds.

## Testing

Unit tests run on the host and need nothing else. The e2e tests start the built app and need Redis, Docker and network access.

```bash
npm test                                    # unit tests: error handling, parser, queue pieces, GraphQL, semaphore
docker compose up -d redis trivy-init       # needed for e2e
npm run test:e2e                            # REST + GraphQL against real Redis, Docker, and the NodeGoat fork
```

Stop the Compose `app` container before `test:e2e` (`docker compose stop app`). Both would consume the same Redis queue, and the container could take the test's jobs.

**Test in Docker mode**

```bash
# 1. Check that the limit is applied (expect 209715200 for both)
docker inspect code-guardian-app --format 'mem={{.HostConfig.Memory}} swap={{.HostConfig.MemorySwap}}'

# 2. Run a scan (see "Try it") and watch memory in another terminal
docker stats code-guardian-app
docker logs -f code-guardian-app

# 3. Check that nothing was killed, and that the work folder is clean
docker inspect code-guardian-app --format 'OOMKilled={{.State.OOMKilled}} restarts={{.RestartCount}}'
ls -A /tmp/code-guardian                    # empty when no scan is running
docker ps -a --filter name=trivy-           # no leftover trivy-<scanId> containers

# 4. Concurrency: queue several scans at once (or use the web page) and watch the states
for i in 1 2 3 4 5; do
  curl -s -X POST localhost:3000/api/scan -H 'content-type: application/json' \
    -d '{"repoUrl":"https://github.com/Shnyrkevich/NodeGoat"}'; echo
done
# open http://localhost:8080 to see the scans as cards

# 5. Memory proof: a 600 MB report parsed inside a 200 MB container
npm run gen:report -- /tmp/big.json 600     # ~629 MB, 394,176 vulnerabilities, 3,942 critical
npm test                                    # builds .test-build, used below
docker run --rm -m 200m --memory-swap 200m \
  -v "$PWD/.test-build":/app/.test-build:ro -v /tmp/big.json:/data/big.json:ro \
  code-guardian-service-app node --max-old-space-size=150 .test-build/test/tools/oom-check.js /data/big.json
# expect: scanned=394176 critical=3942, peak RSS around 140 MB. rm /tmp/big.json afterwards.
```

The same check without Docker: `npm run oom:check -- /tmp/big.json` (150 MB heap).

## Concurrency and clone parallelism

Three settings control how much happens at once. All are environment variables (see the table below).

**1. Queue (BullMQ on Redis).** `POST` only stores the scan and adds a job, so it never waits for a scan. Jobs wait in Redis, so queued scans survive a restart. A job that was running when the process died is re-delivered once its lock expires (`LOCK_DURATION_MS`, about a minute), and the scan restarts from scratch. A failed scan is retried (`JOB_ATTEMPTS`) and becomes `Failed` only after the last attempt.

**2. Workers: `WORKER_CONCURRENCY`.** The number of scans processed at the same time by one process (1 by default, set to 4 in `docker-compose.yml`). Each scan is an async function, so these are not extra threads:

- Waiting on child processes (`git`, the Trivy container) overlaps well, so Trivy runs for different scans really do run in parallel, each in its own container.
- Parsing the report is JavaScript on a single thread, so parses take turns, one chunk at a time. Memory stays small either way (one vulnerability plus a batch of 500 per scan), but parsing does not speed up with more workers.
- Extra scans wait as `Queued`. While one big parse runs, `GET` requests stay fast (measured: slowest response 54 ms), because the work is cut into small chunks.

**3. Clone parallelism: `CLONE_CONCURRENCY` (default 1).** Cloning is the memory-heavy step, and `git` runs inside the API container, so its memory counts against the container's limit. Clones therefore **take turns**, even when several workers are running: a worker whose turn has not come waits at the clone step, while Trivy and parsing for other scans continue. The status of a waiting scan is `Scanning`. The clone timeout starts only when the clone starts.

Why it exists: without it, 4 workers cloning `microsoft/vscode` (about 400 MB each) at the same time made the kernel kill the 200 MB container (OOM kill, exit 137). With it, 5 vscode scans on 4 workers (and on 2 workers) finished with no restarts and no OOM events.

Limits of this protection:

- Peak container memory was still about 198 MB of 200 MB in those runs (it may include reclaimable file cache), so there is very little headroom.
- The gate is per process, not global. Several API instances on the same Redis each have their own gate.
- It does not limit Trivy's memory, because Trivy runs in its own container.

## Configuration

Every variable is optional. [.env.example](.env.example) lists them all with descriptions. The app does not read `.env` by itself: use `node --env-file=.env dist/index.js`. In Docker, the settings live in the `environment:` block of `docker-compose.yml`, not in `.env` (Compose uses `.env` only to fill `${...}` placeholders).

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | API port |
| `REDIS_URL` | `redis://localhost:6379` | Redis for the queue and scan state (`/N` selects the database) |
| `SCAN_WORK_DIR` | `.scan-work` | Where clones and reports go, one folder per scan. Emptied at startup. |
| `KEEP_WORK_FILES` | false | Debug: keep the clone and report after a scan |
| `WORKER_CONCURRENCY` | 1 (4 in Compose) | Scans processed at the same time |
| `CLONE_CONCURRENCY` | 1 | Clones allowed at the same time |
| `JOB_ATTEMPTS` | 2 | Tries per scan before it becomes `Failed` |
| `LOCK_DURATION_MS` | 60000 | How long a worker owns a job before it counts as stalled |
| `COMMAND_TIMEOUT_MS` | 900000 | Timeout for each `git clone` and each Trivy run |
| `MAX_CRITICALS` | 10000 | Criticals stored per scan; extras are counted and `truncated` is set |
| `BATCH_SIZE` | 500 | Criticals per Redis write while streaming |
| `SCAN_TTL_SECONDS` | 86400 | How long results stay in Redis |
| `TRIVY_IMAGE`, `TRIVY_CACHE_VOLUME` | `aquasec/trivy:latest`, `trivy-cache` | Trivy image and its DB cache volume |

Docker Compose placeholders: `APP_PORT`, `WEB_PORT`, `SCAN_HOST_DIR`, `APP_REDIS_URL`.

## Web page

`web/` is a small React page. It starts scans through the GraphQL API and polls every 2 seconds.

- Up to **5 scans** can be added at a time, each shown as a card with its status and results. This limit is for testing: it shows several workers processing at once while the rest wait as `Queued`.
- All running scans are polled together in one GraphQL request.
- Scans are **not stored in the UI**: after a page reload, the cards from the earlier session are gone (the service itself keeps results for 24 hours).
- The text of the testing notice assumes 4 workers (`DEMO_WORKERS` in `web/src/App.tsx`); keep it in sync with `WORKER_CONCURRENCY` in `docker-compose.yml`.

## Error handling

| Situation | What happens |
|---|---|
| Invalid or non-GitHub URL | Rejected up front (400), nothing is created. The URL is passed to `git` as an argument, never through a shell. |
| Clone or Trivy fails, or times out | The scan is retried, then `Failed` with a message. The whole process group is killed, so `git` helper processes do not keep running. |
| Trivy report is malformed or truncated | `Failed` at once (retrying would not help). |
| Disk full | `Failed`, and the work folder is deleted. |
| Process killed mid-scan | The job is re-delivered and restarts clean (old results and files are dropped first). |
| Redis down when a scan is requested | 503; nothing is half-created. |

The clone and the report are deleted after every scan, whether it succeeded or failed (`KEEP_WORK_FILES` is off by default).

## Known limitations

Gaps we are aware of. None break correctness on normal repositories; they are about resource limits and production hardening.

1. **No pre-check of repository size or free disk space.** The service clones first and fails if the disk fills up. A full disk (`ENOSPC`) is handled: the scan becomes `Failed` and its work folder is deleted. But a shallow clone of a huge repo needs roughly twice its size on disk, and nothing refuses it up front.
2. **The Trivy container has no memory limit.** Our Node process stays flat while streaming the report, but Trivy runs in its own container and builds the report there. A huge monorepo can use a lot of Trivy memory, and nothing caps it (no `docker run --memory`). The 200 MB budget applies to the API container, not to Trivy.
3. **`git clone` runs inside the API container**, so its memory counts against the 200 MB limit. The clone gate prevents the crash seen with parallel big clones, but a single very large clone can still use most of the budget. Running the clone in its own limited container would isolate it.
4. **A fixed 15-minute timeout per external step** (`COMMAND_TIMEOUT_MS`). It is one value for all repositories, so it may be too long for small repos and too short for very large ones.
5. **No cap on the report size on disk before parsing.** The parser handles any size in constant memory, but a very large report still uses disk and parse time (about 20 s per 600 MB measured). Only the first `MAX_CRITICALS` criticals are stored; the rest are counted and the scan is flagged `truncated`.
6. **The queue is unbounded and the API has no authentication or rate limit.** Anyone who can reach it can queue unlimited scans.
7. **A paused (not crashed) worker can be duplicated.** If a process freezes longer than the lock duration and then resumes, the job may be re-delivered while the first run is still going, and both write to the same results. Per-attempt result keys would fix it.
8. **The API container has the Docker socket mounted**, which gives it control of the host's Docker. This is acceptable for local use only. In Kubernetes a different Trivy integration is needed (a sidecar or the binary in the image).
9. **The scan folder is wiped at startup**, so it must belong to one process. Do not share `SCAN_WORK_DIR` between instances.
10. **The web page keeps no state across reloads**, and has no automated tests.
