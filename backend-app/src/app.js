import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import KcAdminClient, { NetworkError } from '@keycloak/keycloak-admin-client';

const textField = (value, max = 255) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;

export function createApp(config, { fetchImpl = fetch, verifyToken, adminClientFactory = (options) => new KcAdminClient(options) } = {}) {
  const app = express();
  const realmUrl = `${config.keycloakUrl}/realms/${encodeURIComponent(config.realm)}`;
  const tokenUrl = `${realmUrl}/protocol/openid-connect/token`;
  const userInfoUrl = `${realmUrl}/protocol/openid-connect/userinfo`;
  const jwks = createRemoteJWKSet(new URL(`${realmUrl}/protocol/openid-connect/certs`));
  const verify = verifyToken ?? ((token) => jwtVerify(token, jwks, { issuer: realmUrl, algorithms: ['RS256'] }));

  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  const loginLimit = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
  const registerLimit = rateLimit({ windowMs: 60 * 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false });

  function createAdminClient(accessToken) {
    const client = adminClientFactory({ baseUrl: config.keycloakUrl, realmName: config.realm, timeout: 10_000 });
    if (accessToken) client.registerTokenProvider({ getAccessToken: async () => accessToken });
    return client;
  }

  const getBearerToken = (req) => /^Bearer (\S+)$/i.exec(req.get('authorization') ?? '')?.[1];

  function respondToAdminError(res, error, messages) {
    if (!(error instanceof NetworkError)) throw error;
    const status = error.response.status;
    const message = messages[status];
    return res.status(message ? status : 502).json({ error: message ?? messages.default });
  }

  function requireAdminRole(roleName) {
    return async (req, res, next) => {
      const token = getBearerToken(req);
      if (!token) return res.status(401).json({ error: 'Bearer token required' });
      let payload;
      try {
        ({ payload } = await verify(token));
      } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      if (payload.azp !== config.clientId || payload.typ !== 'Bearer') {
        return res.status(401).json({ error: 'Token is not for this client' });
      }
      const roles = payload.resource_access?.['realm-management']?.roles;
      if (!Array.isArray(roles) || !roles.includes(roleName)) {
        return res.status(403).json({ error: `${roleName} role required` });
      }
      req.keycloakAccessToken = token;
      next();
    };
  }

  function roleFromBody(body) {
    const { name, description } = body ?? {};
    if (!textField(name) || (description !== undefined && typeof description !== 'string')) return null;
    const role = { name: name.trim() };
    if (description !== undefined) role.description = description.trim();
    return role;
  }

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  app.post('/api/auth/login', loginLimit, async (req, res) => {
    const { username, password } = req.body ?? {};
    if (!textField(username) || !textField(password, 1024)) {
      return res.status(400).json({ error: 'username and password are required' });
    }

    const response = await fetchImpl(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'password',
        scope: 'openid',
        username: username.trim(),
        password,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 400 || response.status === 401) {
      return res.status(401).json({ error: 'Invalid credentials or account requires action in Keycloak' });
    }
    if (!response.ok) return res.status(502).json({ error: 'Keycloak login failed' });
    res.set('Cache-Control', 'no-store');
    return res.json(await response.json());
  });

  app.get('/api/users/me', async (req, res) => {
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: 'Bearer token required' });

    const response = await fetchImpl(userInfoUrl, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401) return res.status(401).json({ error: 'Invalid or expired token' });
    if (response.status === 403) return res.status(403).json({ error: 'Keycloak denied user info access' });
    if (!response.ok) return res.status(502).json({ error: 'Keycloak user info lookup failed' });

    let payload;
    try {
      ({ payload } = await verify(token));
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const clientRoles = Object.fromEntries(
      Object.entries(payload.resource_access ?? {})
        .filter(([, access]) => Array.isArray(access?.roles))
        .map(([clientId, access]) => [clientId, access.roles]),
    );

    res.set('Cache-Control', 'no-store');
    return res.json({
      ...await response.json(),
      roles: {
        realm: Array.isArray(payload.realm_access?.roles) ? payload.realm_access.roles : [],
        clients: clientRoles,
      },
    });
  });

  app.post('/api/users/register', registerLimit, async (req, res) => {
    const { username, password, email, firstName, lastName } = req.body ?? {};
    if (!textField(username) || !textField(password, 1024) || password.length < 8 ||
        (email !== undefined && (!textField(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) ||
        (firstName !== undefined && !textField(firstName)) ||
        (lastName !== undefined && !textField(lastName))) {
      return res.status(400).json({ error: 'Invalid registration fields; password must be at least 8 characters' });
    }

    const admin = createAdminClient();
    try {
      await admin.auth({ grantType: 'client_credentials', clientId: config.clientId, clientSecret: config.clientSecret });
    } catch (error) {
      return respondToAdminError(res, error, { default: 'Keycloak service authentication failed' });
    }

    // Only allow profile fields from the request. Roles, groups and credentials are server controlled.
    const user = {
      username: username.trim(),
      enabled: true,
      emailVerified: email !== undefined,
      credentials: [{ type: 'password', value: password, temporary: false }],
    };
    if (email !== undefined) user.email = email.trim();
    if (firstName !== undefined) user.firstName = firstName.trim();
    if (lastName !== undefined) user.lastName = lastName.trim();

    try {
      const { id } = await admin.users.create(user);
      return res.status(201).json({ id, username: user.username });
    } catch (error) {
      return respondToAdminError(res, error, {
        409: 'Username or email already exists',
        default: 'Keycloak user creation failed',
      });
    }
  });

  const createRealmRole = async (req, res) => {
    const role = roleFromBody(req.body);
    if (!role) return res.status(400).json({ error: 'Valid role name required' });
    try {
      await createAdminClient(req.keycloakAccessToken).roles.create(role);
      return res.status(201).json(role);
    } catch (error) {
      return respondToAdminError(res, error, {
        401: 'Invalid or expired token',
        403: 'Keycloak denied role creation',
        409: 'Role already exists',
        default: 'Keycloak role creation failed',
      });
    }
  };

  app.post('/api/roles/realm', requireAdminRole('manage-realm'), createRealmRole);
  app.post('/api/roles', requireAdminRole('manage-realm'), createRealmRole); // Existing route remains an alias.

  app.post('/api/roles/client', requireAdminRole('manage-clients'), async (req, res) => {
    const { clientId } = req.body ?? {};
    const role = roleFromBody(req.body);
    if (!textField(clientId) || !role) {
      return res.status(400).json({ error: 'Valid clientId and role name required' });
    }

    const targetClientId = clientId.trim();
    const admin = createAdminClient(req.keycloakAccessToken);
    let clients;
    try {
      clients = await admin.clients.find({ clientId: targetClientId });
    } catch (error) {
      return respondToAdminError(res, error, {
        401: 'Invalid or expired token',
        403: 'Keycloak denied client lookup',
        default: 'Keycloak client lookup failed',
      });
    }
    const client = clients.find((item) => item.clientId === targetClientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    try {
      await admin.clients.createRole({ id: client.id, ...role });
      return res.status(201).json({ clientId: client.clientId, ...role });
    } catch (error) {
      return respondToAdminError(res, error, {
        401: 'Invalid or expired token',
        403: 'Keycloak denied client role creation',
        409: 'Role already exists for this client',
        default: 'Keycloak client role creation failed',
      });
    }
  });

  app.use((error, _req, res, _next) => {
    if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'Invalid JSON' });
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      return res.status(504).json({ error: 'Keycloak request timed out' });
    }
    console.error('Backend request failed:', error);
    return res.status(502).json({ error: 'Upstream service unavailable' });
  });

  return app;
}
