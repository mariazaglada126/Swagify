// Vercel serverless function: forwards a website request to Telegram.
// Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Vercel → Project → Settings → Environment Variables.
const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return res.status(503).json({ ok: false, error: 'not_configured' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const ig = String((body && body.instagram) || '').replace(/^@/, '').trim();
  if (!/^[A-Za-z0-9._]{1,30}$/.test(ig)) return res.status(400).json({ ok: false, error: 'bad_instagram' });
  const lines = Array.isArray(body.lines) ? body.lines.slice(0, 12).map((l) => String(l).slice(0, 80)) : [];
  const price = String(body.price || '').slice(0, 20);
  const text = `🆕 <b>New Swagify request</b>\n\n👤 Instagram: <a href="https://instagram.com/${esc(ig)}">@${esc(ig)}</a>\n\n${lines.map((l) => '• ' + esc(l)).join('\n')}\n\n💰 Estimate: <b>${esc(price)}</b>`;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true })
    });
    if (!r.ok) return res.status(502).json({ ok: false });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ ok: false });
  }
};
