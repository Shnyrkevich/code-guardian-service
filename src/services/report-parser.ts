import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform, Writable } from 'node:stream';
import { parser } from 'stream-json';
import pick from 'stream-json/filters/pick.js';
import streamValues from 'stream-json/streamers/stream-values.js';
import type { CriticalVulnerability } from '../types/scan.js';
import type { TrivyVulnerability } from '../types/trivy.js';

export interface ParseSummary {
  scanned: number;
  critical: number;
}

export type CriticalBatchHandler = (batch: CriticalVulnerability[]) => Promise<void>;

export class ReportParseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ReportParseError';
  }
}

interface StreamedItem {
  key: number;
  value: unknown;
}

function isTrivyVulnerability(value: unknown): value is TrivyVulnerability {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v['VulnerabilityID'] === 'string' && typeof v['Severity'] === 'string';
}

function project(v: TrivyVulnerability): CriticalVulnerability {
  return {
    id: v.VulnerabilityID,
    pkgName: v.PkgName,
    installedVersion: v.InstalledVersion,
    severity: 'CRITICAL',
    ...(v.FixedVersion ? { fixedVersion: v.FixedVersion } : {}),
    ...(v.Title ? { title: v.Title } : {}),
    ...(v.PrimaryURL ? { primaryUrl: v.PrimaryURL } : {}),
  };
}

/**
 * Streams a Trivy JSON report from disk and hands CRITICAL vulnerabilities to `onBatch`.
 * Memory is bounded by one vulnerability object plus one batch: the file is never read whole.
 *
 *   file -> tokenizer -> pick Results.*.Vulnerabilities.* -> assemble one value -> filter -> batch sink
 *
 * `onBatch` is awaited, so a slow sink (Redis) applies backpressure all the way to the disk read.
 */
export async function streamCriticals(
  reportPath: string,
  onBatch: CriticalBatchHandler,
  batchSize: number,
): Promise<ParseSummary> {
  const summary: ParseSummary = { scanned: 0, critical: 0 };

  const filterCritical = new Transform({
    objectMode: true,
    transform(item: StreamedItem, _encoding, callback) {
      if (isTrivyVulnerability(item.value)) {
        summary.scanned++;
        if (item.value.Severity === 'CRITICAL') {
          summary.critical++;
          this.push(project(item.value));
        }
      }
      callback();
    },
  });

  let buffer: CriticalVulnerability[] = [];
  const flush = async (): Promise<void> => {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    await onBatch(batch);
  };

  const sink = new Writable({
    objectMode: true,
    write(item: CriticalVulnerability, _encoding, callback) {
      buffer.push(item);
      (buffer.length >= batchSize ? flush() : Promise.resolve()).then(() => callback(), callback);
    },
    final(callback) {
      flush().then(() => callback(), callback);
    },
  });

  try {
    await pipeline(
      createReadStream(reportPath),
      parser.asStream(),
      pick.asStream({ filter: /^Results\.\d+\.Vulnerabilities\.\d+$/ }),
      streamValues.asStream(),
      filterCritical,
      sink,
    );
  } catch (err) {
    // the tokenizer throws on malformed JSON; anything else (ENOSPC, EIO, Redis) is rethrown as is
    if (err instanceof Error && /JSON|Parser|Unexpected|Expected/i.test(err.message) && !('code' in err)) {
      throw new ReportParseError(`Trivy report is not valid JSON: ${err.message}`, { cause: err });
    }
    throw err;
  }
  return summary;
}
