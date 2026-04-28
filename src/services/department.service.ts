import { eq } from 'drizzle-orm';
import { departments } from '@/db/schema';
import type { Database } from '@/db/client';
import { ConflictError, NotFoundError } from '@/middleware/error-handler';

interface CreateDepartmentInput {
  id: string;
  name: string;
  campus: string;
}

export class DepartmentService {
  constructor(private db: Database) {}

  async list() {
    return this.db.query.departments.findMany({
      orderBy: (d, { asc }) => [asc(d.campus), asc(d.name)],
    });
  }

  async create(input: CreateDepartmentInput) {
    const existing = await this.db.query.departments.findFirst({
      where: eq(departments.id, input.id),
    });
    if (existing) throw new ConflictError(`Já existe um departamento com o ID "${input.id}"`);

    const now = new Date().toISOString();
    await this.db.insert(departments).values({ ...input, createdAt: now, updatedAt: now });
    return this.db.query.departments.findFirst({ where: eq(departments.id, input.id) });
  }

  async update(id: string, input: Partial<Omit<CreateDepartmentInput, 'id'>>) {
    const existing = await this.db.query.departments.findFirst({
      where: eq(departments.id, id),
    });
    if (!existing) throw new NotFoundError('Department');

    await this.db
      .update(departments)
      .set({ ...input, updatedAt: new Date().toISOString() })
      .where(eq(departments.id, id));

    return this.db.query.departments.findFirst({ where: eq(departments.id, id) });
  }

  async validateId(id: string): Promise<boolean> {
    const found = await this.db.query.departments.findFirst({
      where: eq(departments.id, id),
    });
    return found != null;
  }
}
