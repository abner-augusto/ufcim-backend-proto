import { describe, it, expect, beforeEach } from 'vitest';
import { UserService } from '@/services/user.service';
import { NotFoundError } from '@/middleware/error-handler';
import { createMockDb, SEED } from '../helpers/mock-db';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

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

describe('UserService.searchRequesters (MEL-025)', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: UserService;
  const dialect = new SQLiteSyncDialect();

  beforeEach(() => {
    db = createMockDb();
    service = new UserService(db);
    db.query.users.findMany.mockResolvedValue([
      { id: 'prof-1', name: 'Dra. Maria Costa', role: 'professor', email: 'maria@ufc.br', department: { id: 'iaud', name: 'IAUD' } },
    ]);
  });

  it('returns { id, name, role, department } only, with the department name', async () => {
    const result = await service.searchRequesters('maria', 'staff-1');
    expect(result).toEqual([{ id: 'prof-1', name: 'Dra. Maria Costa', role: 'professor', department: 'IAUD' }]);
  });

  it('matches name or e-mail among active, non-maintenance users other than me, capped at 10', async () => {
    await service.searchRequesters('Maria', 'staff-1');

    const args = db.query.users.findMany.mock.calls[0][0];
    const { sql, params } = dialect.sqlToQuery(args.where as SQL);
    expect(sql).toContain('"disabled_at" is null');
    expect(sql).toContain('"deleted_at" is null');
    expect(sql).toMatch(/"role" <> \?/);
    expect(sql).toMatch(/"id" <> \?/);
    expect(sql).toMatch(/lower\("users"\."name"\) like \? escape '\\' or lower\("users"\."email"\) like \? escape '\\'/);
    expect(params).toEqual(expect.arrayContaining(['maintenance', 'staff-1', '%maria%']));
    expect(args.limit).toBe(10);
  });

  it('escapes LIKE wildcards in the query', async () => {
    await service.searchRequesters('100%_a', 'staff-1');

    const { params } = dialect.sqlToQuery(db.query.users.findMany.mock.calls[0][0].where as SQL);
    expect(params).toContain('%100\\%\\_a%');
  });
});
