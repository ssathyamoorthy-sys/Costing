import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', async (req, res) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.user!.userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json(notifications);
});

notificationsRouter.post('/:id/read', async (req, res) => {
  const notification = await prisma.notification.update({
    where: { id: Number(req.params.id) },
    data: { read: true },
  });
  res.json(notification);
});
