import { buildApp } from './app.js';
import { config } from './config/env.js';
import { closePool } from './db/pool.js';

const app = buildApp();

async function start(): Promise<void> {
  try {
    await app.ready();
    const address = await app.listen({
      port: config.port,
      host: config.host,
    });
    app.log.info(`cms-core server listening on ${address}`);
    app.log.info(`API Documentation available at ${address}/api/v1/docs`);
    app.log.info(`OpenAPI schema available at ${address}/api/v1/openapi.json`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Graceful shutdown
const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}. Shutting down gracefully...`);
  try {
    await app.close();
    await closePool();
    app.log.info('Server and database pool closed cleanly.');
    process.exit(0);
  } catch (err) {
    app.log.error(err, 'Error during shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();
