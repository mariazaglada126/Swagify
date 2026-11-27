// Unit tests for the Vercel function: validation and duplicate protection. Telegram is stubbed — nothing is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const handler = require('../../api/request.js');
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_CHAT_ID = 'test-chat';
let sent = [];
handler.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true }; };
const call = (body) => new Promise((resolve) => {
  const res = { code: 0, status(c) { this.code = c; return this; }, json(j) { resolve({ code: this.code, body: j }); } };
  handler({ method: 'POST', body }, res);
});
const base = { instagram: 'swag.fan_1', lines: ['Figure · 15 cm / 5.9 in', 'Quantity 6 (−10%)'], price: '$297' };

test('rejects bad nicknames', async () => {
  for (const n of ['', 'has space', 'émoji', '.dot', 'dot.', 'two..dots', 'a'.repeat(31)]) {
    const r = await call({ ...base, instagram: n, requestId: 'id-bad-' + n.length + 'xxxxxx' });
    assert.equal(r.code, 400, n);
  }
  assert.equal(sent.length, 0);
});

test('sends once per requestId, retries are deduplicated', async () => {
  sent = [];
  const id = 'b2c7a3a0-1111-4222-8333-444455556666';
  const a = await call({ ...base, requestId: id });
  const b = await call({ ...base, requestId: id });
  assert.equal(a.code, 200); assert.equal(b.code, 200); assert.equal(b.body.duplicate, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /\$297/);
  assert.match(sent[0].text, /@swag\.fan_1/);
});

test('a failed Telegram call can be retried with the same id', async () => {
  sent = [];
  const id = 'c3d8b4b1-1111-4222-8333-444455556666';
  handler.fetch = async () => ({ ok: false });
  assert.equal((await call({ ...base, requestId: id })).code, 502);
  handler.fetch = async (u, init) => { sent.push(JSON.parse(init.body)); return { ok: true }; };
  assert.equal((await call({ ...base, requestId: id })).code, 200);
  assert.equal(sent.length, 1);
});
