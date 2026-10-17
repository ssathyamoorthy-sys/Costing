import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

// WAL mode is stored in the database file itself (set once, persists across restarts), so
// this only actually does anything the very first time it runs against a given .db file -
// but it's cheap to repeat on every boot and safer than relying on it never being missed.
// Default SQLite journaling takes a file-level lock for the whole duration of a write
// transaction; WAL lets reads continue concurrently with a write, which matters once more
// than one person is using the app at the same time.
prisma.$executeRawUnsafe('PRAGMA journal_mode=WAL;').catch((err) => {
  console.error('Could not enable SQLite WAL mode (continuing with default journal mode):', err);
});
