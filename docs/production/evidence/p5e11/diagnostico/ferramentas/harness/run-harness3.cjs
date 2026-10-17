// Uso: node run-harness3.cjs <harness.js> — estresse: 6 remoções (a…f) com intervalos aleatórios de 0–150 ms
// (semente fixa por execução), 50 execuções por combinação {layout} × {correção}. Conta execuções com item preso.
const fs = require('node:fs');
const { chromium } = require('@playwright/test');
const bundle = fs.readFileSync(process.argv[2], 'utf8');
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script>${bundle}</script></body></html>`;
const rng = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

(async () => {
  const browser = await chromium.launch();
  for (const layout of [false, true]) {
    for (const fix of [false, true]) {
      let stuckRuns = 0; let stuckItems = 0;
      for (let run = 0; run < 50; run += 1) {
        const random = rng(run + 1);
        const delays = Array.from({ length: 6 }, () => Math.floor(random() * 150));
        const page = await browser.newPage();
        await page.route('http://harness.local/**', (route) => route.fulfill({ contentType: 'text/html', body: html }));
        await page.goto(`http://harness.local/?fix=${fix ? 1 : 0}&layout=${layout ? 1 : 0}&n=8`);
        await page.waitForFunction(() => document.querySelectorAll('[data-id]').length === 8);
        await page.evaluate(async (delays) => {
          for (const [index, id] of ['a', 'b', 'c', 'd', 'e', 'f'].entries()) {
            await new Promise((resolve) => setTimeout(resolve, delays[index]));
            window.__remove(id);
          }
        }, delays);
        await page.waitForTimeout(900);
        const ids = await page.evaluate(() => [...document.querySelectorAll('[data-id]')].map((node) => node.dataset.id));
        const stuck = ids.filter((id) => 'abcdef'.includes(id));
        if (stuck.length) { stuckRuns += 1; stuckItems += stuck.length; }
        await page.close();
      }
      console.log(`layout=${layout ? 'sim' : 'não'} correção=${fix ? 'sim' : 'não'}: execuções com item preso ${stuckRuns}/50 (itens presos no total: ${stuckItems})`);
    }
  }
  await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
