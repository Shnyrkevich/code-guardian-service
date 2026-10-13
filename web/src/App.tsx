import { useState, type FormEvent } from 'react';
import { ScanCard } from './ScanCard';
import { MAX_JOBS, useNow, useScans } from './useScans';

const DEFAULT_REPO = 'https://github.com/Shnyrkevich/NodeGoat';
// Shown in the notice; keep in sync with WORKER_CONCURRENCY of the app service in docker-compose.yml.
const DEMO_WORKERS = 4;
const EXAMPLES = [DEFAULT_REPO, 'https://github.com/microsoft/vscode'];

export default function App() {
  const [repoUrl, setRepoUrl] = useState(DEFAULT_REPO);
  const { jobs, canStart, start, remove } = useScans();
  const running = jobs.filter((j) => j.state.phase === 'starting' || j.state.phase === 'running').length;
  const now = useNow(running > 0);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    start(repoUrl.trim());
  };

  return (
    <main>
      <h1>Code Guardian</h1>
      <p className="muted">Scan GitHub repositories with Trivy and list their critical vulnerabilities.</p>

      <aside className="notice" role="note">
        <strong>Testing mode.</strong> Only {MAX_JOBS} scans can be added at a time. This is to show that{' '}
        {DEMO_WORKERS} workers process scans concurrently: the first {DEMO_WORKERS} start right away and the rest wait
        as <em>Queued</em>. Results are not stored in the UI: if you reload the page, the scans from this session
        disappear from the screen.
      </aside>

      <form onSubmit={onSubmit}>
        <input
          type="url"
          required
          list="examples"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="https://github.com/owner/repo"
          aria-label="GitHub repository URL"
        />
        <datalist id="examples">
          {EXAMPLES.map((url) => <option key={url} value={url} />)}
        </datalist>
        <button type="submit" disabled={!canStart || repoUrl.trim() === ''}>
          Start
        </button>
      </form>

      <p className="muted small">
        {jobs.length === 0
          ? 'No scans yet.'
          : `${running} in progress · ${jobs.length}/${MAX_JOBS} slots used`}
        {!canStart && ' · remove a finished scan to start another'}
      </p>

      <section className="grid" aria-label="Scans">
        {jobs.map((job) => (
          <ScanCard key={job.key} job={job} now={now} onRemove={() => remove(job.key)} />
        ))}
      </section>
    </main>
  );
}
