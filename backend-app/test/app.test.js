import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, test } from 'node:test';
import { NetworkError } from '@keycloak/keycloak-admin-client';
import { createApp } from '../src/app.js';

const config = {
  keycloakUrl: 'http://keycloak.test',
  realm: 'sso-demo',
  clientId: 'backend-app',
  clientSecret: 'test-secret',
};
const servers = [];
after(() => Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve)))));

async function start(options, appConfig = config) {
  const server = createApp(appConfig, options).listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

const adminError = (status) => new NetworkError('Keycloak error', {
  response: new Response(null, { status }), responseData: {},
});

test('register creates a user without accepting caller supplied privileges', async () => {
  let auth, created, clientOptions;
  const base = await start({
    adminClientFactory: (options) => {
      clientOptions = options;
      return {
        auth: async (credentials) => { auth = credentials; },
        users: { create: async (user) => { created = user; return { id: 'user-123' }; } },
      };
    },
  });
  const response = await fetch(`${base}/api/users/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'long-password', email: 'alice@example.com', emailVerified: false, realmRoles: ['admin'], enabled: false }),
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: 'user-123', username: 'alice' });
  assert.deepEqual(clientOptions, { baseUrl: 'http://keycloak.test', realmName: 'sso-demo', timeout: 10_000 });
  assert.deepEqual(auth, { grantType: 'client_credentials', clientId: 'backend-app', clientSecret: 'test-secret' });
  assert.deepEqual(created, {
    username: 'alice', enabled: true, emailVerified: true,
    credentials: [{ type: 'password', value: 'long-password', temporary: false }], email: 'alice@example.com',
  });
});

test('register leaves email unverified when no email is provided', async () => {
  let created;
  const base = await start({ adminClientFactory: () => ({
    auth: async () => {},
    users: { create: async (user) => { created = user; return { id: 'user-456' }; } },
  }) });
  const response = await fetch(`${base}/api/users/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'bob', password: 'long-password', emailVerified: true }),
  });
  assert.equal(response.status, 201);
  assert.equal(created.emailVerified, false);
  assert.equal(created.email, undefined);
});

test('register returns conflict from Keycloak', async () => {
  const base = await start({ adminClientFactory: () => ({
    auth: async () => {},
    users: { create: async () => { throw adminError(409); } },
  }) });
  const response = await fetch(`${base}/api/users/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'long-password' }),
  });
  assert.equal(response.status, 409);
});

test('login sends password grant to Keycloak and returns tokens without caching', async () => {
  let form;
  const base = await start({ fetchImpl: async (_url, options) => {
    form = new URLSearchParams(options.body);
    return Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 300 });
  } });
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'long-password' }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(form.get('grant_type'), 'password');
  assert.equal(form.get('scope'), 'openid');
  assert.equal(form.get('client_id'), 'backend-app');
  assert.equal(form.get('username'), 'alice');
  assert.deepEqual(await response.json(), { access_token: 'access', refresh_token: 'refresh', expires_in: 300 });
});

test('user info returns the profile for a valid access token without caching', async () => {
  const calls = [];
  const profile = { sub: 'user-123', preferred_username: 'alice', email: 'alice@example.com' };
  const base = await start({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return Response.json(profile);
    },
    verifyToken: async (token) => {
      assert.equal(token, 'user-token');
      return { payload: {
        realm_access: { roles: ['viewer'] },
        resource_access: {
          'react-app-3000': { roles: ['editor'] },
          account: { roles: ['manage-account'] },
        },
      } };
    },
  });

  const response = await fetch(`${base}/api/users/me`, {
    headers: { authorization: 'Bearer user-token' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    ...profile,
    roles: {
      realm: ['viewer'],
      clients: { 'react-app-3000': ['editor'], account: ['manage-account'] },
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://keycloak.test/realms/sso-demo/protocol/openid-connect/userinfo');
  assert.equal(calls[0].options.headers.authorization, 'Bearer user-token');
  assert.equal(calls[0].options.method, undefined);
});

test('user info returns empty role collections when the token has no role claims', async () => {
  const base = await start({
    fetchImpl: async () => Response.json({ sub: 'user-123' }),
    verifyToken: async () => ({ payload: {} }),
  });
  const response = await fetch(`${base}/api/users/me`, {
    headers: { authorization: 'Bearer user-token' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sub: 'user-123', roles: { realm: [], clients: {} } });
});

test('user info rejects a token that fails signature verification', async () => {
  const base = await start({
    fetchImpl: async () => Response.json({ sub: 'user-123' }),
    verifyToken: async () => { throw new Error('invalid signature'); },
  });
  const response = await fetch(`${base}/api/users/me`, {
    headers: { authorization: 'Bearer invalid-token' },
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Invalid or expired token' });
});

test('user info requires a bearer token and rejects an expired token', async () => {
  let calls = 0;
  const base = await start({ fetchImpl: async () => {
    calls += 1;
    return new Response(null, { status: 401 });
  } });

  const missing = await fetch(`${base}/api/users/me`);
  assert.equal(missing.status, 401);
  assert.deepEqual(await missing.json(), { error: 'Bearer token required' });
  assert.equal(calls, 0);

  const expired = await fetch(`${base}/api/users/me`, {
    headers: { authorization: 'Bearer expired-token' },
  });
  assert.equal(expired.status, 401);
  assert.deepEqual(await expired.json(), { error: 'Invalid or expired token' });
  assert.equal(calls, 1);
});

test('user info reports Keycloak failures without exposing upstream responses', async () => {
  const base = await start({ fetchImpl: async () => new Response('internal details', { status: 500 }) });
  const response = await fetch(`${base}/api/users/me`, {
    headers: { authorization: 'Bearer user-token' },
  });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'Keycloak user info lookup failed' });
});

test('realm role creation requires manage-realm', async () => {
  const calls = [];
  const base = await start({
    adminClientFactory: () => ({
      registerTokenProvider: (provider) => { calls.push({ provider }); },
      roles: { create: async (role) => { calls.push({ role }); } },
    }),
    verifyToken: async (token) => ({ payload: {
      azp: 'backend-app', typ: 'Bearer',
      resource_access: { 'realm-management': { roles: token === 'admin-token' ? ['manage-realm'] : [] } },
    } }),
  });
  const request = (token) => fetch(`${base}/api/roles/realm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ name: 'editor', description: 'Can edit' }),
  });
  assert.equal((await request()).status, 401);
  assert.equal((await request('ordinary-token')).status, 403);
  const response = await request('admin-token');
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { name: 'editor', description: 'Can edit' });
  assert.equal(await calls[0].provider.getAccessToken(), 'admin-token');
  assert.deepEqual(calls[1], { role: { name: 'editor', description: 'Can edit' } });
});

