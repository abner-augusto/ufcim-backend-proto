import type { ErrorHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv } from '@/types/env';

export const globalErrorHandler: ErrorHandler<AppEnv> = (err, c) => {
  const isProd = c.env.ENVIRONMENT === 'production';

  const logRecord: Record<string, unknown> = {
    msg: err.message,
    name: err.name,
    code: (err as AppError).code,
    status: (err as AppError).statusCode,
    path: c.req.path,
    method: c.req.method,
  };
  if (!isProd) logRecord.stack = err.stack;
  console.error(JSON.stringify(logRecord));

  if (err instanceof AppError) {
    return c.json(
      { error: err.message, code: err.code },
      err.statusCode as ContentfulStatusCode
    );
  }

  return c.json(
    { error: isProd ? 'Erro interno do servidor' : (err.message ?? 'Erro interno do servidor'), code: 'INTERNAL_ERROR' },
    500
  );
};

const resourceLabels: Record<string, string> = {
  Space: 'Espaço',
  User: 'Usuário',
  Notification: 'Notificação',
  Reservation: 'Reserva',
  Blocking: 'Bloqueio',
  Equipment: 'Equipamento',
  'Recurring reservation series': 'Série de reservas recorrentes',
  'Space manager assignment': 'Atribuição de gestor de espaço',
  'Audit log entry': 'Registro de auditoria',
};

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    const label = resourceLabels[resource] ?? resource;
    super(404, `${label} não encontrado(a)`, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, 'CONFLICT');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Você não tem permissão para executar esta ação') {
    super(403, message, 'FORBIDDEN');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Autenticação obrigatória') {
    super(401, message, 'UNAUTHORIZED');
  }
}
