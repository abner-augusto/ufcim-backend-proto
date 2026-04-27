import { z } from 'zod';

export const createInvitationSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  role: z.enum(['student', 'professor', 'staff', 'maintenance']),
  department: z.string().min(1).max(50),
  registration: z.string().min(1).optional(),
});
