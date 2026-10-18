// Uso: node run-harness.cjs <harness.js> — abre a página com e sem a correção (20 vezes cada) e conta
// em quantas o item "b" ficou preso no DOM depois de a saída dele terminar.
const fs = require('node:fs');
const { chromium } = require('@playwright/test');

const bundle = fs.readFileSync(process.argv[2], 'utf8');
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script>${bundle}</script></body></html>`;

const once = async (browser, fix) => {
  const page = await browser.newPage();
  await page.route('http://harness.local/**', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto(`http://harness.local/?fix=${fix ? 1 : 0}`);
  await page.waitForFunction(() => document.querySelectorAll('[data-id]').length === 3);
  // Remove "a"; no instante em que a saída dele termina (antes do render adiado), remove "b".
  await page.evaluate(() => new Promise((resolve) => {
    window.__onExitComplete = () => { window.__remove('b'); resolve(); };
    window.__remove('a');
  }));
  // Espera a saída de "b" terminar e mais 1 s para qualquer render pendente.
  await page.waitForFunction(() => window.__log.some((line) => line.endsWith('saída concluída b')));
  await page.waitForTimeout(1000);
  const result = await page.evaluate(() => ({
    ids: [...document.querySelectorAll('[data-id]')].map((node) => {
      const style = getComputedStyle(node);
      return `${node.dataset.id}(opacidade ${Number(style.opacity).toFixed(2)}, altura ${Math.round(node.getBoundingClientRect().height)})`;
    }),
    log: window.__log.slice(),
  }));
  await page.close();
  return result;
};

(async () => {
  const browser = await chromium.launch();
  for (const fix of [false, true]) {
    let stuck = 0;
    let sample = null;
    for (let i = 0; i < 20; i += 1) {
      const result = await once(browser, fix);
      if (result.ids.some((id) => id.startsWith('b('))) stuck += 1;
      if (i === 0) sample = result;
    }
    console.log(`${fix ? 'COM a correção' : 'SEM a correção'}: "b" preso no DOM em ${stuck}/20`);
    console.log(`  DOM final (1ª execução): ${sample.ids.join(', ')}`);
    console.log(`  eventos (1ª execução): ${sample.log.join(' | ')}`);
  }
  await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
