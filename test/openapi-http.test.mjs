import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from '../server.mjs';

const specifications = [
  ['/api/openapi.json', new URL('../docs/openapi.json', import.meta.url)],
  ['/api/openapi-ecurious.json', new URL('../docs/openapi-ecurious.json', import.meta.url)],
];
const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);

async function serve(t) {
  // Documentation and simulated requests must not invoke a live provider, even
  // when a developer has configured credentials elsewhere in their environment.
  const forbidden = name => new Proxy({}, { get(_target, property) {
    throw new Error(`Documentation test unexpectedly accessed ${name}.${String(property)}`);
  } });
  const server = createServer({ hardware: forbidden('hardware'), events: forbidden('events') });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  return `http://127.0.0.1:${server.address().port}`;
}

function resolveReference(specification, reference) {
  assert.match(reference, /^#\//, 'specifications are self-contained');
  return reference.slice(2).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((value, part) => {
      assert.ok(value && Object.hasOwn(value, part), `reference resolves: ${reference}`);
      return value[part];
    }, specification);
}

function walk(value, visit) {
  if (!value || typeof value !== 'object') return;
  visit(value);
  for (const child of Object.values(value)) walk(child, visit);
}

test('Swagger UI aliases and local assets support GET/HEAD without provider access', async t => {
  const base = await serve(t);
  for (const path of ['/docs', '/docs/', '/swagger', '/swagger/', '/swagger/index.html']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(await response.text(), /swagger-ui/i);
    const head = await fetch(`${base}${path}`, { method: 'HEAD' });
    assert.equal(head.status, 200, path);
    assert.equal(await head.text(), '');
    const post = await fetch(`${base}${path}`, { method: 'POST' });
    assert.equal(post.status, 405, path);
    assert.match(post.headers.get('allow'), /GET/);
    assert.match(post.headers.get('allow'), /HEAD/);
  }
  for (const path of ['/swagger/swagger-initializer.js', '/swagger/vendor/swagger-ui-bundle.js',
    '/swagger/vendor/swagger-ui-standalone-preset.js', '/swagger/vendor/swagger-ui.css']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, path);
    assert.ok((await response.text()).length > 100, path);
  }
  const initializer = await (await fetch(`${base}/swagger/swagger-initializer.js`)).text();
  for (const [path] of specifications) assert.ok(initializer.includes(path));
  assert.match(initializer, /persistAuthorization:\s*false/);
  assert.match(initializer, /validatorUrl:\s*null/);
});

test('downloaded specifications match the checked-in contracts and support HEAD/405', async t => {
  const base = await serve(t);
  for (const [path, file] of specifications) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), JSON.parse(await readFile(file, 'utf8')));
    const head = await fetch(`${base}${path}`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.match(head.headers.get('content-type'), /application\/json/);
    assert.equal(await head.text(), '');
    for (const method of ['POST', 'DELETE']) {
      const unsupported = await fetch(`${base}${path}`, { method });
      assert.equal(unsupported.status, 405);
      assert.match(unsupported.headers.get('allow'), /GET/);
      assert.match(unsupported.headers.get('allow'), /HEAD/);
    }
  }
});

test('OpenAPI documents contain resolvable references, unique operation IDs and explicit response schemas', async () => {
  for (const [, file] of specifications) {
    const specification = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(specification.openapi, '3.0.3');
    assert.ok(specification.info.title);
    assert.ok(specification.info.version);
    const operationIds = new Set();
    walk(specification, value => {
      if (value.$ref) resolveReference(specification, value.$ref);
    });
    for (const [path, pathItem] of Object.entries(specification.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!methods.has(method)) continue;
        assert.ok(operation.operationId, `${method} ${path} has an operationId`);
        assert.ok(!operationIds.has(operation.operationId), `unique operationId: ${operation.operationId}`);
        operationIds.add(operation.operationId);
        assert.ok(operation.responses && Object.keys(operation.responses).length, `${method} ${path} has responses`);
        for (let response of Object.values(operation.responses)) {
          if (response.$ref) response = resolveReference(specification, response.$ref);
          assert.ok(response.description, `${method} ${path} response has a description`);
          for (const content of Object.values(response.content ?? {})) assert.ok(content.schema);
        }
        for (const requirement of operation.security ?? specification.security ?? []) {
          for (const name of Object.keys(requirement)) {
            assert.ok(specification.components.securitySchemes[name], `${name} security scheme exists`);
          }
        }
      }
    }
    assert.ok(operationIds.size > 0);
  }
});

test('backend contract covers implemented API methods and separates owner and vision authentication', async () => {
  const specification = JSON.parse(await readFile(specifications[0][1], 'utf8'));
  const operations = Object.entries(specification.paths).flatMap(([path, item]) =>
    Object.keys(item).filter(method => methods.has(method)).map(method => `${method.toUpperCase()} ${path}`));
  assert.deepEqual(operations.sort(), [
    'GET /api/events', 'GET /api/hardware', 'GET /api/hardware/bookings', 'GET /api/hardware/slots',
    'GET /api/health', 'GET /api/simulation', 'GET /api/state',
    'POST /api/actions', 'POST /api/hardware/actions', 'POST /api/hardware/bookings',
    'POST /api/hardware/quote', 'POST /api/hardware/slots', 'POST /api/hardware/slots/cancel',
    'POST /api/hardware/slots/extend', 'POST /api/integrations/plate-recognition',
    'POST /api/reservations', 'POST /api/simulation/actions',
  ].sort());
  const ownerAuth = specification.paths['/api/hardware/slots'].post.security;
  const visionAuth = specification.paths['/api/integrations/plate-recognition'].post.security;
  assert.ok(ownerAuth?.length && ownerAuth.every(requirement => Object.keys(requirement).length));
  assert.ok(visionAuth?.length && visionAuth.every(requirement => Object.keys(requirement).length));
  assert.notDeepEqual(ownerAuth, visionAuth, 'the vision callback must not accept a driver JWT as its integration token');
  const serialized = JSON.stringify(specification);
  assert.ok(!serialized.includes('ECURIOUS_API_KEY='));
  assert.ok(!serialized.includes('EVENTBRITE_PRIVATE_TOKEN='));
});
