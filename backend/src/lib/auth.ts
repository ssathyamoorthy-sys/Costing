import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export type Role = 'PURCHASE' | 'SUPERVISOR' | 'MERCHANDISER' | 'ADMIN' | 'FINANCE_MANAGER';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

// Refuse to start in production with an unset or default secret - signing every login
// session with a guessable value would let anyone forge a valid token. Dev/local still
// falls back to the placeholder above so `npm run dev` works without extra setup.
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-secret-change-me')) {
  throw new Error(
    'JWT_SECRET must be set to a unique value in production (see deploy/README.md step 4) - refusing to start with the dev default.',
  );
}

export interface JwtPayload {
  userId: number;
  username: string;
  role: Role;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}
