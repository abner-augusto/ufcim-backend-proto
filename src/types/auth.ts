export interface JwtPayload {
  sub: string;            // Keycloak user ID
  email: string;
  name: string;
  preferred_username: string;
  realm_access?: {
    roles: string[];
  };
  department?: string;
  registration?: string;
  exp: number;
  iss: string;
}

export type UserRole = 'student' | 'professor' | 'staff' | 'maintenance';
