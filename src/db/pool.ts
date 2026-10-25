import mysql from 'mysql2/promise';
import { config } from '../config/env.js';

export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  connectionLimit: config.db.poolSize,
  waitForConnections: true,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

export async function checkDatabaseHealth(): Promise<{
  connected: boolean;
  poolLimit: number;
  error?: string;
}> {
  try {
    const connection = await pool.getConnection();
    try {
      await connection.query('SELECT 1');
      return {
        connected: true,
        poolLimit: config.db.poolSize,
      };
    } finally {
      connection.release();
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      connected: false,
      poolLimit: config.db.poolSize,
      error: message,
    };
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
