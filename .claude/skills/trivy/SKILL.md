---
name: trivy
description: Run Trivy security scans through Docker (aquasec/trivy). Use when the user wants to scan a repo, filesystem, or image, produce a Trivy JSON report, test the scan worker against NodeGoat, or build a large synthetic report for the OOM test. Trivy is never installed on the host.
allowed-tools: Bash
---

# Running Trivy via Docker

**Scope:** this skill only runs Bash commands (`docker run ...`) and reads their output. It does not edit or write project files. Do not open the report with the Read tool. Inspect it from Bash with bounded commands such as `head -c`, `grep -c` or `ls -la`, which also keeps a large report out of context.

Trivy only runs in the `aquasec/trivy` container (v0.75.0 verified). CLI shape: `trivy <target> [--scanners a,b] <subject>`. Targets: `fs`, `repo`, `image`, `config`, `k8s`, `sbom`. Scanners: `vuln` (default), `secret`, `misconfig`, `license`.

## Base command

```bash
docker run --rm \
  -v trivy-cache:/root/.cache/ \
  -v "$WORK":/work \
  aquasec/trivy:latest <target> [flags] <subject>
```

- `trivy-cache` is a named volume holding the vulnerability DB. Always mount it, or every run re-downloads the DB.
- `$WORK` is the host dir that holds the cloned repo and the output. Paths inside the container start with `/work`.
- Always add `--no-progress` when output is captured or parsed.

## Recipes

**Scan a cloned repo to a JSON file (what the worker does):**
```bash
docker run --rm -v trivy-cache:/root/.cache/ -v "$WORK":/work aquasec/trivy:latest \
  fs --scanners vuln --format json --output /work/report.json --no-progress /work/repo
```
Verified on https://github.com/Shnyrkevich/NodeGoat: about 560KB report, 12 CRITICAL.

**Scan a remote repo directly (Trivy clones it):**
```bash
docker run --rm -v trivy-cache:/root/.cache/ aquasec/trivy:latest \
  repo --format json --output /tmp/r.json https://github.com/Shnyrkevich/NodeGoat
```
The project clones with `git` itself so it controls the temp dir and cleanup. Prefer `fs`.

**Other scanners:** `--scanners vuln,secret,misconfig`.

**Only criticals (quick CLI check, not for the service):** add `--severity CRITICAL`. The service must still filter in the stream, since the requirement is to stream-filter the report.

**Update the DB only:** `docker run --rm -v trivy-cache:/root/.cache/ aquasec/trivy:latest image --download-db-only`

**Image scan:** `docker run --rm -v trivy-cache:/root/.cache/ aquasec/trivy:latest image python:3.4-alpine`

## Useful flags
| Flag | Purpose |
|---|---|
| `--format json\|table\|sarif\|cyclonedx` | Output format (service uses `json`) |
| `--output FILE` | Write to a file instead of stdout |
| `--severity LOW,MEDIUM,HIGH,CRITICAL` | Filter severities |
| `--skip-db-update` | Offline or faster runs once the DB is cached |
| `--skip-dirs a,b` | Skip directories |
| `--include-dev-deps` | Include dev deps (npm, yarn, gradle); off by default |
| `--timeout 10m` | Scan timeout (default 5m) |
| `--exit-code 1` | Non-zero exit when findings exist (do not use in the service) |

## Report shape (JSON)
`Results[]` each with `Target`, `Class`, `Type`, `Vulnerabilities[]`. Each vulnerability has `VulnerabilityID`, `PkgName`, `InstalledVersion`, `FixedVersion`, `Severity`, `Title`, `PrimaryURL`. `Vulnerabilities` is absent on clean targets. Stream path: `Results.*.Vulnerabilities.*`.

## Failure modes to handle
- Non-zero exit code or stderr output means the scan failed (set status `Failed`).
- DB download failure on the first run (no network). Suggest `--skip-db-update` only when the cache volume is warm.
- Disk full while writing the report (`ENOSPC`). Delete the partial file and fail the scan.
- Container left running after a timeout. Use `--rm` and kill the `docker run` child process.

## Large-report test
To exercise the OOM path, generate a synthetic 500MB+ file with the same shape (a loop that writes `Results[].Vulnerabilities[]` entries to a write stream, never building it in memory) and run the service with `node --max-old-space-size=150 dist/index.js`.
