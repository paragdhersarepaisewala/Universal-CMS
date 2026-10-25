import 'dotenv/config';
import { EmailService } from '../email/service.js';
import { closePool } from '../db/index.js';

async function run(): Promise<void> {
  console.log('[Jobs] Starting background job processor...');
  try {
    const result = await EmailService.processQueue(50);
    console.log(`[Jobs] Completed email queue batch: ${result.processed} processed, ${result.succeeded} succeeded, ${result.failed} failed.`);
  } catch (err) {
    console.error('[Jobs] Background runner encountered an error:', err);
  } finally {
    await closePool();
    process.exit(0);
  }
}

run();
