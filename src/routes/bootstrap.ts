import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { AppEnv } from '@/types/env';
import { createDb } from '@/db/client';
import { users } from '@/db/schema';
import { hashPassword } from '@/lib/crypto';
import { passwordPolicySchema } from '@/validators/auth.schema';
import { validate } from '@/middleware/validation';
import { rateLimit } from '@/middleware/rate-limit';
import { ConflictError, UnauthorizedError } from '@/middleware/error-handler';

const bootstrapSchema = z.object({
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
  name: z.string().min(1),
  department: z.string().min(1),
  password: passwordPolicySchema,
});

export const bootstrapRoutes = new Hono<AppEnv>();

bootstrapRoutes.post('/master-admin', rateLimit({ namespace: 'bootstrap', max: 5, windowSeconds: 600 }), validate(bootstrapSchema), async (c) => {
  const expected = c.env.BOOTSTRAP_TOKEN;
  const provided = c.req.header('X-Bootstrap-Token');

  if (!expected || !provided || expected !== provided) {
    throw new UnauthorizedError('Token de bootstrap inválido');
  }

  const db = createDb(c.env.DB);

  const existing = await db.query.users.findFirst({
    where: eq(users.isMasterAdmin, true),
  });
  if (existing) {
    throw new ConflictError('Master admin já existe');
  }

  const body = c.get('validatedBody') as z.infer<typeof bootstrapSchema>;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(body.password);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO users (id, name, registration, role, department, email, is_master_admin, disabled_at, created_at, updated_at)
       VALUES (?, ?, NULL, 'staff', ?, ?, 1, NULL, ?, ?)`
    ).bind(id, body.name, body.department, body.email, now, now),
    c.env.DB.prepare(
      `INSERT INTO user_credentials (user_id, password_hash, password_updated_at, failed_attempts, locked_until)
       VALUES (?, ?, ?, 0, NULL)`
    ).bind(id, passwordHash, now),
  ]);

  return c.json({
    ok: true,
    userId: id,
    message: 'Master admin criado. Remova o secret BOOTSTRAP_TOKEN imediatamente.',
  });
});
