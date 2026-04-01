import { z } from 'zod';

export const spaceTypeSchema = z.enum(['classroom', 'study_room', 'meeting_room', 'hall']);

export const createSpaceSchema = z.object({
  number: z.string().min(1).max(50),
  type: spaceTypeSchema,
  block: z.string().min(1).max(50),
  campus: z.string().min(1).max(100),
  department: z.string().min(1).max(100),
  capacity: z.number().int().positive(),
  furniture: z.string().optional(),
  lighting: z.string().optional(),
  hvac: z.string().optional(),
  multimedia: z.string().optional(),
});

export const updateSpaceSchema = createSpaceSchema.partial();

export const spaceQuerySchema = z.object({
  campus: z.string().optional(),
  block: z.string().optional(),
  department: z.string().optional(),
  type: spaceTypeSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
