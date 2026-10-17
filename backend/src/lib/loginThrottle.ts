// Simple in-memory brute-force guard for POST /auth/login - no new dependency, no shared
// store needed since this app runs as a single Node process. Tracked per-username (not
// per-IP): this is a LAN app where many users can share one office IP behind NAT, so an
// IP-based limiter would lock out the whole office after a few typos from one person.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_MS = 15 * 60 * 1000;

interface Entry {
  failCount: number;
  windowStartedAt: number;
  lockedUntil: number | null;
}

const attempts = new Map<string, Entry>();

export function checkLoginThrottle(username: string): { blocked: boolean; retryAfterSeconds?: number } {
  const entry = attempts.get(username.toLowerCase());
  if (!entry?.lockedUntil) return { blocked: false };
  const remaining = entry.lockedUntil - Date.now();
  if (remaining <= 0) return { blocked: false };
  return { blocked: true, retryAfterSeconds: Math.ceil(remaining / 1000) };
}

export function recordLoginFailure(username: string) {
  const key = username.toLowerCase();
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.windowStartedAt > WINDOW_MS) {
    attempts.set(key, { failCount: 1, windowStartedAt: now, lockedUntil: null });
    return;
  }
  entry.failCount += 1;
  if (entry.failCount >= MAX_ATTEMPTS) {
    entry.lockedUntil = now + LOCKOUT_MS;
  }
}

export function recordLoginSuccess(username: string) {
  attempts.delete(username.toLowerCase());
}
