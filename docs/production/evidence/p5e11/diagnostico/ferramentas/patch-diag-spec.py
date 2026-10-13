"""Instrumenta, SÓ na cópia de diagnóstico, o teste F de e2e/notifications-p5d2.spec.ts.
Não altera asserções: só acrescenta registro de eventos, rede, DOM e estado persistido."""
import sys
p = sys.argv[1]
s = open(p).read()

HELPERS = r'''
import * as diagFs from 'node:fs';
const DIAG_DIR = process.env.DIAG_DIR ?? '';
let currentDiag: { dump: (status: string) => Promise<void> } | null = null;
const instrumentDiag = async (page: Page, label: string, ws: string, uid: string) => {
  const lines: string[] = [];
  const log = (s: string) => lines.push(`${Date.now()} N ${s}`);
  const shortUrl = (u: string) => u.replace(/^https?:\/\/127\.0\.0\.1:\d+/, '')
    .replace(/\/v1\/projects\/minhas-financas-local\/databases\/\(default\)\/documents/, '/D');
  const summarize = (body: string | null) => {
    if (!body) return '';
    try {
      const j = JSON.parse(body);
      if (j.structuredQuery) {
        return `query from=${(j.structuredQuery.from ?? []).map((f: { collectionId?: string }) => f.collectionId).join(',')}`
          + ` limit=${JSON.stringify(j.structuredQuery.limit ?? '')} startAt=${j.structuredQuery.startAt ? 'cursor' : '-'}`;
      }
      if (j.writes) {
        return `commit writes=${j.writes.map((w: { update?: { name?: string }; delete?: string }) =>
          (w.update?.name ?? w.delete ?? '?').split('/').slice(-2).join('/')).join(',')} tx=${j.transaction ? 'yes' : 'no'}`;
      }
      if (j.documents) return `batchGet ${j.documents.map((d: string) => d.split('/').slice(-2).join('/')).join(',')}`;
      if ('data' in j) return `callable data=${JSON.stringify(j.data).slice(0, 80)}`;
      return `keys=${Object.keys(j).join(',')}`;
    } catch { return `raw=${body.slice(0, 60)}`; }
  };
  const watched = (u: string) => /127\.0\.0\.1:(8280|5201)\//.test(u);
  page.on('request', (req) => { if (req.method() === 'POST' && watched(req.url())) log(`REQ ${shortUrl(req.url()).slice(0, 110)} ${summarize(req.postData())}`); });
  page.on('response', (res) => { if (res.request().method() === 'POST' && watched(res.url())) log(`RES ${res.status()} ${shortUrl(res.url()).slice(0, 110)}`); });
  page.on('requestfailed', (req) => { if (watched(req.url())) log(`REQFAIL ${shortUrl(req.url()).slice(0, 110)} ${req.failure()?.errorText}`); });
  page.on('console', (msg) => log(`CONSOLE ${msg.type()} ${msg.text().slice(0, 240)}`));
  page.on('pageerror', (err) => log(`PAGEERROR ${String(err).slice(0, 240)}`));
  await page.evaluate(() => {
    const w = window as unknown as { __diag: string[] };
    w.__diag = [];
    const push = (s: string) => w.__diag.push(`${Date.now()} P ${s}`);
    const desc = (el: EventTarget | null) => {
      if (!(el instanceof Element)) return String(el);
      const b = el.closest('button,[role="button"],a,li');
      const label = b?.getAttribute('aria-label') ?? b?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 40) ?? '';
      const cls = typeof el.className === 'string' ? el.className.split(/\s+/).slice(0, 3).join('.') : '';
      return `${el.tagName}.${cls} <${b?.tagName ?? '-'}:${label}> conn=${el.isConnected}`;
    };
    for (const type of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click']) {
      window.addEventListener(type, (event) => {
        const e = event as MouseEvent & TouchEvent;
        const x = e.clientX ?? e.changedTouches?.[0]?.clientX;
        const y = e.clientY ?? e.changedTouches?.[0]?.clientY;
        push(`EV ${type} ${desc(event.target)} xy=${Math.round(x ?? -1)},${Math.round(y ?? -1)}`);
      }, true);
    }
    document.addEventListener('focusin', (event) => push(`FOCUS ${desc(event.target)}`), true);
    let last = '';
    const snap = () => {
      const titles = [...document.querySelectorAll('h4')].map((h) => h.textContent?.trim() ?? '').filter((t) => /^Aviso F \d\d$/.test(t));
      const open = [...document.querySelectorAll('h3')].some((h) => h.textContent?.trim() === 'Notificações');
      const bell = document.querySelector('button[aria-label^="Notificações"]')?.getAttribute('aria-label') ?? '';
      const state = `open=${open} bell="${bell}" items=${titles.map((t) => t.slice(-2)).join(',')}`;
      if (state !== last) { last = state; push(`DOM ${state}`); }
    };
    new MutationObserver(snap).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label'] });
    snap();
  });
  const dump = async (status: string) => {
    let pageLines: string[] = [];
    try { pageLines = await page.evaluate(() => (window as unknown as { __diag?: string[] }).__diag ?? []); } catch (error) { pageLines = [`${Date.now()} P (sem página: ${String(error).slice(0, 80)})`]; }
    let states = '';
    try {
      const all = await statesOf(ws, uid);
      states = JSON.stringify([...all.entries()].map(([id, d]) => [id, { read: d.read ?? null, dismissed: d.dismissed ?? null, deleted: d.deleted ?? null }]));
    } catch (error) { states = String(error); }
    if (!DIAG_DIR) return;
    diagFs.mkdirSync(DIAG_DIR, { recursive: true });
    const name = `${status}-${label}`.replace(/[^a-zA-Z0-9#-]+/g, '_');
    diagFs.writeFileSync(`${DIAG_DIR}/${name}.log`, [`STATUS ${status}`, `STATES ${states}`, ...[...lines, ...pageLines].sort()].join('\n') + '\n');
  };
  currentDiag = { dump };
  return { dump, mark: (s: string) => log(`MARK ${s}`) };
};
test.afterEach(async ({}, testInfo) => {
  if (currentDiag && testInfo.status !== testInfo.expectedStatus) await currentDiag.dump(`FAIL-r${testInfo.repeatEachIndex}`);
  currentDiag = null;
});
'''

