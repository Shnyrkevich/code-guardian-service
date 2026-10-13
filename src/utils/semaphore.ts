export interface Semaphore {
  /** Runs `task` once a slot is free; at most `limit` tasks run at the same time, others wait in order. */
  run<T>(task: () => Promise<T>): Promise<T>;
}

export function createSemaphore(limit: number): Semaphore {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('semaphore limit must be a positive integer');
  let active = 0;
  const waiting: (() => void)[] = [];

  const acquire = (): Promise<void> =>
    new Promise((resolve) => {
      if (active < limit) {
        active++;
        resolve();
      } else {
        waiting.push(() => {
          active++;
          resolve();
        });
      }
    });

  const release = (): void => {
    active--;
    waiting.shift()?.();
  };

  return {
    async run(task) {
      await acquire();
      try {
        return await task();
      } finally {
        release(); // also on failure, so one failed clone never blocks the others
      }
    },
  };
}
