# Code Guardian Service

Backend service wrapping the Trivy scanner. Takes a GitHub repo URL, scans it in the background, and exposes only CRITICAL vulnerabilities. Must survive 500MB+ Trivy reports in a 256MB pod.

## Stack
- Node.js v24 (`.nvmrc`), ESM (`"type": "module"`), TypeScript strict
- Express (plain, minimal)
- Trivy runs in Docker (`aquasec/trivy`), never installed on the host
- Test target: our NodeGoat fork, https://github.com/Shnyrkevich/NodeGoat (upstream: OWASP/NodeGoat)

## Hard rules
- NEVER use `fs.readFile`/`readFileSync` or `JSON.parse` on Trivy output. Use stream pipelines (`stream-json`, `stream/promises` `pipeline`).
- No `any`. Use explicit interfaces or `unknown` plus narrowing.
- Always delete the cloned repo and the report file in `finally`.
- Validate the repo URL (https GitHub only) and pass args to `spawn`/`execFile` as arrays, never via a shell string.
- Handle Trivy non-zero exit, clone failure, timeouts, and `ENOSPC` by setting scan status `Failed` with a message.

## Layout
- `src/controllers/` REST layer: HTTP only (Express handlers)
- `src/graphql/` GraphQL layer (`schema.ts`, `resolvers.ts`, `handler.ts`), mounted at `/graphql`. Like the controllers it only translates requests; all logic stays in `ScanService`.
- `src/services/` business logic: scan lifecycle, scan store (Redis), report stream parser
- `src/workers/` job handlers only: BullMQ worker (`scan.worker.ts`) and the scan pipeline (`scan.processor.ts`)
- `src/queue/` BullMQ producer (`scan.queue.ts`)
- `src/clients/` adapters for external tools: git, Trivy (Docker)
- `src/utils/` generic helpers: `run-command`, repo URL validation
- `src/infra/` connection setup (Redis); `src/types/` shared interfaces
- `web/` separate React + Vite + TypeScript app (own `package.json`): one page, `graphql-request` client. Up to 5 scans at once, each a card; all running scans are polled together in ONE aliased GraphQL query every 2s (`useScans.ts`). Dev server proxies `/graphql` to the backend (`API_TARGET`, default http://localhost:3000). In Docker it is built into an nginx image (`web/Dockerfile`, `web/nginx.conf`) that serves the page and forwards `/graphql` to the `app` service (http://localhost:8080, `WEB_PORT`).
- `test/unit/`, `test/e2e/`, `test/support/` (test doubles), `test/tools/` (big-report generator, OOM check). Tests never live in `src/`; they compile via `tsconfig.test.json` into `.test-build/`.

## Commands
- `npm run build` compile to `dist/`
- `npm start` run `dist/index.js`
- `npm run start:oom` run with `node --max-old-space-size=150 dist/index.js` (OOM self-test)
- `npm test` unit tests; `npm run test:e2e` needs Redis + Docker + network
- `npm run gen:report -- <file> [sizeMb]` / `npm run oom:check -- <file>` big-report OOM proof
- `npm run web:install` then `npm run web:dev` (page on http://localhost:5173); `npm run web:build` typechecks and builds it
- `docker compose up -d --build` runs web (nginx), app (`mem_limit: 200m`), redis and trivy-init; open http://localhost:8080

## Scan statuses
`Queued` -> `Scanning` -> `Finished` | `Failed`
