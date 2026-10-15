// Uso: node run-harness2.cjs <harness.js> — cenários × {sem, com} correção × {sem, com} `layout`, 20 vezes cada.
// Cenários (a saída dura 100 ms):
//  corrida  — "b" sai no instante em que a saída de "a" termina (janela antes do render adiado);
//  sobrepor — "b" sai 50 ms depois de "a", com "a" ainda saindo;
//  varrer   — "b" sai 0, 4, 8, … 76 ms depois do fim da saída de "a" (uma espera por execução).
const fs = require('node:fs');
const { chromium } = require('@playwright/test');
const bundle = fs.readFileSync(process.argv[2], 'utf8');
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script>${bundle}</script></body></html>`;

const once = async (browser, fix, layout, scenario, i) => {
  const page = await browser.newPage();
  await page.route('http://harness.local/**', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto(`http://harness.local/?fix=${fix ? 1 : 0}&layout=${layout ? 1 : 0}`);
  await page.waitForFunction(() => document.querySelectorAll('[data-id]').length === 3);
  await page.evaluate(([scenario, i]) => new Promise((resolve) => {
    if (scenario === 'corrida') {
      window.__onExitComplete = () => { window.__remove('b'); resolve(); };
      window.__remove('a');
    } else if (scenario === 'sobrepor') {
      window.__remove('a');
      setTimeout(() => { window.__remove('b'); resolve(); }, 50);
    } else {
      window.__onExitComplete = () => setTimeout(() => { window.__remove('b'); resolve(); }, i * 4);
      window.__remove('a');
    }
  }), [scenario, i]);
  await page.waitForFunction(() => window.__log.some((line) => line.endsWith('saída concluída b')), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);
  const ids = await page.evaluate(() => [...document.querySelectorAll('[data-id]')].map((node) => node.dataset.id));
  await page.close();
  return ids;
};

(async () => {
  const browser = await chromium.launch();
  for (const layout of [false, true]) {
    for (const scenario of ['corrida', 'sobrepor', 'varrer']) {
      for (const fix of [false, true]) {
        let stuck = 0; const stuckAt = [];
        for (let i = 0; i < 20; i += 1) {
          const ids = await once(browser, fix, layout, scenario, i);
          if (ids.includes('a') || ids.includes('b')) { stuck += 1; stuckAt.push(scenario === 'varrer' ? `${i * 4}ms` : i); }
        }
        console.log(`layout=${layout ? 'sim' : 'não'} cenário=${scenario.padEnd(8)} correção=${fix ? 'sim' : 'não'}: item preso em ${stuck}/20${stuck && scenario === 'varrer' ? ` (atrasos: ${stuckAt.join(', ')})` : ''}`);
      }
    }
  }
  await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
