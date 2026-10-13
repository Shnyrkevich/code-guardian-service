import type { Job } from './useScans';
import type { Scan } from './types';

function repoName(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\/|\.git$/g, '') || url;
  } catch {
    return url;
  }
}

function seconds(job: Job, now: number): string {
  return `${Math.max(0, Math.round(((job.finishedAt ?? now) - job.startedAt) / 1000))}s`;
}

type Label = 'Starting' | Scan['status'] | 'Error';

function label(job: Job): Label {
  switch (job.state.phase) {
    case 'starting':
      return 'Starting';
    case 'error':
      return 'Error';
    default:
      return job.state.scan.status;
  }
}

function Findings({ scan }: { scan: Scan }) {
  const items = scan.criticalVulnerabilities ?? [];
  if (items.length === 0) return <p className="muted">No critical vulnerabilities found.</p>;
  return (
    <>
      <p>
        <strong>{scan.criticalCount}</strong> critical
        {items.length < scan.criticalCount && ` (showing ${items.length})`}
        {scan.truncated && ' · partly stored'}
      </p>
      <ul className="findings">
        {items.map((v, i) => (
          <li key={`${v.id}-${v.pkgName}-${i}`}>
            {v.primaryUrl ? <a href={v.primaryUrl} target="_blank" rel="noreferrer">{v.id}</a> : v.id}
            <span className="muted">
              {' '}{v.pkgName}@{v.installedVersion}
              {v.fixedVersion ? ` → ${v.fixedVersion}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function ScanCard({ job, now, onRemove }: { job: Job; now: number; onRemove: () => void }) {
  const text = label(job);
  const inProgress = job.state.phase === 'starting' || job.state.phase === 'running';
  const status = job.state.phase === 'running' || job.state.phase === 'done' ? job.state.scan.status : null;

  return (
    <article className={`card card-${text.toLowerCase()}`}>
      <header>
        <h2 title={job.repoUrl}>{repoName(job.repoUrl)}</h2>
        <span className={`badge badge-${text.toLowerCase()}`}>{text}</span>
      </header>

      <p className="muted small">
        {seconds(job, now)}
        {status === 'Queued' && ' · waiting for a free worker'}
        {status === 'Scanning' && ' · cloning and scanning'}
      </p>

      {inProgress && <div className="bar" role="progressbar" aria-label="Scan in progress" />}

      {job.state.phase === 'error' && <p className="error">{job.state.message}</p>}
      {job.state.phase === 'done' && job.state.scan.status === 'Failed' && (
        <p className="error">Scan failed: {job.state.scan.error ?? 'unknown error'}</p>
      )}
      {job.state.phase === 'done' && job.state.scan.status === 'Finished' && <Findings scan={job.state.scan} />}

      {!inProgress && (
        <button type="button" className="secondary" onClick={onRemove}>
          Remove
        </button>
      )}
    </article>
  );
}
