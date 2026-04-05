import { createMiddleware } from 'hono/factory';
import { z } from 'zod';

/**
 * Validates the JSON request body against a Zod schema.
 * On success: stores the parsed value in c.get('validatedBody').
 * On failure: returns 400 with field-level error details.
 *
 * Usage: route.post('/path', validate(mySchema), handler)
 */
export function validate<T extends z.ZodType>(schema: T) {
  return createMiddleware<{ Variables: { validatedBody: z.infer<T> } }>(async (c, next) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'O corpo da requisição deve ser um JSON válido', code: 'INVALID_BODY' }, 400);
    }

    const result = schema.safeParse(body);
    if (!result.success) {
      return c.json(
        {
          error: 'Validação falhou',
          code: 'VALIDATION_ERROR',
          details: result.error.issues.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
        400
      );
    }

    c.set('validatedBody', result.data);
    await next();
  });
}

/**
 * Validates URL query parameters against a Zod schema.
 * On success: stores the parsed value in c.get('validatedQuery').
 * On failure: returns 400 with field-level error details.
 *
 * Usage: route.get('/path', validateQuery(mySchema), handler)
 */
export function validateQuery<T extends z.ZodType>(schema: T) {
  return createMiddleware<{ Variables: { validatedQuery: z.infer<T> } }>(async (c, next) => {
    const result = schema.safeParse(c.req.query());
    if (!result.success) {
      return c.json(
        {
          error: 'Parâmetros de consulta inválidos',
          code: 'VALIDATION_ERROR',
          details: result.error.issues.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
        400
      );
    }

    c.set('validatedQuery', result.data);
    await next();
  });
}
