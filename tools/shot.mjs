// node shot.mjs out-prefix  — full-page screenshots desktop + phone
import { chromium } from '@playwright/test';
const pre = process.argv[2] || '/tmp/s';
const b = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
for (const [name, vp, mob] of [['d', { width: 1440, height: 900 }, false], ['m', { width: 390, height: 844 }, true]]) {
  const p = await b.newPage({ viewport: vp, deviceScaleFactor: mob ? 2 : 1, isMobile: mob, hasTouch: mob });
  await p.goto('http://localhost:4173/', { waitUntil: 'load' });
  await p.waitForTimeout(9000);
  await p.screenshot({ path: `${pre}-${name}-hero.png` });
  // walk down so reveals fire
  const H = await p.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < H; y += 500) { await p.evaluate((y) => scrollTo(0, y), y); await p.waitForTimeout(120); }
  await p.waitForTimeout(800);
  await p.evaluate(() => { document.querySelectorAll('.reveal').forEach(e => e.classList.add('in')); scrollTo(0, 0); });
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${pre}-${name}-full.png`, fullPage: true });
  await p.close();
}
await b.close();
