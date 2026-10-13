import { createWriteStream } from 'node:fs';
import { once } from 'node:events';

/**
 * Writes a synthetic Trivy-shaped report of roughly <sizeMb> MB without ever holding it in memory.
 * usage: node dist/tools/gen-big-report.js <outFile> [sizeMb=600] [criticalEvery=100]
 */
const [outFile, sizeArg, criticalArg] = process.argv.slice(2);
if (!outFile) throw new Error('usage: gen-big-report <outFile> [sizeMb] [criticalEvery]');
const targetBytes = Number(sizeArg ?? 600) * 1024 * 1024;
const criticalEvery = Number(criticalArg ?? 100);
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
const VULNS_PER_TARGET = 50_000;

const out = createWriteStream(outFile);
let written = 0;
async function write(chunk: string): Promise<void> {
  written += Buffer.byteLength(chunk);
  if (!out.write(chunk)) await once(out, 'drain');
}

function vulnerability(i: number): string {
  const severity = i % criticalEvery === 0 ? 'CRITICAL' : SEVERITIES[i % SEVERITIES.length];
  return JSON.stringify({
    VulnerabilityID: `CVE-2099-${i}`,
    PkgID: `pkg-${i}@1.0.${i % 50}`,
    PkgName: `pkg-${i}`,
    InstalledVersion: `1.0.${i % 50}`,
    FixedVersion: `1.1.${i % 50}`,
    Status: 'fixed',
    Severity: severity,
    // braces, quotes and escapes inside strings must not confuse the parser
    Title: `Synthetic issue ${i}: {"nested": "value"} with \\ and " characters`,
    Description: 'Lorem ipsum dolor sit amet. '.repeat(30),
    PrimaryURL: `https://avd.aquasec.com/nvd/cve-2099-${i}`,
    References: Array.from({ length: 8 }, (_, r) => `https://example.com/advisory/${i}/${r}`),
    CVSS: { nvd: { V3Score: 9.8, V3Vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' } },
  });
}

await write('{"SchemaVersion":2,"ArtifactName":"synthetic","Results":[');
let i = 0;
let target = 0;
while (written < targetBytes) {
  await write(`${target === 0 ? '' : ','}{"Target":"synthetic-${target}","Class":"lang-pkgs","Type":"npm","Vulnerabilities":[`);
  for (let n = 0; n < VULNS_PER_TARGET && written < targetBytes; n++, i++) {
    await write(`${n === 0 ? '' : ','}${vulnerability(i)}`);
  }
  await write(']}');
  target++;
}
await write(']}');
out.end();
await once(out, 'finish');
console.log(`wrote ${(written / 1024 / 1024).toFixed(0)} MB, ${i} vulnerabilities, ${Math.ceil(i / criticalEvery)} critical, ${target} targets`);
