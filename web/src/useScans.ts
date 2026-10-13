import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchScans, startScan } from './api';
import type { Scan } from './types';

export const MAX_JOBS = 5;
export const POLL_INTERVAL_MS = 2000;
const MAX_CONSECUTIVE_POLL_FAILURES = 3;

export type JobState =
  | { phase: 'starting' }
  | { phase: 'running' | 'done'; scan: Scan }
  | { phase: 'error'; message: string };

export interface Job {
  /** Local id: exists before the backend has assigned a scan id. */
  key: string;
  repoUrl: string;
  startedAt: number;
  /** Set when the job reached a final state, so the elapsed time stops. */
  finishedAt?: number;
  state: JobState;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isFinal = (scan: Scan): boolean => scan.status === 'Finished' || scan.status === 'Failed';

function runningScanId(job: Job): string | null {
  return job.state.phase === 'running' ? job.state.scan.id : null;
}

/** Applies one poll result to a job; jobs that are not running are left alone. */
function applyPoll(job: Job, result: Record<string, Scan | null>): Job {
  const id = runningScanId(job);
  if (id === null || !(id in result)) return job;
  const scan = result[id];
  const now = Date.now();
  if (!scan) {
    return { ...job, finishedAt: now, state: { phase: 'error', message: 'The scan was not found. It may have expired.' } };
  }
  return isFinal(scan)
    ? { ...job, finishedAt: now, state: { phase: 'done', scan } }
    : { ...job, state: { phase: 'running', scan } };
}

/**
 * Manages up to MAX_JOBS scans at once. All running scans are polled together, in one request
 * every 2 seconds; the next poll starts only after the previous one answered.
 */
export function useScans(): {
  jobs: Job[];
  canStart: boolean;
  start: (repoUrl: string) => void;
  remove: (key: string) => void;
} {
  const [jobs, setJobs] = useState<Job[]>([]);
  const jobsRef = useRef<Job[]>(jobs);
  jobsRef.current = jobs;

  const update = useCallback((key: string, change: (job: Job) => Job) => {
    setJobs((current) => current.map((job) => (job.key === key ? change(job) : job)));
  }, []);

  const start = useCallback(
    (repoUrl: string) => {
      if (jobsRef.current.length >= MAX_JOBS) return;
      const key = crypto.randomUUID();
      const job: Job = { key, repoUrl, startedAt: Date.now(), state: { phase: 'starting' } };
      jobsRef.current = [...jobsRef.current, job]; // so a quick second click sees the new count
      setJobs(jobsRef.current);

      startScan(repoUrl).then(
        (scan) => update(key, (j) => ({ ...j, state: { phase: 'running', scan } })),
        (err: unknown) =>
          update(key, (j) => ({
            ...j,
            finishedAt: Date.now(),
            state: { phase: 'error', message: err instanceof Error ? err.message : 'Could not start the scan' },
          })),
      );
    },
    [update],
  );

  const remove = useCallback((key: string) => {
    setJobs((current) => current.filter((job) => job.key !== key || job.state.phase === 'running'));
  }, []);

  // The polling loop restarts only when the SET of running scans changes.
  const runningKey = jobs
    .map(runningScanId)
    .filter((id): id is string => id !== null)
    .sort()
    .join(',');

  useEffect(() => {
    if (runningKey === '') return;
    const ids = runningKey.split(',');
    let cancelled = false;

    void (async () => {
      let failures = 0;
      while (!cancelled) {
        await sleep(POLL_INTERVAL_MS);
        if (cancelled) return;
        try {
          const result = await fetchScans(ids);
          if (cancelled) return;
          failures = 0;
          setJobs((current) => current.map((job) => applyPoll(job, result)));
        } catch (err) {
          // one dropped request should not end the session
          if (++failures >= MAX_CONSECUTIVE_POLL_FAILURES) {
            const message = err instanceof Error ? err.message : 'Lost connection to the service';
            const lost = new Set(ids);
            setJobs((current) =>
              current.map((job) => {
                const id = runningScanId(job);
                return id !== null && lost.has(id)
                  ? { ...job, finishedAt: Date.now(), state: { phase: 'error', message } }
                  : job;
              }),
            );
            return;
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [runningKey]);

  return { jobs, canStart: jobs.length < MAX_JOBS, start, remove };
}

/** Re-renders every second while `active`, so elapsed times keep counting. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return active ? now : Date.now();
}
