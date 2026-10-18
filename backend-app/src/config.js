import 'dotenv/config';

export function loadConfig(env = process.env) {
  const required = ['KEYCLOAK_URL', 'KEYCLOAK_REALM', 'KEYCLOAK_CLIENT_ID', 'KEYCLOAK_CLIENT_SECRET'];
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);

  const port = Number(env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');

  const url = new URL(env.KEYCLOAK_URL);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('KEYCLOAK_URL must use HTTP or HTTPS');

  return {
    port,
    keycloakUrl: url.toString().replace(/\/$/, ''),
    realm: env.KEYCLOAK_REALM,
    clientId: env.KEYCLOAK_CLIENT_ID,
    clientSecret: env.KEYCLOAK_CLIENT_SECRET,
  };
}
