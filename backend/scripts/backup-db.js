// Nightly database backup - run on a schedule via deploy\backup-db.bat (Windows Task
// Scheduler); see deploy/README.md "Automated backups" for one-time setup.
//
// Uses SQLite's own VACUUM INTO rather than a plain file copy, because this runs while the
// app is live: a raw copy of a database file mid-write can capture a torn, inconsistent
// snapshot. VACUUM INTO is SQLite's documented safe way to snapshot a live database, and
// it also compacts the copy and works correctly regardless of journal mode (WAL or not).
//
// Plain CommonJS, no build step - callable directly with `node scripts/backup-db.js`.
require('dotenv/config');
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const BACKUP_DIR = path.join(__dirname, '..', '..', 'deploy', 'backups', 'scheduled');
// Keep 30 days of nightly backups - about 1.5MB/month at this app's measured growth rate
// (see the storage review), so this is a trivial amount of disk even over a year.
const RETENTION_DAYS = 30;

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function main() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupPath = path.join(BACKUP_DIR, `prod-${timestamp()}.db`);

  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe('VACUUM INTO ?', backupPath);
  } finally {
    await prisma.$disconnect();
  }

  if (!fs.existsSync(backupPath)) {
    throw new Error(`VACUUM INTO reported success but ${backupPath} was not created`);
  }
  const sizeKb = (fs.statSync(backupPath).size / 1024).toFixed(1);
  console.log(`Backup written: ${backupPath} (${sizeKb} KB)`);

  pruneOldBackups();
}

function pruneOldBackups() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('prod-') && f.endsWith('.db'));
  let removed = 0;
  for (const file of files) {
    const full = path.join(BACKUP_DIR, file);
    if (fs.statSync(full).mtimeMs < cutoff) {
      fs.unlinkSync(full);
      removed++;
    }
  }
  if (removed > 0) console.log(`Pruned ${removed} backup(s) older than ${RETENTION_DAYS} days.`);
}

main().catch((err) => {
  console.error('Backup FAILED:', err);
  process.exit(1);
});
