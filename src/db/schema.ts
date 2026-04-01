import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// ─── Users ───────────────────────────────────────────────────────────────────
export const users = sqliteTable('users', {
  id: text('id').primaryKey(), // UUID
  name: text('name').notNull(),
  registration: text('registration').notNull().unique(),
  role: text('role').notNull(), // 'student' | 'professor' | 'staff' | 'maintenance'
  department: text('department').notNull(),
  email: text('email').notNull().unique(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── Spaces (ambientes) ─────────────────────────────────────────────────────
export const spaces = sqliteTable('spaces', {
  id: text('id').primaryKey(),
  number: text('number').notNull(),
  type: text('type').notNull(), // 'classroom' | 'study_room' | 'meeting_room' | 'hall'
  block: text('block').notNull(),
  campus: text('campus').notNull(),
  department: text('department').notNull(),
  capacity: integer('capacity').notNull(),
  furniture: text('furniture'),
  lighting: text('lighting'),
  hvac: text('hvac'),
  multimedia: text('multimedia'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── Equipment (equipamentos) ───────────────────────────────────────────────
export const equipment = sqliteTable('equipment', {
  id: text('id').primaryKey(),
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
  status: text('status').notNull(), // 'confirmed' | 'canceled' | 'modified' | 'overridden'
  recurrenceId: text('recurrence_id').references(() => recurrences.id),
  changeOrigin: text('change_origin'),
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
  sentAt: text('sent_at').notNull(),
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

// ─── Relations ──────────────────────────────────────────────────────────────
export const usersRelations = relations(users, ({ many }) => ({
  reservations: many(reservations),
  blockings: many(blockings),
  notifications: many(notifications),
  auditLogs: many(auditLogs),
}));

export const spacesRelations = relations(spaces, ({ many }) => ({
  equipment: many(equipment),
  reservations: many(reservations),
  blockings: many(blockings),
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
