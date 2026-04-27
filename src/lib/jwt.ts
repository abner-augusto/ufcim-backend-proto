import { SignJWT, jwtVerify } from 'jose';
import type { JwtPayload, UserRole } from '@/types/auth';

interface SignAccessTokenInput {
  userId: string;
  email: string;
  name: string;
  registration: string | null;
  department: string;
  role: UserRole;
  isMasterAdmin: boolean;
  issuer: string;
  secret: string;
  ttlSeconds?: number; // default 900 (15 min)
}

export async function signAccessToken(input: SignAccessTokenInput): Promise<string> {
  const {
    userId,
    email,
    name,
    registration,
    department,
    role,
    isMasterAdmin,
    issuer,
    secret,
    ttlSeconds = 900,
  } = input;

  const roles = [`ufcim-${role}`];
  if (isMasterAdmin) roles.push('ufcim-master-admin');

  const payload: Omit<JwtPayload, 'exp' | 'iss'> & { [key: string]: unknown } = {
    sub: userId,
    email,
    name,
    preferred_username: registration ?? email,
    department,
    realm_access: { roles },
  };

  if (registration !== null) {
    payload['registration'] = registration;
  }

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(issuer)
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(new TextEncoder().encode(secret));
}

export async function verifyAccessToken(
  token: string,
  issuer: string,
  secret: string
): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    issuer,
    algorithms: ['HS256'],
  });
  return payload as unknown as JwtPayload;
}
