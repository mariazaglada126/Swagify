// Unit tests for the Vercel function: validation and duplicate protection. Telegram is stubbed — nothing is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const handler = require('../../api/request.js');
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_CHAT_ID = 'test-chat';
// fake Telegram: remembers the pinned message like the real chat does
let sent = [], pinned = null, mid = 100, failSend = false, uploads = [];
const fakeTg = async (url, init) => {
  const m = /\/bot[^/]+\/(\w+)/.exec(url)[1];
  const b = init && typeof init.body === 'string' ? JSON.parse(init.body) : init && init.body instanceof FormData ? Object.fromEntries(init.body.entries()) : {};
  if (m === 'sendPhoto' || m === 'sendDocument') { uploads.push({ m, ...b }); return { ok: true, json: async () => ({ ok: true, result: {} }) }; }
  const reply = (ok, result) => ({ ok, json: async () => ({ ok, result }) });
  if (m === 'getMe') return reply(true, { username: 'TestBot' });
  if (m === 'getChat') return reply(true, pinned ? { pinned_message: pinned } : {});
  if (m === 'sendMessage') { if (failSend) return reply(false); sent.push(b); return reply(true, { message_id: ++mid, text: b.text }); }
  if (m === 'pinChatMessage') { const msg = sent.find((x, i) => 101 + i === b.message_id) || sent[sent.length - 1]; pinned = { message_id: b.message_id, text: msg.text }; return reply(true, true); }
  if (m === 'unpinChatMessage') return reply(true, true);
  return reply(false);
};
handler.fetch = fakeTg;
const call = (body) => new Promise((resolve) => {
  const res = { code: 0, status(c) { this.code = c; return this; }, json(j) { resolve({ code: this.code, body: j }); } };
  handler({ method: body.__method || 'POST', body, headers: body.__ip ? { 'x-forwarded-for': body.__ip } : {} }, res);
});
const base = { instagram: 'swag.fan_1', lines: ['Figure · 15 cm / 5.9 in', 'Quantity 6 (−10%)'], price: '$297', elapsed: 5000, website: '' };

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
  failSend = true;
  assert.equal((await call({ ...base, requestId: id })).code, 502);
  failSend = false;
  assert.equal((await call({ ...base, requestId: id })).code, 200);
  assert.equal(sent.length, 1);
});

test('GET reports whether Telegram is configured, without sending', async () => {
  sent = [];
  const r = await call({ __method: 'GET' });
  assert.equal(r.code, 200); assert.equal(r.body.configured, true); assert.equal(sent.length, 0);
});

test('bots are ignored: filled honeypot or instant submit', async () => {
  sent = [];
  assert.equal((await call({ ...base, website: 'http://spam', requestId: 'd4e9c5c2-1111-4222-8333-444455556666' })).code, 200);
  assert.equal((await call({ ...base, elapsed: 200, requestId: 'e5f0d6d3-1111-4222-8333-444455556666' })).code, 200);
  assert.equal(sent.length, 0);
});

test('rate limit: 5 requests per IP per 10 minutes', async () => {
  sent = [];
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await call({ ...base, __ip: '203.0.113.9', requestId: `f6a1e7e${i}-1111-4222-8333-444455556666` })).code);
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429]);
  assert.equal(sent.length, 5);
  assert.equal((await call({ ...base, __ip: '198.51.100.4', requestId: 'a7b2f8f9-1111-4222-8333-444455556666' })).code, 200);
});

test('orders are numbered #001, #002 … and wrap after #999', async () => {
  sent = []; pinned = null;
  await call({ ...base, __ip: '192.0.2.1', requestId: 'b1b1b1b1-1111-4222-8333-444455556666' });
  await call({ ...base, __ip: '192.0.2.1', requestId: 'b2b2b2b2-1111-4222-8333-444455556666' });
  assert.match(sent[0].text, /request #001/); assert.match(sent[1].text, /request #002/);
  pinned = { message_id: 1, text: 'New Swagify request #999' };
  await call({ ...base, __ip: '192.0.2.2', requestId: 'b3b3b3b3-1111-4222-8333-444455556666' });
  assert.match(sent[2].text, /request #001/);
});

test('nickname is lowercased; what the buyer typed is shown when it differs', async () => {
  sent = [];
  await call({ ...base, instagram: 'Mushy.Akk', typed: 'Mushy.Akk ', __ip: '192.0.2.3', requestId: 'c1c1c1c1-1111-4222-8333-444455556666' });
  assert.match(sent[0].text, /instagram\.com\/mushy\.akk/);
  assert.match(sent[0].text, /Typed as: Mushy\.Akk/);
});

test('request shows the Kyiv time like 27.11.2026, 22:47', async () => {
  sent = [];
  await call({ ...base, __ip: '192.0.2.9', requestId: 'd9d9d9d9-1111-4222-8333-444455556666' });
  assert.match(sent[0].text, /🕒 \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}/);
});

const attach = require('../../api/attach.js');
attach.fetch = (...a) => fakeTg(...a);
const callAttach = (body) => new Promise((resolve) => {
  const res = { code: 0, status(c) { this.code = c; return this; }, json(j) { resolve({ code: this.code, body: j }); } };
  attach({ method: 'POST', body }, res);
});
test('reference files reach Telegram as replies, only with a valid signature', async () => {
  sent = []; uploads = [];
  const id = 'e1e1e1e1-1111-4222-8333-444455556666';
  const r = await call({ ...base, files: 2, __ip: '192.0.2.20', requestId: id });
  assert.equal(r.code, 200); assert.ok(r.body.sig); assert.ok(r.body.messageId);
  assert.match(sent[0].text, /References: 2/);
  const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
  const ok = await callAttach({ requestId: id, messageId: r.body.messageId, sig: r.body.sig, idx: 0, total: 2, name: 'my sketch.png', type: 'image/png', data: png });
  assert.equal(ok.code, 200);
  assert.equal(uploads.length, 1); assert.equal(uploads[0].m, 'sendPhoto'); assert.match(uploads[0].caption, /Reference 1\/2/);
  assert.equal(JSON.parse(uploads[0].reply_parameters).message_id, r.body.messageId);
  // same file again (retry) is not posted twice
  await callAttach({ requestId: id, messageId: r.body.messageId, sig: r.body.sig, idx: 0, total: 2, name: 'x.png', type: 'image/png', data: png });
  assert.equal(uploads.length, 1);
  // forged signature, wrong type, too many, too big
  assert.equal((await callAttach({ requestId: id, messageId: r.body.messageId, sig: 'nope', idx: 1, type: 'image/png', data: png })).code, 403);
  assert.equal((await callAttach({ requestId: id, messageId: r.body.messageId, sig: r.body.sig, idx: 1, type: 'application/x-msdownload', data: png })).code, 400);
  assert.equal((await callAttach({ requestId: id, messageId: r.body.messageId, sig: r.body.sig, idx: 5, type: 'image/png', data: png })).code, 400);
  const big = Buffer.alloc(3.3 * 1024 * 1024).toString('base64');
  assert.equal((await callAttach({ requestId: id, messageId: r.body.messageId, sig: r.body.sig, idx: 1, type: 'application/pdf', data: big })).code, 413);
  // a duplicate order request hands back the same message and signature, so uploads can resume
  const again = await call({ ...base, files: 2, __ip: '192.0.2.20', requestId: id });
  assert.equal(again.body.sig, r.body.sig);
});
