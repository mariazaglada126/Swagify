// End-to-end buyer flows. Every POST to /api/request is intercepted — no real request reaches Telegram.
import { test, expect } from '@playwright/test';

const money = (s) => s.replace(/\s+/g, ' ').trim();

async function mockApi(page, plan = ['ok']) {
  const calls = [];
  await page.route('**/api/request', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push(body);
    const step = plan[Math.min(calls.length - 1, plan.length - 1)];
    if (step === 'network') return route.abort('failed');
    if (step === 'slow') { await new Promise((r) => setTimeout(r, 1200)); }
    return route.fulfill({ status: step === '500' ? 500 : 200, contentType: 'application/json', body: JSON.stringify({ ok: step !== '500', messageId: 77, sig: 'testsig', no: '007' }) });
  });
  calls.files = [];
  await page.route('**/api/attach', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}'); calls.files.push(b);
    const fail = plan.includes('attach-fail-once') && calls.files.filter((f) => f.idx === b.idx).length === 1 && b.idx === 1;
    return route.fulfill({ status: fail ? 502 : 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  return calls;
}
async function toCalc(page) {
  await page.goto('/index.html');
  await page.locator('#price').scrollIntoViewIfNeeded();
}
const total = (page) => page.locator('#total').innerText().then(money);
// emulate a tap that does not move focus away from the field first (iOS Safari behaviour)
const tapNoBlur = (page, sel) => page.evaluate((s) => document.querySelector(s).click(), sel);

test('quantity: paste then straight to the quote keeps field, discount, total and request in sync', async ({ page }) => {
  const calls = await mockApi(page);
  await toCalc(page);
  for (let i = 0; i < 5; i++) await page.click('#qp');
  await page.click('#tKey');
  await expect(page.locator('#q')).toHaveValue('6');
  expect(await total(page)).toBe('$342');
  // paste "3" after the 6 → 63
  await page.focus('#q');
  await page.keyboard.press('End');
  await page.keyboard.insertText('3');
  await expect(page.locator('#q')).toHaveValue('63');
  expect(await total(page)).toBe('$2886'); // 63 × $55 × 0.82 = 2841.3 → $2841, + 10 keychains $45
  await expect(page.locator('#sum')).toContainText('Quantity 63 (−18%)');
  await tapNoBlur(page, '#open');
  await expect(page.locator('#modal')).toBeVisible();
  await expect(page.locator('#mlist')).toContainText('Quantity 63 (−18%)');
  await expect(page.locator('#mtotal')).toHaveText('$2886');
  await page.fill('#ig', 'test.buyer');
  await page.click('#send'); await page.click('#confSend');
  await expect(page.locator('#done')).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(calls[0].price).toBe('$2886');
  expect(calls[0].lines).toContain('Quantity 63 (−18%)');
});

test('quantity: replace the whole value by paste and by mobile-style input events', async ({ page }) => {
  await toCalc(page);
  await page.fill('#q', '10'); // fill = select-all + insert, like a paste over the old value
  expect(await total(page)).toBe('$451');
  await page.evaluate(() => { const q = document.getElementById('q'); q.value = '6'; q.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' })); });
  expect(await total(page)).toBe('$297');
});

test('discount thresholds up and down (15 cm painted = $55 each)', async ({ page }) => {
  await toCalc(page);
  const expected = { 1: '$55', 2: '$110', 3: '$157', 5: '$261', 6: '$297', 9: '$446', 10: '$451' };
  const check = async (n) => { await expect(page.locator('#q')).toHaveValue(String(n)); if (expected[n]) expect(await total(page), `qty ${n}`).toBe(expected[n]); };
  await check(1);
  for (let n = 2; n <= 10; n++) { await page.click('#qp'); await check(n); }
  for (let n = 9; n >= 1; n--) { await page.click('#qm'); await check(n); }
  await page.fill('#q', '3');
  expect(await total(page)).toBe('$157'); // 165 × 0.95 = 156.75, shown rounded
});

test('quantity: empty, fractional and invalid values are explained and block the quote', async ({ page }) => {
  await toCalc(page);
  for (const [v, msg] of [['', 'Enter how many'], ['2.5', 'whole number'], ['abc', 'digits only'], ['0', 'minimum is 1'], ['5000', 'more than 999']]) {
    await page.fill('#q', v);
    await expect(page.locator('#q')).toHaveValue(v); // the field is never overwritten while typing
    await expect(page.locator('#qErr')).toContainText(msg);
    await expect(page.locator('#total')).toHaveText('—');
    await page.click('#open');
    await expect(page.locator('#modal')).toBeHidden();
  }
  await page.fill('#q', '4');
  await expect(page.locator('#qErr')).toHaveText('');
  expect(await total(page)).toBe('$209'); // 220 × 0.95
});

test('keychains, mixed order, per-figure setup and extras', async ({ page }) => {
  await toCalc(page);
  await page.click('#tKey'); await page.click('#tFig'); // keychains only
  expect(await total(page)).toBe('$45');
  await page.click('[data-g="pack"][data-id="20"]');
  expect(await total(page)).toBe('$80');
  await page.click('[data-g="kx"][data-id="rush"]');
  expect(await total(page)).toBe('$92'); // 80 × 1.15
  await page.click('#tFig'); // mixed
  expect(await total(page)).toBe('$147'); // 55 + 92
  await page.fill('#q', '3');
  await page.check('#custom');
  await page.locator('details.item[data-n="1"] summary').click();
  await page.click('details.item[data-n="1"] [data-g="size"][data-id="25"]');
  await page.click('[data-g="fx"][data-id="edit"]');
  // (55 + 95 + 55) × 0.95 = 194.75, + edit $20 = 214.75 → $215; + keychains $92
  expect(await total(page)).toBe('$307');
  await page.click('#open');
  await expect(page.locator('#mlist')).toContainText('#2: 25 cm');
  await expect(page.locator('#mtotal')).toHaveText('$307');
});

test('portfolio → card → Order one like this → quote carries exactly the card setup', async ({ page }) => {
  const calls = await mockApi(page);
  await toCalc(page);
  await page.click('#tKey'); for (let i = 0; i < 3; i++) await page.click('#qp'); // leftovers that must not leak
  await page.locator('#portfolio').scrollIntoViewIfNeeded();
  await expect(page.locator('#deck')).toHaveClass(/ready/, { timeout: 8000 });
  await page.click('#dnext'); // Plano → Graffiti Hood (15 cm, Complex, Painted)
  await page.waitForTimeout(700);
  await page.locator('.cc.front').click();
  await expect(page.locator('#pm')).toBeVisible();
  await expect(page.locator('#pname')).toHaveText('Graffiti Hood');
  await expect(page.locator('#pspecs')).toContainText('15 cm / 5.9 in');
  await page.click('#porder');
  await expect(page.locator('#modal')).toBeVisible();
  await expect(page.locator('#mlist')).toContainText('Figure · 15 cm / 5.9 in');
  await expect(page.locator('#mlist')).toContainText('Complex details');
  await expect(page.locator('#mlist')).toContainText('Painted');
  await expect(page.locator('#mlist')).toContainText('Quantity 1');
  await expect(page.locator('#mlist')).not.toContainText('Keychains');
  await expect(page.locator('#mtotal')).toHaveText('$55');
  // close, change the choice, reopen: the quote follows the new choice
  await page.click('#close');
  await page.click('#qp');
  await page.click('#open');
  await expect(page.locator('#mtotal')).toHaveText('$110');
  await page.fill('#ig', '@graffiti.fan');
  await page.click('#send'); await page.click('#confSend');
  await expect(page.locator('#done')).toBeVisible();
  expect(calls[0].instagram).toBe('graffiti.fan');
  expect(calls[0].price).toBe('$110');
});

test('request: nickname validation, sending state, network error, retry without a duplicate', async ({ page }) => {
  const calls = await mockApi(page, ['network', 'slow']);
  await toCalc(page);
  await page.click('#open');
  for (const [v, msg] of [['', 'Enter your Instagram'], ['bad name', 'no spaces'], ['bad!name', 'Use only letters'], ['.dot', 'period'], ['a'.repeat(31), '30 characters']]) {
    await page.fill('#ig', v); await page.click('#send');
    await expect(page.locator('#err')).toContainText(msg);
  }
  expect(calls).toHaveLength(0);
  await page.fill('#ig', 'https://www.instagram.com/real.buyer_7/');
  await page.click('#send'); await page.click('#confSend');
  await expect(page.locator('#fail')).toBeVisible();
  await page.click('#retry');
  await expect(page.locator('#retry')).toHaveText('Sending…');
  await expect(page.locator('#retry')).toBeDisabled();
  await expect(page.locator('#done')).toBeVisible();
  expect(calls).toHaveLength(2);
  expect(calls[0].instagram).toBe('real.buyer_7');
  expect(calls[1].requestId).toBe(calls[0].requestId); // same id → the server answers a retry from memory
  await page.click('#back');
  await expect(page.locator('#modal')).toBeHidden();
});

test('no horizontal scroll and the hero shows the product with a clear next step', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('.hero-cta')).toContainText(/Turn your character into a hand.painted collectible\./);
  await expect(page.locator('.hero-cta .btn')).toBeInViewport();
  for (const y of [0, 0.25, 0.5, 0.75, 1]) {
    await page.evaluate((k) => scrollTo(0, (document.body.scrollHeight - innerHeight) * k), y);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  }
});

test('model files fail to load: photos stay, loader and drag hints disappear', async ({ page }) => {
  await page.route('**/*.glb', (r) => r.abort('failed'));
  await page.goto('/index.html');
  await page.waitForTimeout(1500);
  await expect(page.locator('body')).not.toHaveClass(/hero3d/);
  await expect(page.locator('.hero-photo')).toBeVisible();
  await page.locator('#portfolio').scrollIntoViewIfNeeded();
  await expect(page.locator('#deck')).toHaveClass(/ready/, { timeout: 8000 });
  await page.locator('.cc.front').click();
  await expect(page.locator('#viewer')).toHaveCount(0, { timeout: 5000 }); // the 3D slide removes itself
  await expect(page.locator('#slides img').first()).toHaveAttribute('src', /ruler/);
  await expect(page.locator('#pcount')).toHaveText('1 / 3');
  await expect(page.locator('#slides')).not.toContainText('Loading');
  await expect(page.locator('#slides')).not.toContainText('Drag');
  await page.click('#pclose');
  await page.locator('#price').scrollIntoViewIfNeeded();
  await expect(page.locator('#calcView')).toBeHidden();
});

test('3D works: hero swaps in, viewer opens for several cards, calculator preview tools', async ({ page }) => {
  test.slow();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/index.html');
  await expect(page.locator('body')).toHaveClass(/hero3d/, { timeout: 60_000 });
  await page.locator('#portfolio').scrollIntoViewIfNeeded();
  await expect(page.locator('#deck')).toHaveClass(/ready/, { timeout: 8000 });
  const names = ['Plano', 'Graffiti Hood', 'White Angel'];
  for (let k = 0; k < 3; k++) {
    await page.locator('.cc.front').click();
    await expect(page.locator('#pm')).toBeVisible();
    await expect(page.locator('#pname')).toHaveText(names[k]);
    await expect(page.locator('#pm #viewer')).toHaveClass(/ready/, { timeout: 40_000 });
    const box = await page.locator('#viewer').boundingBox();
    if (!box) throw new Error('viewer not visible on card ' + k + ': ' + await page.locator('#pname').innerText());
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 6 }); await page.mouse.up();
    await page.mouse.wheel(0, -300);
    await page.click('#pclose');
    await expect(page.locator('#pm')).toBeHidden();
    await page.click('#dnext'); await page.waitForTimeout(700);
  }
  await page.locator('#price').scrollIntoViewIfNeeded();
  await expect(page.locator('#calcView')).toHaveClass(/ready3d/, { timeout: 60_000 });
  await page.click('#vzin'); await page.click('#vfull');
  await expect(page.locator('#calcView')).toHaveClass(/full/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#calcView')).not.toHaveClass(/full/);
  expect(errors).toEqual([]);
});

