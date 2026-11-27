// Buyer flow with WebGL switched off. Every POST to /api/request is intercepted — no real request reaches Telegram.
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
    return route.fulfill({ status: step === '500' ? 500 : 200, contentType: 'application/json', body: JSON.stringify({ ok: step !== '500' }) });
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

test.use({ launchOptions: { executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--disable-webgl', '--disable-3d-apis'] } });

test('photos everywhere, no stuck loaders, quote still works', async ({ page }) => {
  const calls = await mockApi(page);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/index.html');
  await expect(page.locator('html')).toHaveClass(/no3d/);
  await expect(page.locator('.hero-photo')).toBeVisible();
  await expect(page.getByText(/Loading/)).toHaveCount(0);
  await page.locator('#price').scrollIntoViewIfNeeded();
  await expect(page.locator('#vposter')).toBeVisible();
  await expect(page.locator('#calcView .spin')).toBeHidden();
  await expect(page.locator('#vfull')).toBeHidden();
  await page.locator('#portfolio').scrollIntoViewIfNeeded();
  await expect(page.locator('#deck')).toHaveClass(/ready/, { timeout: 8000 });
  await page.locator('.cc.front').click();
  await expect(page.locator('#pm')).toBeVisible();
  await expect(page.locator('#viewer')).toHaveCount(0);
  await expect(page.locator('#slides img').first()).toBeVisible();
  await expect(page.locator('#slides')).not.toContainText('Drag');
  await page.click('#porder');
  await page.fill('#ig', 'no3d.buyer'); await page.click('#send');
  await expect(page.locator('#done')).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(errors).toEqual([]);
});
