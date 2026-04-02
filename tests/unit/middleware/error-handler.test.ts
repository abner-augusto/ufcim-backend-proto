import { describe, it, expect } from 'vitest';
import {
  AppError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
} from '@/middleware/error-handler';

describe('AppError', () => {
  it('stores statusCode, message, and code', () => {
    const err = new AppError(422, 'Unprocessable', 'INVALID');
    expect(err.statusCode).toBe(422);
    expect(err.message).toBe('Unprocessable');
    expect(err.code).toBe('INVALID');
    expect(err).toBeInstanceOf(Error);
  });

  it('code is optional', () => {
    const err = new AppError(500, 'Something went wrong');
    expect(err.code).toBeUndefined();
  });
});

describe('NotFoundError', () => {
  it('is a 404 with NOT_FOUND code', () => {
    const err = new NotFoundError('Space');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('Space not found');
    expect(err).toBeInstanceOf(AppError);
  });
});

describe('ConflictError', () => {
  it('is a 409 with CONFLICT code', () => {
    const err = new ConflictError('Slot already reserved');
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('CONFLICT');
    expect(err.message).toBe('Slot already reserved');
  });
});

describe('ForbiddenError', () => {
  it('is a 403 with FORBIDDEN code and default message', () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
    expect(err.message).toBe('You do not have permission to perform this action');
  });

  it('accepts a custom message', () => {
    const err = new ForbiddenError('Students cannot do this');
    expect(err.message).toBe('Students cannot do this');
  });
});

describe('UnauthorizedError', () => {
  it('is a 401 with UNAUTHORIZED code and default message', () => {
    const err = new UnauthorizedError();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
    expect(err.message).toBe('Authentication required');
  });
});
