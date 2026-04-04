import { describe, it, expect, beforeEach } from 'vitest';
import { SpaceManagerService } from '@/services/space-manager.service';
import { NotFoundError, ConflictError } from '@/middleware/error-handler';
import { createMockDb, SEED } from '../helpers/mock-db';

const STAFF_ID = SEED.spaceManager.assignedBy;

const ASSIGN_INPUT = {
  spaceId: SEED.spaceManager.spaceId,
  userId: SEED.spaceManager.userId,
  role: SEED.spaceManager.role,
};

describe('SpaceManagerService.assign', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: SpaceManagerService;

  beforeEach(() => {
    db = createMockDb();
    service = new SpaceManagerService(db);
    db._insert.returning.mockResolvedValue([SEED.spaceManager]);
  });

  it('happy path: assigns coordinator', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.users.findFirst.mockResolvedValue(SEED.user);
    db.query.spaceManagers.findFirst.mockResolvedValue(undefined);

    const result = await service.assign(STAFF_ID, ASSIGN_INPUT);

    expect(result).toMatchObject({ id: SEED.spaceManager.id });
    expect(db._insert.fn).toHaveBeenCalled();
  });

  it('happy path: assigns maintainer', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.users.findFirst.mockResolvedValue(SEED.user);
    db.query.spaceManagers.findFirst.mockResolvedValue(undefined);

    const result = await service.assign(STAFF_ID, { ...ASSIGN_INPUT, role: 'maintainer' });

    expect(result).toMatchObject({ id: SEED.spaceManager.id });
  });

  it('throws NotFoundError when space does not exist', async () => {
    db.query.spaces.findFirst.mockResolvedValue(undefined);

    await expect(service.assign(STAFF_ID, ASSIGN_INPUT)).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError when user does not exist', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.users.findFirst.mockResolvedValue(undefined);

    await expect(service.assign(STAFF_ID, ASSIGN_INPUT)).rejects.toThrow(NotFoundError);
  });

  it('throws ConflictError when user is already a manager of the space', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.users.findFirst.mockResolvedValue(SEED.user);
    db.query.spaceManagers.findFirst.mockResolvedValue(SEED.spaceManager);

    await expect(service.assign(STAFF_ID, ASSIGN_INPUT)).rejects.toThrow(ConflictError);
  });
});

describe('SpaceManagerService.remove', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: SpaceManagerService;

  beforeEach(() => {
    db = createMockDb();
    service = new SpaceManagerService(db);
  });

  it('happy path: removes an existing assignment', async () => {
    db.query.spaceManagers.findFirst.mockResolvedValue(SEED.spaceManager);

    await expect(
      service.remove(STAFF_ID, SEED.spaceManager.spaceId, SEED.spaceManager.userId)
    ).resolves.toBeUndefined();

    expect(db._delete.fn).toHaveBeenCalled();
  });

  it('throws NotFoundError when assignment does not exist', async () => {
    db.query.spaceManagers.findFirst.mockResolvedValue(undefined);

    await expect(
      service.remove(STAFF_ID, SEED.spaceManager.spaceId, SEED.spaceManager.userId)
    ).rejects.toThrow(NotFoundError);
  });
});

describe('SpaceManagerService.listBySpace', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: SpaceManagerService;

  beforeEach(() => {
    db = createMockDb();
    service = new SpaceManagerService(db);
  });

  it('returns managers with user details', async () => {
    const managerWithUser = { ...SEED.spaceManager, user: SEED.user };
    db.query.spaceManagers.findMany.mockResolvedValue([managerWithUser]);

    const result = await service.listBySpace(SEED.spaceManager.spaceId);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ userId: SEED.spaceManager.userId, user: { name: SEED.user.name } });
  });
});

describe('SpaceManagerService.listByUser', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: SpaceManagerService;

  beforeEach(() => {
    db = createMockDb();
    service = new SpaceManagerService(db);
  });

  it('returns spaces with space details', async () => {
    const managerWithSpace = { ...SEED.spaceManager, space: SEED.space };
    db.query.spaceManagers.findMany.mockResolvedValue([managerWithSpace]);

    const result = await service.listByUser(SEED.spaceManager.userId);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ spaceId: SEED.spaceManager.spaceId, space: { number: SEED.space.number } });
  });
});

describe('SpaceManagerService.isManager', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: SpaceManagerService;

  beforeEach(() => {
    db = createMockDb();
    service = new SpaceManagerService(db);
  });

  it('returns true when user is a manager', async () => {
    db.query.spaceManagers.findFirst.mockResolvedValue(SEED.spaceManager);

    const result = await service.isManager(SEED.spaceManager.userId, SEED.spaceManager.spaceId);

    expect(result).toBe(true);
  });

  it('returns false when user is not a manager', async () => {
    db.query.spaceManagers.findFirst.mockResolvedValue(undefined);

    const result = await service.isManager(SEED.spaceManager.userId, SEED.spaceManager.spaceId);

    expect(result).toBe(false);
  });
});
