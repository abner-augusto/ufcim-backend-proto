import { eq, and, desc } from 'drizzle-orm';
import { notifications } from '@/db/schema';
import type { Database } from '@/db/client';
import { ForbiddenError, NotFoundError } from '@/middleware/error-handler';

type NotificationType = 'confirmed' | 'canceled' | 'modified' | 'overridden';

export class NotificationService {
  constructor(private db: Database) {}

  async create(userId: string, title: string, message: string, type: NotificationType) {
    const id = crypto.randomUUID();
    const [notification] = await this.db
      .insert(notifications)
      .values({
        id,
        userId,
        title,
        message,
        type,
        read: false,
        createdAt: new Date().toISOString(),
      })
      .returning();
    return notification;
  }

  async listForUser(userId: string, unreadOnly = false) {
    return this.db.query.notifications.findMany({
      where: and(
        eq(notifications.userId, userId),
        unreadOnly ? eq(notifications.read, false) : undefined
      ),
      orderBy: (n, { desc: d }) => [d(n.createdAt)],
    });
  }

  async markAsRead(notificationId: string, userId: string) {
    const notification = await this.db.query.notifications.findFirst({
      where: eq(notifications.id, notificationId),
    });
    if (!notification) throw new NotFoundError('Notification');
    if (notification.userId !== userId) throw new ForbiddenError();

    const [updated] = await this.db
      .update(notifications)
      .set({ read: true })
      .where(eq(notifications.id, notificationId))
      .returning();
    return updated;
  }

  async markAllRead(userId: string) {
    await this.db
      .update(notifications)
      .set({ read: true })
      .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
  }
}