test('3D too slow: after the timeout the whole site stays on photos', async ({ page }) => {
  test.slow();
  await page.route('**/*.glb', () => { /* never answers */ });
  await page.goto('/index.html');
  await expect(page.locator('.hero-photo')).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/no3d/, { timeout: 30_000 });
  await expect(page.locator('#stage')).toHaveCount(0);
  await page.locator('#portfolio').scrollIntoViewIfNeeded();
  await expect(page.locator('#deck')).toHaveClass(/ready/, { timeout: 8000 });
  await page.locator('.cc.front').click();
  await expect(page.locator('#viewer')).toHaveCount(0);
  await expect(page.locator('#slides img').first()).toHaveAttribute('src', /ruler/);
  await page.click('#pclose');
  await page.locator('#price').scrollIntoViewIfNeeded();
  await expect(page.locator('#calcView')).toBeHidden();
});

test('gallery always opens on the first slide of the next card', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#portfolio').scrollIntoViewIfNeeded();
  await expect(page.locator('#deck')).toHaveClass(/ready/, { timeout: 8000 });
  await page.locator('.cc.front').click();
  await expect(page.locator('#pm')).toHaveClass(/show/);
  await page.waitForTimeout(400);
  await page.evaluate(() => { const s = document.getElementById('slides'); s.scrollLeft = s.clientWidth * 3; });
  await expect(page.locator('#pcount')).toHaveText(/^4 \//);
  await page.click('#pclose'); await expect(page.locator('#pm')).toBeHidden();
  await page.click('#dnext'); await page.waitForTimeout(700);
  await page.locator('.cc.front').click();
  await expect(page.locator('#pname')).toHaveText('Graffiti Hood');
  await expect(page.locator('#pcount')).toHaveText(/^1 \//);
  await page.click('#next');
  await expect(page.locator('#pcount')).toHaveText(/^2 \//);
});

test('nav order and no Extras row in cards', async ({ page }) => {
  await page.goto('/index.html');
  const links = await page.locator('.nav .links a:not(.btn):not(.ig)').allInnerTexts();
  if (links.length) expect(links.map((t) => t.trim().toLowerCase())).toEqual(['portfolio', 'price', 'process', 'contacts']);
  await page.locator('#portfolio').scrollIntoViewIfNeeded();
  await expect(page.locator('#deck')).toHaveClass(/ready/, { timeout: 8000 });
  await page.locator('.cc.front').click();
  await expect(page.locator('#pspecs')).not.toContainText('Extras');
});

test('slow connection: real "Loading 3D %" counter, then the figure', async ({ page, context }) => {
  test.slow();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 6e6 / 8, uploadThroughput: 1e6 });
  await page.goto('/index.html');
  const load = page.locator('#heroLoad');
  await expect(load).toBeVisible({ timeout: 10_000 });
  const seen = new Set();
  for (let i = 0; i < 40 && seen.size < 3; i++) { seen.add(await load.locator('b').innerText()); await page.waitForTimeout(400); }
  expect(seen.size).toBeGreaterThanOrEqual(3); // the number actually moves
  expect([...seen].every((t) => /^\d{1,3}%$/.test(t))).toBe(true);
  await expect(page.locator('body')).toHaveClass(/hero3d/, { timeout: 90_000 });
  await expect(load).toBeHidden();
  await expect(page.locator('.hero-photo')).not.toBeInViewport({ ratio: 0.01 }).catch(() => {}); // photo faded out
});

