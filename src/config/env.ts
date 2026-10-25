import dotenv from 'dotenv';

dotenv.config();

export interface AppConfig {
  nodeEnv: string;
  port: number;
  host: string;
  appSecret: string;
  db: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    poolSize: number;
  };
  cache: {
    driver: 'memory' | 'file';
    fileDir: string;
  };
  jobRunnerSecret: string;
  seed: {
    ownerEmail: string;
    ownerPassword: string;
    ownerName: string;
  };
}

export const config: AppConfig = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  appSecret: process.env.APP_SECRET || 'insecure_default_secret_for_development_only',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'cms_core',
    // Hostinger shared plans typically have tight concurrent connection limits.
    // Default pool size is set to 5 to prevent connection exhaustion.
    poolSize: Number(process.env.DB_POOL_SIZE) || 5,
  },
  cache: {
    driver: (process.env.CACHE_DRIVER as 'memory' | 'file') || 'memory',
    fileDir: process.env.CACHE_FILE_DIR || './.cache',
  },
  jobRunnerSecret: process.env.JOB_RUNNER_SECRET || 'dev_job_runner_secret',
  seed: {
    ownerEmail: process.env.SEED_OWNER_EMAIL || 'owner@example.com',
    ownerPassword: process.env.SEED_OWNER_PASSWORD || 'ChangeMe123!',
    ownerName: process.env.SEED_OWNER_NAME || 'System Owner',
  },
};
