import type { UserRole } from '@/types/auth';

export const ROLE_LABELS: Record<UserRole, string> = {
  student: 'estudante',
  professor: 'professor',
  staff: 'funcionário',
  maintenance: 'manutenção',
};

export const ROLE_LABELS_TITLE: Record<UserRole, string> = {
  student: 'Estudante',
  professor: 'Professor(a)',
  staff: 'Funcionário',
  maintenance: 'Manutenção',
};
