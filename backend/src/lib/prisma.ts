import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

// WAL mode is stored in the database file itself (set once, persists across restarts), so
// this only actually does anything the very first time it runs against a given .db file -
// but it's cheap to repeat on every boot and safer than relying on it never being missed.
// Default SQLite journaling takes a file-level lock for the whole duration of a write
// transaction; WAL lets reads continue concurrently with a write, which matters once more
// than one person is using the app at the same time.
// PRAGMA journal_mode=WAL returns the resulting mode as a row, so it must be run with
// $queryRawUnsafe (which allows a result set) rather than $executeRawUnsafe (which errors
// with P2010 "Execute returned results, which is not allowed in SQLite" if anything comes
// back) - that was silently failing on every boot before this fix.
prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL;').catch((err) => {
  console.error('Could not enable SQLite WAL mode (continuing with default journal mode):', err);
});
