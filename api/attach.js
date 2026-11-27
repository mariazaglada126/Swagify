// Vercel serverless function: forwards one reference file (photo or PDF) from the request form
// to Telegram, as a reply to that request's message. The browser must present the signature it got
// from /api/request, so nobody else can drop files into the chat.
const order = require('./request.js');

const MAX_BYTES = 3.2 * 1024 * 1024; // Vercel accepts ~4.5 MB per request; base64 adds a third
const MAX_FILES = 5;
const TYPES = { 'image/jpeg': 'photo', 'image/png': 'photo', 'image/webp': 'photo', 'application/pdf': 'document' };
const used = new Map(); // sig -> Set(idx)

async function attach(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  b = b || {};
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = order.chatId();
  if (!token || !chat) return res.status(503).json({ ok: false, error: 'not_configured' });
  const id = String(b.requestId || ''), messageId = parseInt(b.messageId, 10), sig = String(b.sig || '');
  if (!id || !messageId || sig !== order.sign(token, id, messageId)) return res.status(403).json({ ok: false, error: 'bad_signature' });
  const idx = parseInt(b.idx, 10), total = Math.min(MAX_FILES, parseInt(b.total, 10) || 1);
  if (!(idx >= 0 && idx < MAX_FILES)) return res.status(400).json({ ok: false, error: 'too_many_files' });
  const kind = TYPES[String(b.type || '')];
  if (!kind) return res.status(400).json({ ok: false, error: 'bad_type' });
  const buf = Buffer.from(String(b.data || ''), 'base64');
  if (!buf.length) return res.status(400).json({ ok: false, error: 'empty' });
  if (buf.length > MAX_BYTES) return res.status(413).json({ ok: false, error: 'too_big' });
  const set = used.get(sig) || new Set();
  if (set.has(idx)) return res.status(200).json({ ok: true, duplicate: true });
  if (used.size > 2000) used.clear();

  const name = String(b.name || `reference-${idx + 1}`).replace(/[^\w.\- ]+/g, '_').slice(0, 80) || `reference-${idx + 1}`;
  const caption = `📎 Reference ${idx + 1}/${total}`;
  const send = async (method, field) => {
    const fd = new FormData();
    fd.append('chat_id', String(chat));
    fd.append('caption', caption);
    fd.append('reply_parameters', JSON.stringify({ message_id: messageId, allow_sending_without_reply: true }));
    fd.append(field, new Blob([buf], { type: String(b.type) }), name);
    const r = await (attach.fetch || fetch)(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', body: fd });
    const j = r.json ? await r.json().catch(() => ({})) : {};
    return !!r.ok && j.ok !== false;
  };
  try {
    // photos show inline; if Telegram refuses one as a photo (odd size), send it as a file instead
    let ok = kind === 'photo' ? await send('sendPhoto', 'photo') : false;
    if (!ok) ok = await send('sendDocument', 'document');
    if (!ok) return res.status(502).json({ ok: false });
    set.add(idx); used.set(sig, set);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ ok: false });
  }
}
module.exports = attach;
