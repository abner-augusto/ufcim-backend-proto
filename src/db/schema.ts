import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';

// ─── Departments ─────────────────────────────────────────────────────────────
export const departments = sqliteTable('departments', {
  id: text('id').primaryKey(), // slug, e.g. "iaud"
  name: text('name').notNull(),
  campus: text('campus').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── Users ───────────────────────────────────────────────────────────────────
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(), // UUID
    name: text('name').notNull(),
    registration: text('registration'), // nullable — invitees may not have one
    role: text('role').notNull(), // 'student' | 'professor' | 'staff' | 'maintenance'
    department: text('department').notNull().references(() => departments.id),
    email: text('email').notNull().unique(),
    isMasterAdmin: integer('is_master_admin', { mode: 'boolean' }).notNull().default(false),
    disabledAt: text('disabled_at'), // ISO timestamp or null (null = active)
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    registrationUnq: uniqueIndex('users_registration_unq').on(t.registration).where(sql`registration IS NOT NULL`),
  })
);

// ─── Spaces (ambientes) ─────────────────────────────────────────────────────
export const spaces = sqliteTable('spaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  // number is capped at 20 chars — enforced in the Zod validator (createSpaceSchema)
  number: text('number').notNull(),
  type: text('type').notNull(), // 'classroom' | 'study_room' | 'meeting_room' | 'hall'
  block: text('block').notNull(),
  campus: text('campus').notNull(),
  department: text('department').notNull().references(() => departments.id),
  capacity: integer('capacity').notNull(),
  furniture: text('furniture'),
  lighting: text('lighting'),
  hvac: text('hvac'),
  multimedia: text('multimedia'),
  modelId: text('model_id').unique(), // GLB pin name (e.g. "Auditório" from Pin_Auditório)
  reservable: integer('reservable', { mode: 'boolean' }).notNull().default(true),
  closedFrom: text('closed_from').notNull().default('22:00'),
  closedTo: text('closed_to').notNull().default('07:00'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── Equipment (equipamentos) ───────────────────────────────────────────────
export const equipment = sqliteTable('equipment', {
  id: text('id').primaryKey(),
  assetId: text('asset_id').notNull().unique(),
  spaceId: text('space_id').notNull().references(() => spaces.id),
  name: text('name').notNull(),
  type: text('type').notNull(),
  status: text('status').notNull(), // 'working' | 'broken' | 'under_repair' | 'replacement_scheduled'
  notes: text('notes'),
  updatedBy: text('updated_by').references(() => users.id),
  updatedAt: text('updated_at').notNull(),
});

// ─── Recurrences (recorrencias) ─────────────────────────────────────────────
export const recurrences = sqliteTable('recurrences', {
  id: text('id').primaryKey(),
  description: text('description').notNull(),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: text('created_at').notNull(),
});

// ─── Reservations (reservas) ────────────────────────────────────────────────
export const reservations = sqliteTable('reservations', {
  id: text('id').primaryKey(),
  spaceId: text('space_id').notNull().references(() => spaces.id),
  userId: text('user_id').notNull().references(() => users.id),
  date: text('date').notNull(), // ISO date: YYYY-MM-DD
  timeSlot: text('time_slot').notNull(), // 'morning' | 'afternoon' | 'evening'
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  status: text('status').notNull(), // 'confirmed' | 'canceled' | 'modified' | 'overridden'
  recurrenceId: text('recurrence_id').references(() => recurrences.id),
  changeOrigin: text('change_origin'),
  purpose: text('purpose'),
  cancelReason: text('cancel_reason'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── Blockings (bloqueios) ──────────────────────────────────────────────────
export const blockings = sqliteTable('blockings', {
  id: text('id').primaryKey(),
  spaceId: text('space_id').notNull().references(() => spaces.id),
  createdBy: text('created_by').notNull().references(() => users.id),
  date: text('date').notNull(),
  timeSlot: text('time_slot').notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  reason: text('reason').notNull(),
  blockType: text('block_type').notNull(), // 'maintenance' | 'administrative'
  status: text('status').notNull().default('active'), // 'active' | 'removed'
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── Notifications (notificacoes) ───────────────────────────────────────────
export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  message: text('message').notNull(),
  type: text('type').notNull(), // 'confirmed' | 'canceled' | 'modified' | 'overridden'
  read: integer('read', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});

// ─── Audit Logs (logs) ─────────────────────────────────────────────────────
export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  actionType: text('action_type').notNull(),
  referenceId: text('reference_id'),
  referenceType: text('reference_type'), // 'reservation' | 'blocking' | 'equipment' | 'space'
  timestamp: text('timestamp').notNull(),
  details: text('details'),
});

// ─── Space Managers (gestores de espaços) ───────────────────────────────────
export const spaceManagers = sqliteTable(
  'space_managers',
  {
    id: text('id').primaryKey(),
    spaceId: text('space_id').notNull().references(() => spaces.id),
    userId: text('user_id').notNull().references(() => users.id),
    role: text('role').notNull(), // 'coordinator' | 'maintainer'
    assignedBy: text('assigned_by').notNull().references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    spaceUserUnique: uniqueIndex('space_managers_space_user_unq').on(t.spaceId, t.userId),
  })
);

// ─── User Credentials ────────────────────────────────────────────────────────
export const userCredentials = sqliteTable('user_credentials', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  passwordHash: text('password_hash').notNull(), // format: "pbkdf2$<iterations>$<saltB64>$<hashB64>"
  passwordUpdatedAt: text('password_updated_at').notNull(),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: text('locked_until'), // ISO timestamp or null
});

// ─── Invitations ─────────────────────────────────────────────────────────────
export const invitations = sqliteTable('invitations', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  role: text('role').notNull(), // student | professor | staff | maintenance
  name: text('name').notNull(),
  registration: text('registration'), // nullable — invitee may not have one
  department: text('department').notNull().references(() => departments.id),
  tokenHash: text('token_hash').notNull().unique(), // SHA-256 of URL token, hex
  purpose: text('purpose').notNull().default('invite'), // 'invite' | 'reset'
  invitedBy: text('invited_by').notNull().references(() => users.id),
  expiresAt: text('expires_at').notNull(),
  acceptedAt: text('accepted_at'), // null = pending
  acceptedUserId: text('accepted_user_id').references(() => users.id),
  revokedAt: text('revoked_at'), // null = not revoked
  createdAt: text('created_at').notNull(),
});

// ─── Refresh Tokens ──────────────────────────────────────────────────────────
export const refreshTokens = sqliteTable('refresh_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(), // SHA-256 hex of opaque token
  expiresAt: text('expires_at').notNull(),
  revokedAt: text('revoked_at'), // null = valid
  replacedBy: text('replaced_by'), // refresh_tokens.id of next token
  userAgent: text('user_agent'),
  createdAt: text('created_at').notNull(),
});