def rep(old, new):
    global s
    assert s.count(old) == 1, (s.count(old), old[:70])
    s = s.replace(old, new)

anchor = "import { axeViolations } from './support/axe';\n"
rep(anchor, anchor + HELPERS)
rep("    const { page } = session;\n    const press = (locator: Locator) => (touch ? locator.tap() : locator.click());\n",
    "    const { page } = session;\n    const diag = await instrumentDiag(page, `${combo.name}#r${test.info().repeatEachIndex}`, ws, O.uid);\n    const press = (locator: Locator) => (touch ? locator.tap() : locator.click());\n")
rep("    // Badge numérico: arquivar 4 → 8 não lidas.\n    await press(bell(page));\n",
    "    // Badge numérico: arquivar 4 → 8 não lidas.\n    diag.mark('reabrir painel');\n    await press(bell(page));\n")
rep("    for (const index of [0, 1, 2, 3]) await press(archiveButton(page, `Aviso F ${pad(index)}`));\n",
    "    for (const index of [0, 1, 2, 3]) { diag.mark(`arquivar F ${pad(index)}`); await press(archiveButton(page, `Aviso F ${pad(index)}`)); }\n    diag.mark('esperar sino 8');\n")
rep("    await press(archiveButton(page, 'Aviso F 04'));\n",
    "    diag.mark('limite da contagem gravado; arquivar F 04');\n    await press(archiveButton(page, 'Aviso F 04'));\n")
rep("    // A lista continua utilizável com a contagem indisponível.\n    await expect(itemTitles(page, 'Aviso F')).toHaveCount(7);\n",
    "    // A lista continua utilizável com a contagem indisponível.\n    diag.mark('esperar 7 itens');\n    await expect(itemTitles(page, 'Aviso F')).toHaveCount(7);\n    diag.mark('7 itens ok');\n")
rep("      await expect(panelHeading(page)).toHaveCount(0);\n    }\n    await session.context.close();\n  });\n}\n",
    "      await expect(panelHeading(page)).toHaveCount(0);\n    }\n    await diag.dump(`PASS-r${test.info().repeatEachIndex}`);\n    currentDiag = null;\n    await session.context.close();\n  });\n}\n")
open(p, 'w').write(s)
print('spec instrumentada')
