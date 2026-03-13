const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const app = require('./server');

test('server module exports express app', () => {
  assert.equal(typeof app, 'function');
});

test('GET /api/health returns JSON payload', async () => {
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${baseUrl}/api/health`);

    assert.ok(response.status === 200 || response.status === 500);

    const data = await response.json();
    assert.equal(typeof data.ok, 'boolean');
    assert.ok('database' in data);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});


test('POST /api/notify requires auth', async () => {
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${baseUrl}/api/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'whatsapp', phone: '+996500000000', message: 'test' })
    });

    assert.equal(response.status, 401);
    const data = await response.json();
    assert.equal(data.error, 'Access denied');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
