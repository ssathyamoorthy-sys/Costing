import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { hashPassword } from '../lib/auth';

export const usersRouter = Router();
usersRouter.use(requireAuth);
usersRouter.use(requireRole('ADMIN'));

const ROLES = ['PURCHASE', 'SUPERVISOR', 'MERCHANDISER', 'ADMIN'] as const;

function sanitize<T extends { passwordHash: string }>(user: T) {
  const { passwordHash, ...rest } = user;
  return rest;
}

usersRouter.get('/', async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { username: 'asc' } });
  res.json(users.map(sanitize));
});

const createSchema = z.object({
  username: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email().optional().or(z.literal('')),
  role: z.enum(ROLES),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

usersRouter.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const passwordHash = await hashPassword(parsed.data.password);
  const user = await prisma.user.create({
    data: {
      username: parsed.data.username,
      name: parsed.data.name,
      email: parsed.data.email || undefined,
      role: parsed.data.role,
      passwordHash,
    },
  });
  res.status(201).json(sanitize(user));
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional().or(z.literal('')),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
});

usersRouter.put('/:id', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const userId = Number(req.params.id);
  if (userId === req.user!.userId && (parsed.data.active === false || (parsed.data.role && parsed.data.role !== 'ADMIN'))) {
    return res.status(400).json({ error: "You can't deactivate or demote your own account." });
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      name: parsed.data.name,
      email: parsed.data.email === '' ? null : parsed.data.email,
      role: parsed.data.role,
      active: parsed.data.active,
    },
  });
  res.json(sanitize(user));
});

const resetPasswordSchema = z.object({ newPassword: z.string().min(8, 'Password must be at least 8 characters') });

usersRouter.post('/:id/reset-password', async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await prisma.user.update({ where: { id: Number(req.params.id) }, data: { passwordHash } });
  res.json({ ok: true });
});
