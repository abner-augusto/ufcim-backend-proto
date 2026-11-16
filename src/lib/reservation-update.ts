import { and, eq, ne } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { recurrences, reservations } from '@/db/schema';
import { AppError, ConflictError, ForbiddenError } from '@/middleware/error-handler';
import { deriveLegacyTimeSlot, meetsMinimumDuration, timeToMinutes } from '@/lib/schedule';
import type { NotificationService } from '@/services/notification.service';

export interface RequesterColumns {
  requesterUserId: string | null;
  requesterName: string | null;
  requesterContact: string | null;
}

export interface ResolvedRequesterUpdate {
  columns: RequesterColumns;
  actorName: string;
  requesterLabel: string;
}

export interface RequesterUpdateFields {
  requesterUserId?: string | null;
  requesterName?: string | null;
  requesterContact?: string | null;
}

type ResolveRequesterFn = (input: {
  requesterUserId?: string;
  requesterName?: string;
  requesterContact?: string;
}) => Promise<ResolvedRequesterUpdate | null>;

type ReservationRow = typeof reservations.$inferSelect;

export async function resolveRequesterUpdate(
  actorRole: string,
  reservation: ReservationRow,
  input: RequesterUpdateFields,
  resolveCreate: ResolveRequesterFn
): Promise<ResolvedRequesterUpdate | null> {
  if (input.requesterUserId === undefined && input.requesterName === undefined && input.requesterContact === undefined) {
    return null;
  }
  if (actorRole !== 'staff') {
    throw new ForbiddenError('Apenas funcionários podem reservar em nome de outra pessoa');
  }

  const userIdVal = input.requesterUserId?.trim() || null;
  const nameVal = input.requesterName?.trim() || null;
  const contactVal = input.requesterContact?.trim() || null;

  if (userIdVal && nameVal) {
    throw new AppError(400, 'Informe um usuário cadastrado ou um nome, não os dois', 'INVALID_REQUESTER');
  }
  if (userIdVal) return resolveCreate({ requesterUserId: userIdVal, requesterContact: contactVal ?? undefined });
  if (nameVal) return resolveCreate({ requesterName: nameVal, requesterContact: contactVal ?? undefined });
  if (contactVal) {
    throw new AppError(400, 'Informe o solicitante para registrar o contato', 'INVALID_REQUESTER');
  }

  const clearing = input.requesterUserId === null || input.requesterName === null;
  return {
    columns: {
      requesterUserId: clearing ? null : (reservation.requesterUserId ?? null),
      requesterName: clearing ? null : (reservation.requesterName ?? null),
      requesterContact: null,
    },
    actorName: '',
    requesterLabel: clearing ? 'nenhum' : (reservation.requesterName ?? reservation.requesterUserId ?? 'nenhum'),
  };
}

export function assertValidTimeRange(startTime: string, endTime: string) {
  if (timeToMinutes(startTime) >= timeToMinutes(endTime)) {
    throw new AppError(400, 'O horário de término deve ser posterior ao horário de início', 'VALIDATION_ERROR');
  }
  if (!meetsMinimumDuration(startTime, endTime)) {
    throw new AppError(400, 'A reserva deve durar pelo menos 1 hora', 'VALIDATION_ERROR');
  }
}

export async function persistReservationUpdate(
  db: Database,
  reservation: ReservationRow,
  next: { date: string; startTime: string; endTime: string },
  description: string | null,
  requesterUpdate: ResolvedRequesterUpdate | null
) {
  const now = new Date().toISOString();
  const singleQuery = db
    .update(reservations)
    .set({
      date: next.date,
      timeSlot: deriveLegacyTimeSlot(next.startTime),
      startTime: next.startTime,
      endTime: next.endTime,
      description,
      ...(requesterUpdate ? requesterUpdate.columns : {}),
      updatedAt: now,
    })
    .where(eq(reservations.id, reservation.id))
    .returning();

  try {
    if (requesterUpdate && reservation.recurrenceId) {
      const [rows] = await db.batch([
        singleQuery,
        db
          .update(reservations)
          .set({ ...requesterUpdate.columns, updatedAt: now })
          .where(
            and(
              eq(reservations.recurrenceId, reservation.recurrenceId),
              ne(reservations.status, 'canceled'),
              ne(reservations.id, reservation.id)
            )
          ),
        db
          .update(recurrences)
          .set(requesterUpdate.columns)
          .where(eq(recurrences.id, reservation.recurrenceId)),
      ]);
      return rows[0];
    }
    const [updated] = await singleQuery;
    return updated;
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
      throw new ConflictError('Esta faixa de horário conflita com uma reserva existente');
    }
    throw error;
  }
}

export function buildUpdateAuditDetails(
  spaceNumber: string,
  reservation: ReservationRow,
  next: { date: string; startTime: string; endTime: string },
  description: string | null,
  requesterUpdate: ResolvedRequesterUpdate | null
) {
  const from = `${reservation.date} ${reservation.startTime}-${reservation.endTime}`;
  const to = `${next.date} ${next.startTime}-${next.endTime}`;
  const changes = [`${from} → ${to}`];
  if (description !== reservation.description) {
    changes.push(`descrição: "${reservation.description ?? ''}" → "${description ?? ''}"`);
  }
  if (requesterUpdate) {
    changes.push(`solicitante: ${requesterUpdate.requesterLabel}`);
  }
  return `Editou a reserva do espaço ${spaceNumber}: ${changes.join('; ')}`;
}

export async function notifyReservationUpdate(
  notification: NotificationService,
  reservation: ReservationRow,
  spaceNumber: string,
  userId: string,
  next: { date: string; startTime: string; endTime: string },
  requesterUpdate: ResolvedRequesterUpdate | null
) {
  if (reservation.userId !== userId) {
    await notification.create(
      reservation.userId,
      'Reserva alterada',
      `Sua reserva para o espaço ${spaceNumber} foi alterada: agora em ${next.date} (${next.startTime}-${next.endTime}).`,
      'modified'
    );
  }

  const oldRequesterId = reservation.requesterUserId ?? null;
  const newRequesterId = requesterUpdate ? requesterUpdate.columns.requesterUserId : oldRequesterId;

  if (oldRequesterId === newRequesterId) {
    if (oldRequesterId && oldRequesterId !== userId) {
      await notification.create(
        oldRequesterId,
        'Reserva alterada',
        `A reserva do espaço ${spaceNumber} feita para você foi alterada: agora em ${next.date} (${next.startTime}-${next.endTime}).`,
        'modified'
      );
    }
    return;
  }

  if (oldRequesterId && oldRequesterId !== userId) {
    await notification.create(
      oldRequesterId,
      'Solicitante da reserva alterado',
      reservation.recurrenceId
        ? `Você deixou de ser o solicitante da série de reservas do espaço ${spaceNumber}.`
        : `Você deixou de ser o solicitante da reserva do espaço ${spaceNumber} em ${next.date} (${next.startTime}-${next.endTime}).`,
      'modified'
    );
  }

  if (newRequesterId && newRequesterId !== userId) {
    await notification.create(
      newRequesterId,
      reservation.recurrenceId ? 'Reservas recorrentes feitas para você' : 'Reserva feita para você',
      reservation.recurrenceId
        ? `${requesterUpdate!.actorName} definiu você como solicitante da série de reservas do espaço ${spaceNumber} (${next.startTime}-${next.endTime}).`
        : `${requesterUpdate!.actorName} reservou o espaço ${spaceNumber} para você em ${next.date} (${next.startTime}-${next.endTime}).`,
      'confirmed'
    );
  }
}
