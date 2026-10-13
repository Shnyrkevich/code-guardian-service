import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { CriticalVulnerability } from '../../src/types/scan.js';
import { ReportParseError, streamCriticals } from '../../src/services/report-parser.js';

describe('report parser', () => {
  let dir: string;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cg-parse-'));
  });
  after(() => rm(dir, { recursive: true, force: true }));

  const vuln = (id: string, severity: string): object => ({
    VulnerabilityID: id, PkgName: 'p', InstalledVersion: '1', Severity: severity,
    Title: 'has {"braces"} and \\ and " inside',
  });

  async function parse(content: string, batchSize = 2): Promise<{ batches: CriticalVulnerability[][]; scanned: number; critical: number }> {
    const file = join(dir, `${Math.random()}.json`);
    await writeFile(file, content);
    const batches: CriticalVulnerability[][] = [];
    const summary = await streamCriticals(file, async (b) => void batches.push(b), batchSize);
    return { batches, ...summary };
  }

  it('keeps only CRITICAL across several targets and batches them', async () => {
    const report = {
      Results: [
        { Target: 'a', Vulnerabilities: [vuln('1', 'CRITICAL'), vuln('2', 'LOW'), vuln('3', 'CRITICAL')] },
        { Target: 'clean' },
        { Target: 'b', Vulnerabilities: [vuln('4', 'CRITICAL'), vuln('5', 'HIGH')] },
      ],
    };
    const { batches, scanned, critical } = await parse(JSON.stringify(report));
    assert.deepEqual(batches.map((b) => b.map((c) => c.id)), [['1', '3'], ['4']]);
    assert.equal(scanned, 5);
    assert.equal(critical, 3);
  });

  it('handles a report with no results', async () => {
    const { batches, scanned } = await parse('{"SchemaVersion":2}');
    assert.equal(batches.length, 0);
    assert.equal(scanned, 0);
  });

  it('rejects with ReportParseError on malformed JSON', async () => {
    await assert.rejects(parse('{"Results":[{"Vulnerabilities":[{"VulnerabilityID":"1" "Severity"}]}]}'), ReportParseError);
  });

  it('rejects with ReportParseError on a truncated file (e.g. disk filled during the Trivy write)', async () => {
    await assert.rejects(parse('{"Results":[{"Vulnerabilities":[{"VulnerabilityID":"1","Severity":"CRIT'), ReportParseError);
  });

  it('propagates sink failures (e.g. Redis down) instead of swallowing them', async () => {
    const file = join(dir, 'sink.json');
    await writeFile(file, JSON.stringify({ Results: [{ Vulnerabilities: [vuln('1', 'CRITICAL')] }] }));
    await assert.rejects(
      streamCriticals(file, async () => { throw new Error('redis down'); }, 1),
      /redis down/,
    );
  });

  it('fails when the report file does not exist', async () => {
    await assert.rejects(streamCriticals(join(dir, 'missing.json'), async () => {}, 1), /ENOENT/);
  });
});
