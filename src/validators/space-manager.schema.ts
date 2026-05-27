import { z } from 'zod';

export const assignManagerSchema = z.object({
  spaceId: z.string().min(1, 'ID do espaço é obrigatório'),
  userId: z.string().min(1, 'ID do usuário é obrigatório'),
  role: z.enum(['coordinator', 'maintainer']),
});

export const removeManagerSchema = z.object({
  spaceId: z.string().min(1, 'ID do espaço é obrigatório'),
  userId: z.string().min(1, 'ID do usuário é obrigatório'),
});
