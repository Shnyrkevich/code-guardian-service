import express, { type ErrorRequestHandler, type Express } from 'express';
import { ScanController } from './controllers/scan.controller.js';
import { createGraphqlHandler } from './graphql/handler.js';
import { QueueUnavailableError } from './queue/scan.queue.js';
import type { ScanService } from './services/scan.service.js';

const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  if (err instanceof QueueUnavailableError) {
    res.status(503).json({ error: 'Service temporarily unavailable, try again later' });
    return;
  }
  // express.json() rejects malformed bodies with a 400-class error
  const status = typeof err === 'object' && err !== null && 'status' in err && err.status === 400 ? 400 : 500;
  if (status === 500) console.error('[http]', err);
  res.status(status).json({ error: status === 400 ? 'Invalid request body' : 'Internal server error' });
};

export function createApp(service: ScanService): Express {
  const app = express();
  const controller = new ScanController(service);
  app.use(express.json({ limit: '10kb' }));
  app.post('/api/scan', controller.create);
  app.get('/api/scan/:scanId', controller.get);
  app.all('/graphql', createGraphqlHandler(service));
  app.use(errorHandler);
  return app;
}
