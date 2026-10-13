import type { RequestHandler } from 'express';
import { createHandler } from 'graphql-http/lib/use/express';
import type { ScanService } from '../services/scan.service.js';
import { createRootValue } from './resolvers.js';
import { schema } from './schema.js';

/** Express handler for the GraphQL endpoint (POST /graphql). Shares ScanService with the REST layer. */
export function createGraphqlHandler(service: ScanService): RequestHandler {
  return createHandler({ schema, rootValue: createRootValue(service) });
}
