/**
 * Hardcoded RSA public key served at GET /dev/jwks for local development.
 * The matching private key is in scripts/generate-test-token.mjs.
 *
 * In production, delete this file and point JWKS_URL at the real Keycloak endpoint.
 */
export const DEV_JWKS = {
  keys: [
    {
      kty: 'RSA',
      n: 'nsyMuWdrEm48RWiI3Zj3MA-eWDgyvA1YvzpQkJl_CmP6o5WrGvVmgPu0QDhIOJkbks7NB9DeHLzFXFRxprwrkRrM3Gps4z_QhC_TeFKkIJ7zBiyKKInUYM9Cga-544rR0XKsGZcx6OyYNvmC9IL_9r-_YcOxOim0RUal2LODRgIEAll6z5RtKnvbPr1WBI2nUFS1u8cH3eqIEGvEqwDzrSiKULBZOy1Ahaa0LMHDZOCik1PU5Tr7MRfiE4pUfzATZPiffsbo8coPj8pJ6pooFKh5GfO9C2nKt1zEdXMZZYOSF0ugizuwpz2-U5YZPTcNdCkHtWI_eBJ0uExmfY6ZFQ',
      e: 'AQAB',
      kid: 'ufcim-dev-key-1',
      use: 'sig',
      alg: 'RS256',
    },
  ],
};
