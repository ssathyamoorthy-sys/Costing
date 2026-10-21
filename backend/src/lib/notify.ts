import { prisma } from './prisma';
import { sendMail } from './mailer';
import type { Role } from './auth';

export async function notifyUser(userId: number, type: string, message: string) {
  const notification = await prisma.notification.create({
    data: { userId, type, message },
  });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user?.email) {
    const sent = await sendMail(user.email, `[Terry Towel Costing] ${type}`, message);
    if (sent) {
      await prisma.notification.update({ where: { id: notification.id }, data: { emailSent: true } });
    }
  }
  return notification;
}

export async function notifyRole(role: Role, type: string, message: string) {
  const users = await prisma.user.findMany({ where: { role, active: true } });
  await Promise.all(users.map((u) => notifyUser(u.id, type, message)));
}
