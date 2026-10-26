import fs from 'fs';
import path from 'path';

export interface LogRotationOptions {
  logDir?: string;
  maxFiles?: number;
}

export class FileLogger {
  private static logDir: string = path.resolve(process.cwd(), 'logs');
  private static maxFiles: number = 14;

  static initialize(options?: LogRotationOptions): void {
    if (options?.logDir) {
      this.logDir = options.logDir;
    }
    if (options?.maxFiles) {
      this.maxFiles = options.maxFiles;
    }
    if (!fs.existsSync(this.logDir)) {
      try {
        fs.mkdirSync(this.logDir, { recursive: true });
      } catch {
        // Safe fallback
      }
    }
  }

  static getLogDirectory(): string {
    return this.logDir;
  }

  static getTodayLogPath(): string {
    const today = new Date().toISOString().split('T')[0];
    return path.join(this.logDir, `cms-core-${today}.log`);
  }

  static writeLog(level: string, message: string, context?: Record<string, unknown>): void {
    this.initialize();
    const timestamp = new Date().toISOString();
    const entry = JSON.stringify({ timestamp, level, message, ...(context || {}) }) + '\n';
    try {
      fs.appendFileSync(this.getTodayLogPath(), entry, 'utf-8');
      this.cleanupOldLogs();
    } catch {
      // Safe fallback
    }
  }

  static cleanupOldLogs(): void {
    try {
      if (!fs.existsSync(this.logDir)) return;
      const files = fs.readdirSync(this.logDir)
        .filter(f => f.startsWith('cms-core-') && f.endsWith('.log'))
        .sort();
      if (files.length > this.maxFiles) {
        const toDelete = files.slice(0, files.length - this.maxFiles);
        for (const file of toDelete) {
          fs.unlinkSync(path.join(this.logDir, file));
        }
      }
    } catch {
      // Ignore cleanup error
    }
  }

  static listLogFiles(): Array<{ filename: string; sizeBytes: number; updatedAt: Date }> {
    this.initialize();
    try {
      if (!fs.existsSync(this.logDir)) return [];
      return fs.readdirSync(this.logDir)
        .filter(f => f.startsWith('cms-core-') && f.endsWith('.log'))
        .map(filename => {
          const stats = fs.statSync(path.join(this.logDir, filename));
          return {
            filename,
            sizeBytes: stats.size,
            updatedAt: stats.mtime,
          };
        });
    } catch {
      return [];
    }
  }
}