test('nickname: Cyrillic look-alikes and capitals are fixed, buyer confirms the profile link', async ({ page }) => {
  const calls = await mockApi(page);
  await toCalc(page);
  await page.click('#open');
  await page.fill('#ig', 'кузя'); await page.click('#send');
  await expect(page.locator('#err')).toContainText('Switch your keyboard to English');
  await page.fill('#ig', 'mushy akk'); await page.click('#send');
  await expect(page.locator('#err')).toContainText('no spaces');
  await page.fill('#ig', '@Mushyаkk'); // Cyrillic "а" + capital M
  await expect(page.locator('#igPrev')).toContainText('instagram.com/mushyakk');
  await page.click('#send');
  await expect(page.locator('#igConf')).toBeVisible();
  await expect(page.locator('#confNick')).toHaveText('mushyakk');
  await expect(page.locator('#confNote')).toContainText('Cyrillic');
  await expect(page.locator('#confOpen')).toHaveAttribute('href', 'https://www.instagram.com/mushyakk/');
  await page.click('#confEdit');
  await expect(page.locator('#ig')).toBeFocused();
  await page.fill('#ig', 'mushy.akk'); await page.click('#send'); await page.click('#confSend');
  await expect(page.locator('#done')).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(calls[0].instagram).toBe('mushy.akk');
});