test('client role creation requires manage-clients and resolves clientId to UUID', async () => {
  const calls = [];
  const base = await start({
    adminClientFactory: () => ({
      registerTokenProvider: (provider) => { calls.push({ provider }); },
      clients: {
        find: async (query) => { calls.push({ query }); return [{ id: 'client-uuid', clientId: 'react-app-3000' }]; },
        createRole: async (role) => { calls.push({ role }); },
      },
    }),
    verifyToken: async (token) => ({ payload: {
      azp: 'backend-app', typ: 'Bearer',
      resource_access: { 'realm-management': { roles: token === 'client-admin' ? ['manage-clients'] : ['manage-realm'] } },
    } }),
  });
  const request = (token) => fetch(`${base}/api/roles/client`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ clientId: 'react-app-3000', name: 'viewer', description: 'Can view' }),
  });
  assert.equal((await request('realm-admin')).status, 403);
  assert.deepEqual(calls, []);
  const response = await request('client-admin');
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { clientId: 'react-app-3000', name: 'viewer', description: 'Can view' });
  assert.equal(await calls[0].provider.getAccessToken(), 'client-admin');
  assert.deepEqual(calls.slice(1), [
    { query: { clientId: 'react-app-3000' } },
    { role: { id: 'client-uuid', name: 'viewer', description: 'Can view' } },
  ]);
});

test('client role creation returns 404 for an unknown client', async () => {
  const base = await start({
    adminClientFactory: () => ({ registerTokenProvider: () => {}, clients: { find: async () => [] } }),
    verifyToken: async () => ({ payload: {
      azp: 'backend-app', typ: 'Bearer',
      resource_access: { 'realm-management': { roles: ['manage-clients'] } },
    } }),
  });
  const response = await fetch(`${base}/api/roles/client`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer client-admin' },
    body: JSON.stringify({ clientId: 'missing-client', name: 'viewer' }),
  });
  assert.equal(response.status, 404);
});

test('client role creation calls Keycloak through the installed admin client', async () => {
  const calls = [];
  const keycloak = createServer(async (req, res) => {
    const body = await new Promise((resolve) => {
      let value = '';
      req.on('data', (chunk) => { value += chunk; });
      req.on('end', () => resolve(value));
    });
    calls.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body });
    if (req.method === 'GET' && req.url === '/admin/realms/sso-demo/clients/?clientId=react-app-3000') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ id: 'client-uuid', clientId: 'react-app-3000' }]));
    } else if (req.method === 'POST' && req.url === '/admin/realms/sso-demo/clients/client-uuid/roles') {
      res.writeHead(201, { location: '/admin/realms/sso-demo/clients/client-uuid/roles/viewer' });
      res.end();
    } else {
      res.writeHead(404);
      res.end();
    }
  }).listen(0, '127.0.0.1');
  servers.push(keycloak);
  await new Promise((resolve) => keycloak.once('listening', resolve));

  const base = await start({
    verifyToken: async () => ({ payload: {
      azp: 'backend-app', typ: 'Bearer',
      resource_access: { 'realm-management': { roles: ['manage-clients'] } },
    } }),
  }, { ...config, keycloakUrl: `http://127.0.0.1:${keycloak.address().port}` });
  const response = await fetch(`${base}/api/roles/client`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer client-admin' },
    body: JSON.stringify({ clientId: 'react-app-3000', name: 'viewer' }),
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { clientId: 'react-app-3000', name: 'viewer' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].authorization, 'Bearer client-admin');
  assert.equal(calls[0].url, '/admin/realms/sso-demo/clients/?clientId=react-app-3000');
  assert.equal(calls[1].authorization, 'Bearer client-admin');
  assert.deepEqual(JSON.parse(calls[1].body), { name: 'viewer' });
});