// ─── Relations ──────────────────────────────────────────────────────────────
export const departmentsRelations = relations(departments, ({ many }) => ({
  users: many(users),
  spaces: many(spaces),
  invitations: many(invitations),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  department: one(departments, { fields: [users.department], references: [departments.id] }),
  reservations: many(reservations),
  blockings: many(blockings),
  notifications: many(notifications),
  auditLogs: many(auditLogs),
  managedSpaces: many(spaceManagers, { relationName: 'manager' }),
  assignedManagers: many(spaceManagers, { relationName: 'assigner' }),
  credentials: one(userCredentials),
  invitationsSent: many(invitations, { relationName: 'inviter' }),
  refreshTokens: many(refreshTokens),
}));

export const spacesRelations = relations(spaces, ({ one, many }) => ({
  department: one(departments, { fields: [spaces.department], references: [departments.id] }),
  equipment: many(equipment),
  reservations: many(reservations),
  blockings: many(blockings),
  managers: many(spaceManagers),
}));

export const recurrencesRelations = relations(recurrences, ({ one, many }) => ({
  creator: one(users, { fields: [recurrences.createdBy], references: [users.id] }),
  reservations: many(reservations),
}));

export const reservationsRelations = relations(reservations, ({ one }) => ({
  space: one(spaces, { fields: [reservations.spaceId], references: [spaces.id] }),
  user: one(users, { fields: [reservations.userId], references: [users.id] }),
  recurrence: one(recurrences, { fields: [reservations.recurrenceId], references: [recurrences.id] }),
}));

export const blockingsRelations = relations(blockings, ({ one }) => ({
  space: one(spaces, { fields: [blockings.spaceId], references: [spaces.id] }),
  creator: one(users, { fields: [blockings.createdBy], references: [users.id] }),
}));

export const equipmentRelations = relations(equipment, ({ one }) => ({
  space: one(spaces, { fields: [equipment.spaceId], references: [spaces.id] }),
  updater: one(users, { fields: [equipment.updatedBy], references: [users.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}));

export const spaceManagersRelations = relations(spaceManagers, ({ one }) => ({
  space: one(spaces, { fields: [spaceManagers.spaceId], references: [spaces.id] }),
  user: one(users, { fields: [spaceManagers.userId], references: [users.id], relationName: 'manager' }),
  assigner: one(users, { fields: [spaceManagers.assignedBy], references: [users.id], relationName: 'assigner' }),
}));

export const userCredentialsRelations = relations(userCredentials, ({ one }) => ({
  user: one(users, { fields: [userCredentials.userId], references: [users.id] }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  department: one(departments, { fields: [invitations.department], references: [departments.id] }),
  inviter: one(users, { fields: [invitations.invitedBy], references: [users.id], relationName: 'inviter' }),
  acceptedUser: one(users, { fields: [invitations.acceptedUserId], references: [users.id], relationName: 'acceptedUser' }),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}));
