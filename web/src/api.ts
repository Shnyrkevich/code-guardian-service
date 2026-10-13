import { ClientError, GraphQLClient, gql } from 'graphql-request';
import type { Scan } from './types';

const client = new GraphQLClient(new URL('/graphql', window.location.origin).toString());

const SCAN_FIELDS = gql`
  fragment ScanFields on Scan {
    id
    status
    repoUrl
    error
    criticalCount
    truncated
    criticalVulnerabilities(limit: 500) {
      id
      pkgName
      installedVersion
      fixedVersion
      title
      primaryUrl
    }
  }
`;

const START_SCAN = gql`
  ${SCAN_FIELDS}
  mutation StartScan($repoUrl: String!) {
    startScan(repoUrl: $repoUrl) {
      ...ScanFields
    }
  }
`;


/** Turns a GraphQL or network failure into a readable message. */
function toError(err: unknown): Error {
  if (err instanceof ClientError) {
    return new Error(err.response.errors?.[0]?.message ?? `Request failed (HTTP ${err.response.status})`);
  }
  return new Error(err instanceof Error ? err.message : 'Request failed');
}

export async function startScan(repoUrl: string): Promise<Scan> {
  try {
    return (await client.request<{ startScan: Scan }>(START_SCAN, { repoUrl })).startScan;
  } catch (err) {
    throw toError(err);
  }
}

/**
 * Fetches several scans in ONE request using GraphQL aliases (s0, s1, ...), so polling five jobs
 * costs one round trip. A scan the backend does not know (for example expired) comes back as null.
 */
export async function fetchScans(ids: string[]): Promise<Record<string, Scan | null>> {
  const variableDefs = ids.map((_, i) => `$id${i}: ID!`).join(', ');
  const selections = ids.map((_, i) => `s${i}: scan(id: $id${i}) { ...ScanFields }`).join('\n');
  const query = gql`
    ${SCAN_FIELDS}
    query GetScans(${variableDefs}) {
      ${selections}
    }
  `;
  const variables = Object.fromEntries(ids.map((id, i) => [`id${i}`, id]));
  try {
    const data = await client.request<Record<string, Scan | null>>(query, variables);
    return Object.fromEntries(ids.map((id, i) => [id, data[`s${i}`] ?? null]));
  } catch (err) {
    throw toError(err);
  }
}
