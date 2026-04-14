import { describe, it, expect, beforeEach } from 'vitest';
import { UserService } from '@/services/user.service';
import { NotFoundError } from '@/middleware/error-handler';
import { createMockDb, SEED } from '../helpers/mock-db';

describe('UserService.getMeProfile', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: UserService;

  beforeEach(() => {
    db = createMockDb();
    service = new UserService(db);
  });

  it('returns user data plus unreadCount', async () => {
    db.query.users.findFirst.mockResolvedValue(SEED.user);
    db._select.where.mockResolvedValue([{ unreadCount: 3 }]);

    const result = await service.getMeProfile(SEED.user.id);

    expect(result).toMatchObject({
      id: SEED.user.id,
      name: SEED.user.name,
      unreadCount: 3,
    });
  });

  it('returns unreadCount as 0 when no unread notifications exist', async () => {
    db.query.users.findFirst.mockResolvedValue(SEED.user);
    db._select.where.mockResolvedValue([{ unreadCount: 0 }]);

    const result = await service.getMeProfile(SEED.user.id);

    expect(result.unreadCount).toBe(0);
  });

  it('reflects the exact number of unread notifications', async () => {
    db.query.users.findFirst.mockResolvedValue(SEED.user);
    db._select.where.mockResolvedValue([{ unreadCount: 7 }]);

    const result = await service.getMeProfile(SEED.user.id);

    expect(result.unreadCount).toBe(7);
  });

  it('throws NotFoundError when user does not exist', async () => {
    db.query.users.findFirst.mockResolvedValue(undefined);

    await expect(service.getMeProfile('no-such-id')).rejects.toThrow(NotFoundError);
  });
});

describe('UserService.getById', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: UserService;

  beforeEach(() => {
    db = createMockDb();
    service = new UserService(db);
  });

  it('returns user without unreadCount', async () => {
    db.query.users.findFirst.mockResolvedValue(SEED.user);

    const result = await service.getById(SEED.user.id);

    expect(result).toMatchObject({ id: SEED.user.id, name: SEED.user.name });
    expect((result as Record<string, unknown>).unreadCount).toBeUndefined();
  });

  it('throws NotFoundError when user does not exist', async () => {
    db.query.users.findFirst.mockResolvedValue(undefined);

    await expect(service.getById('no-such-id')).rejects.toThrow(NotFoundError);
  });
});