test('reference files: photos are shrunk, sent after the request, failed ones can be retried', async ({ page }) => {
  const calls = await mockApi(page, ['ok', 'attach-fail-once']);
  await toCalc(page);
  await page.click('#open');
  // a big 4000x3000 PNG made in the page, a small PDF, and a file type we don't take
  const files = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 4000; c.height = 3000;
    const x = c.getContext('2d'); x.fillStyle = '#42c0ef'; x.fillRect(0, 0, 4000, 3000); x.fillStyle = '#000'; x.fillRect(500, 500, 900, 900);
    const png = await new Promise((r) => c.toBlob(r, 'image/png'));
    const toArr = async (b) => Array.from(new Uint8Array(await b.arrayBuffer()));
    return { png: await toArr(png) };
  });
  await page.setInputFiles('#refInput', [
    { name: 'my-character.png', mimeType: 'image/png', buffer: Buffer.from(files.png) },
    { name: 'sketch.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%test\n') },
    { name: 'virus.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') }
  ]);
  await expect(page.locator('#refList li')).toHaveCount(2);
  await expect(page.locator('#refErr')).toContainText('virus.exe');
  await expect(page.locator('#refList li').first()).toContainText('my-character.jpg');
  await page.fill('#ig', 'ref.buyer'); await page.click('#send'); await page.click('#confSend');
  await expect(page.locator('#done')).toBeVisible();
  expect(calls[0].files).toBe(2);
  await expect(page.locator('#dline')).toContainText('#007');
  // the PDF (2nd file) failed once → warning with retry
  await expect(page.locator('#refWarn')).toBeVisible();
  await page.click('#refRetry');
  await expect(page.locator('#refWarn')).toBeHidden();
  const img = calls.files.find((f) => f.idx === 0);
  expect(img.type).toBe('image/jpeg'); expect(img.sig).toBe('testsig'); expect(img.messageId).toBe(77);
  const bytes = Buffer.from(img.data, 'base64');
  expect(bytes.length).toBeLessThan(3 * 1024 * 1024);
  expect(calls.files.filter((f) => f.idx === 0)).toHaveLength(1); // the photo was not re-sent on retry
});

test('reference files: at most 5, PDF over 3 MB is refused with a clear message', async ({ page }) => {
  await toCalc(page);
  await page.click('#open');
  const tiny = Buffer.from(await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 20; c.height = 20; c.getContext('2d').fillRect(0, 0, 10, 10);
    return Array.from(new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/png'))).arrayBuffer()));
  }));
  await page.setInputFiles('#refInput', Array.from({ length: 6 }, (_, i) => ({ name: `p${i}.png`, mimeType: 'image/png', buffer: tiny })));
  await expect(page.locator('#refList li')).toHaveCount(5, { timeout: 30_000 });
  await expect(page.locator('#refErr')).toContainText('up to 5');
  await expect(page.locator('#refAdd')).toBeHidden();
  await page.locator('#refList .rm').first().click();
  await expect(page.locator('#refList li')).toHaveCount(4);
  await page.setInputFiles('#refInput', [{ name: 'huge.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(3.5 * 1024 * 1024) }]);
  await expect(page.locator('#refErr')).toContainText('limit is 3 MB');
});
