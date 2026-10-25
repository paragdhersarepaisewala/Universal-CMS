import {
  mysqlTable,
  serial,
  varchar,
  text,
  int,
  timestamp,
  boolean,
  json,
} from 'drizzle-orm/mysql-core';

// Roles Table
export const roles = mysqlTable('roles', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 50 }).notNull().unique(),
  description: text('description'),
  isSystem: boolean('is_system').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

// Users Table
export const users = mysqlTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  roleId: int('role_id').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  emailVerifiedAt: timestamp('email_verified_at'),
  twoFactorEnabled: boolean('two_factor_enabled').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});

// Permissions Table
export const permissions = mysqlTable('permissions', {
  id: serial('id').primaryKey(),
  key: varchar('key', { length: 100 }).notNull().unique(),
  module: varchar('module', { length: 50 }).notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Role Permissions Table
export const rolePermissions = mysqlTable('role_permissions', {
  id: serial('id').primaryKey(),
  roleId: int('role_id').notNull(),
  permissionId: int('permission_id').notNull(),
});

// Background Jobs Table (Designed for external cron execution on Hostinger)
// Shared hosting prohibits persistent in-process worker daemons.
// Jobs are enqueued in MySQL and executed via a CLI runner or secured endpoint called by Hostinger cron.
export const jobs = mysqlTable('jobs', {
  id: serial('id').primaryKey(),
  queue: varchar('queue', { length: 50 }).default('default').notNull(),
  jobType: varchar('job_type', { length: 100 }).notNull(),
  payload: json('payload').notNull(),
  status: varchar('status', { length: 20 }).default('pending').notNull(), // pending, running, completed, failed
  attempts: int('attempts').default(0).notNull(),
  maxAttempts: int('max_attempts').default(3).notNull(),
  lastError: text('last_error'),
  lockedAt: timestamp('locked_at'),
  runAfter: timestamp('run_after').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});
