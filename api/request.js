// Vercel serverless function: forwards a website quote request to Telegram.
// Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Vercel → Project → Settings → Environment Variables.
// Each request carries a requestId from the browser; "Try again" re-sends the same id, so a retry
// after a lost response is answered from memory instead of posting the order twice.
// Who gets the requests: Telegram user @layylyon. Their chat id is filled in once found via /api/request?setup
const NOTIFY_USERNAME = 'layylyon';
const DEFAULT_CHAT_ID = '624398287'; // @layylyon (not secret: only this bot's token can write there)
const chatId = () => process.env.TELEGRAM_CHAT_ID || DEFAULT_CHAT_ID;
const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const IG = /^(?!\.)(?!.*\.\.)(?!.*\.$)[A-Za-z0-9._]{1,30}$/;
const ID = /^[A-Za-z0-9-]{8,64}$/;
const seen = new Map(); // requestId -> time (kept while this instance is warm)
const TTL = 30 * 60 * 1000;
// Anti-spam: hidden "website" field must stay empty, the form must be open ≥ 1.5 s (the page waits for that itself),
// and one IP may send at most 5 requests per 10 minutes (per warm instance).
const hits = new Map(); // ip -> [times]
const RATE_N = 5, RATE_WIN = 10 * 60 * 1000;
function limited(ip) {
  const now = Date.now(), list = (hits.get(ip) || []).filter((t) => now - t < RATE_WIN);
  if (hits.size > 5000) hits.clear();
  if (list.length >= RATE_N) { hits.set(ip, list); return true; }
  list.push(now); hits.set(ip, list); return false;
}

function remember(id) {
  const now = Date.now();
  for (const [k, t] of seen) if (now - t > TTL) seen.delete(k);
  seen.set(id, now);
}

async function handler(req, res) {
  // GET /api/request → is Telegram configured? (sends nothing; safe to open in a browser)
  if (req.method === 'GET') {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const q = (req.query && req.query.setup !== undefined) || /[?&]setup\b/.test(req.url || '');
    if (q) {
      // one-time helper: find the chat id of @layylyon among people who wrote to the bot
      if (!token) return res.status(200).json({ ok: false, step: 'add TELEGRAM_BOT_TOKEN in Vercel and redeploy' });
      try {
        const f = handler.fetch || fetch;
        const bot = await (await f(`https://api.telegram.org/bot${token}/getMe`)).json();
        if (!bot.ok) return res.status(200).json({ ok: false, step: 'the token in Vercel is not valid — copy it again from BotFather' });
        const j = await (await f(`https://api.telegram.org/bot${token}/getUpdates`)).json();
        const chats = (j.result || []).map((u) => (u.message || u.edited_message || u.my_chat_member || {}).chat).filter(Boolean);
        const me = chats.find((c) => String(c.username || '').toLowerCase() === NOTIFY_USERNAME);
        if (me) return res.status(200).json({ ok: true, chat_id: String(me.id), username: me.username });
        const seen = [...new Map(chats.map((c) => [c.id, { username: c.username || null, name: c.first_name || c.title || null }])).values()];
        return res.status(200).json({ ok: false, bot: '@' + bot.result.username, updates: (j.result || []).length, getUpdatesError: j.ok ? undefined : j.description, wrote_to_bot: seen, step: `open https://t.me/${bot.result.username} from @${NOTIFY_USERNAME}, press Start / write any message, then reload` });
      } catch (e) { return res.status(200).json({ ok: false, step: 'could not reach Telegram, reload in a minute' }); }
    }
    return res.status(200).json({ ok: true, configured: !!(token && chatId()) });
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const ig = String(body.instagram || '').replace(/^@/, '').trim().toLowerCase();
  if (!IG.test(ig)) return res.status(400).json({ ok: false, error: 'bad_instagram' });
  const id = String(body.requestId || '');
  if (!ID.test(id)) return res.status(400).json({ ok: false, error: 'bad_request_id' });
  if (seen.has(id)) return res.status(200).json({ ok: true, duplicate: true });
  // bots: pretend success, send nothing
  if (String(body.website || '') !== '' || (Number(body.elapsed) || 0) < 1500) return res.status(200).json({ ok: true });
  const ip = String((req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return res.status(429).json({ ok: false, error: 'too_many' });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = chatId();
  if (!token || !chat) return res.status(503).json({ ok: false, error: 'not_configured' });

  const lines = Array.isArray(body.lines) ? body.lines.slice(0, 40).map((l) => String(l).slice(0, 120)) : [];
  const price = String(body.price || '').slice(0, 20);
  const typed = String(body.typed || '').slice(0, 80);
  remember(id); // claim the id before sending so a parallel retry can't post twice
  // one request at a time per warm instance, so two buyers can't grab the same number
  const job = queue.then(() => sendOrder({ token, chat, ig, typed, lines, price }));
  queue = job.catch(() => {});
  try {
    const ok = await job;
    if (!ok) { seen.delete(id); return res.status(502).json({ ok: false }); }
    return res.status(200).json({ ok: true });
  } catch (e) {
    seen.delete(id);
    return res.status(502).json({ ok: false });
  }
}

/* Order numbers 001…999 (then 001 again). There is no database: the bot pins the latest request
   in the Telegram chat and the next number is read from that pinned message. Don't unpin it,
   or numbering restarts at 001. */
let queue = Promise.resolve();
// "27.11.2026, 22:47" — Kyiv time, 24-hour clock, as written in Ukraine
function kyivTime(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kiev', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}.${p.month}.${p.year}, ${p.hour}:${p.minute}`;
}
async function tg(token, method, payload) {
  const r = await (handler.fetch || fetch)(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const j = r.json ? await r.json().catch(() => ({})) : {};
  return { ok: !!r.ok && j.ok !== false, result: j.result };
}
async function sendOrder({ token, chat, ig, typed, lines, price }) {
  let num = null, prevPin = null;
  try {
    const c = await tg(token, 'getChat', { chat_id: chat });
    const pin = c.result && c.result.pinned_message;
    const m = pin && /#(\d{3})\b/.exec(pin.text || '');
    const prev = m ? parseInt(m[1], 10) : 0;
    num = prev >= 999 ? 1 : prev + 1;
    prevPin = pin ? pin.message_id : null;
  } catch (e) { num = null; }
  const tag = num ? ` #${String(num).padStart(3, '0')}` : '';
  const typedNote = typed && typed.replace(/^@/, '') !== ig ? `\n✍️ Typed as: ${esc(typed)}` : '';
  const text = `🆕 <b>New Swagify request${tag}</b>\n🕒 ${kyivTime()}\n\n👤 Instagram: <a href="https://instagram.com/${esc(ig)}">@${esc(ig)}</a>${typedNote}\n\n${lines.map((l) => '• ' + esc(l)).join('\n')}\n\n💰 Estimate: <b>${esc(price)}</b> + shipping`;
  const sent = await tg(token, 'sendMessage', { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true });
  if (!sent.ok) return false;
  try {
    if (num && sent.result && sent.result.message_id) {
      await tg(token, 'pinChatMessage', { chat_id: chat, message_id: sent.result.message_id, disable_notification: true });
      if (prevPin) await tg(token, 'unpinChatMessage', { chat_id: chat, message_id: prevPin });
    }
  } catch (e) { /* numbering is best effort; the request itself was delivered */ }
  return true;
}
module.exports = handler;
