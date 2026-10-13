import { buildSchema } from 'graphql';

export const typeDefs = /* GraphQL */ `
  type Vulnerability {
    id: ID!
    pkgName: String!
    installedVersion: String!
    fixedVersion: String
    severity: String!
    title: String
    primaryUrl: String
  }

  type Scan {
    id: ID!
    "Queued, Scanning, Finished or Failed"
    status: String!
    repoUrl: String!
    "Set when status is Failed"
    error: String
    "Total CRITICAL findings, including ones beyond the storage cap"
    criticalCount: Int!
    "True when criticalCount is larger than what is stored"
    truncated: Boolean!
    "Null until the scan is Finished. Loaded from Redis only when this field is requested."
    criticalVulnerabilities(limit: Int = 1000, offset: Int = 0): [Vulnerability!]
  }

  type Query {
    scan(id: ID!): Scan
  }

  type Mutation {
    "Queues a scan and returns immediately with status Queued"
    startScan(repoUrl: String!): Scan!
  }
`;

export const schema = buildSchema(typeDefs);
