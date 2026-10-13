import { streamCriticals } from '../../src/services/report-parser.js';

/**
 * Runs the real parser over a report and prints peak memory.
 * usage: node --max-old-space-size=150 dist/tools/oom-check.js <report.json>
 */
const [file] = process.argv.slice(2);
if (!file) throw new Error('usage: oom-check <report.json>');

let peakHeap = 0;
let peakRss = 0;
const sampler = setInterval(() => {
  const m = process.memoryUsage();
  peakHeap = Math.max(peakHeap, m.heapUsed);
  peakRss = Math.max(peakRss, m.rss);
}, 50);

let stored = 0;
const started = Date.now();
const summary = await streamCriticals(
  file,
  async (batch) => {
    stored += batch.length; // stands in for the Redis write
  },
  500,
);
clearInterval(sampler);
const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(0)} MB`;
console.log(
  `scanned=${summary.scanned} critical=${summary.critical} stored=${stored} ` +
    `time=${((Date.now() - started) / 1000).toFixed(1)}s peakHeap=${mb(peakHeap)} peakRss=${mb(peakRss)}`,
);
