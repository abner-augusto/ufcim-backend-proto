import { describe, it, expect, beforeEach } from 'vitest';
import { NotificationService } from '@/services/notification.service';
import { NotFoundError, ForbiddenError } from '@/middleware/error-handler';
import { createMockDb } from '../helpers/mock-db';

describe('NotificationService.create', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: NotificationService;

  beforeEach(() => {
    db = createMockDb();
    service = new NotificationService(db);
  });

  it('inserts a notification with createdAt instead of sentAt', async () => {
    const mockNotification = {
      id: 'notif-1',
      userId: 'user-1',
      title: 'Test',
      message: 'Test message',
      type: 'confirmed' as const,
      read: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    db._insert.returning.mockResolvedValue([mockNotification]);

    const result = await service.create('user-1', 'Test', 'Test message', 'confirmed');

    expect(result).toMatchObject({ id: 'notif-1', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(db._insert.fn).toHaveBeenCalled();
  });
});

describe('NotificationService.listForUser', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: NotificationService;

  beforeEach(() => {
    db = createMockDb();
    service = new NotificationService(db);
  });

  it('returns notifications ordered by createdAt descending', async () => {
    const mockNotifications = [
      { id: 'n2', userId: 'user-1', title: 'Second', message: 'msg', type: 'canceled', read: true, createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 'n1', userId: 'user-1', title: 'First', message: 'msg', type: 'confirmed', read: false, createdAt: '2026-01-01T00:00:00.000Z' },
    ];
    db.query.notifications.findMany.mockResolvedValue(mockNotifications);

    const result = await service.listForUser('user-1');

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('n2');
  });

  it('filters unread only when unreadOnly is true', async () => {
    db.query.notifications.findMany.mockResolvedValue([]);

    await service.listForUser('user-1', true);

    expect(db.query.notifications.findMany).toHaveBeenCalled();
  });
});

describe('NotificationService.markAsRead', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: NotificationService;

  beforeEach(() => {
    db = createMockDb();
    service = new NotificationService(db);
  });

  it('throws NotFoundError when notification does not exist', async () => {
    db.query.notifications.findFirst.mockResolvedValue(undefined);

    await expect(service.markAsRead('no-id', 'user-1')).rejects.toThrow(NotFoundError);
  });

  it('throws ForbiddenError when notification belongs to another user', async () => {
    db.query.notifications.findFirst.mockResolvedValue({
      id: 'n1', userId: 'user-2', title: 't', message: 'm', type: 'confirmed', read: false, createdAt: '2026-01-01T00:00:00.000Z',
    });

    await expect(service.markAsRead('n1', 'user-1')).rejects.toThrow(ForbiddenError);
  });

  it('marks notification as read', async () => {
    db.query.notifications.findFirst.mockResolvedValue({
      id: 'n1', userId: 'user-1', title: 't', message: 'm', type: 'confirmed', read: false, createdAt: '2026-01-01T00:00:00.000Z',
    });
    db._update.returning.mockResolvedValue([{
      id: 'n1', userId: 'user-1', title: 't', message: 'm', type: 'confirmed', read: true, createdAt: '2026-01-01T00:00:00.000Z',
    }]);

    const result = await service.markAsRead('n1', 'user-1');

    expect(result.read).toBe(true);
  });
});

describe('NotificationService.markAllRead', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: NotificationService;

  beforeEach(() => {
    db = createMockDb();
    service = new NotificationService(db);
  });

  it('updates all unread notifications for the user', async () => {
    await service.markAllRead('user-1');

    expect(db._update.fn).toHaveBeenCalled();
  });
});
