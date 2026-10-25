# Database Backup and Restore Procedure

Location: `cms-core/docs/BACKUP.md`
Universal CMS Core: Version 0.1.0

## 1. Overview
Universal CMS Core provides automated, non-destructive SQL backup and restore utilities engineered specifically for shared hosting (Hostinger) and dedicated server deployments without needing root access or external daemon tools.

---

## 2. Backup Execution

### Option A: Via NPM Command (Local & SSH)
To generate an immediate database dump:

```bash
npm run db:backup
```

This dumps the full MySQL database structure (all tables, foreign keys, schema definitions) and all table records into a timestamped file under `backups/backup_YYYY-MM-DDTHH-mm-ss.sql`.

### Option B: Automated Scheduled Backups via Cron (Hostinger hPanel)
In Hostinger hPanel -> Advanced -> Cron Jobs, add a scheduled cron job (e.g. daily at 02:00 UTC):

```bash
0 2 * * * cd /home/u123456789/domains/client.com/public_html && /usr/bin/node dist/scripts/backup.js >> logs/backup.log 2>&1
```

---

## 3. Database Restore Procedure

### Option A: Via NPM Restore Script
To restore a specific backup snapshot:

```bash
npm run db:restore backups/backup_2026-10-25T18-00-00.sql
```

The restore script temporarily disables foreign key constraints, drops and recreates tables, inserts all records, and re-enables integrity constraints safely.

### Option B: Via phpMyAdmin (Hostinger hPanel)
1. Open Hostinger hPanel -> Databases -> phpMyAdmin.
2. Select your client database.
3. Click **Import**.
4. Choose the generated `.sql` file from your `backups/` directory.
5. Click **Go** to restore all tables and data.
