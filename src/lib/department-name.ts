/** The department field is either the joined relation or the raw FK slug. */
export function departmentName(dept: unknown): string {
  if (dept && typeof dept === 'object' && 'name' in dept) {
    return typeof dept.name === 'string' ? dept.name : '';
  }
  return typeof dept === 'string' ? dept : '';
}
