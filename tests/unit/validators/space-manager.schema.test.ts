import { describe, it, expect } from 'vitest';
import { assignManagerSchema, removeManagerSchema } from '@/validators/space-manager.schema';

const VALID_SPACE_ID = '12345678-1234-4234-b234-123456789011';
const VALID_USER_ID = '12345678-1234-4234-b234-123456789003';

describe('assignManagerSchema', () => {
  it('accepts valid coordinator input', () => {
    const result = assignManagerSchema.safeParse({
      spaceId: VALID_SPACE_ID,
      userId: VALID_USER_ID,
      role: 'coordinator',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid maintainer input', () => {
    const result = assignManagerSchema.safeParse({
      spaceId: VALID_SPACE_ID,
      userId: VALID_USER_ID,
      role: 'maintainer',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid role', () => {
    const result = assignManagerSchema.safeParse({
      spaceId: VALID_SPACE_ID,
      userId: VALID_USER_ID,
      role: 'admin',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing spaceId', () => {
    const result = assignManagerSchema.safeParse({
      userId: VALID_USER_ID,
      role: 'coordinator',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing userId', () => {
    const result = assignManagerSchema.safeParse({
      spaceId: VALID_SPACE_ID,
      role: 'coordinator',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing role', () => {
    const result = assignManagerSchema.safeParse({
      spaceId: VALID_SPACE_ID,
      userId: VALID_USER_ID,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID spaceId', () => {
    const result = assignManagerSchema.safeParse({
      spaceId: 'not-a-uuid',
      userId: VALID_USER_ID,
      role: 'coordinator',
    });
    expect(result.success).toBe(false);
  });
});

describe('removeManagerSchema', () => {
  it('accepts valid input', () => {
    const result = removeManagerSchema.safeParse({
      spaceId: VALID_SPACE_ID,
      userId: VALID_USER_ID,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing fields', () => {
    const result = removeManagerSchema.safeParse({ spaceId: VALID_SPACE_ID });
    expect(result.success).toBe(false);
  });
});
