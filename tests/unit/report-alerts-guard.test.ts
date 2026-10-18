import assert from 'node:assert/strict';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';

/**
 * P5-D2 — guardas estáticas das condições do período em Relatórios: não há
 * "marcar como lido" falso (era um `console.log`), nenhuma ocultação local, e
 * "Tudo certo por aqui!" só aparece quando as fontes estão completas (sem
 * `note` de cobertura parcial ou amostra).
 */

const root = new URL('../../', import.meta.url).pathname;
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const code = (path: string) => read(path)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const sourceFiles = (dir: string): string[] => readdirSync(join(root, dir)).flatMap((name) => {
  const path = `${dir}/${name}`;
  return statSync(join(root, path)).isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
});

const PANEL = 'src/components/ReportsAlertsPanel.tsx';

test('markAlertAsRead não existe em src/', () => {
  for (const path of sourceFiles('src')) {
    assert.doesNotMatch(code(path), /\bmarkAlertAsRead\b/, path);
  }
  assert.doesNotMatch(code('src/modules/reports/api.ts'), /console\.log/);
});

test('useFinancialAlerts devolve os alertas do snapshot sem leitura nem ocultação local', () => {
  const hooks = code('src/modules/reports/hooks.ts');
  const hook = /export const useFinancialAlerts[\s\S]*?\n\};\n/.exec(hooks)?.[0] ?? '';
  assert.ok(hook.length > 0, 'useFinancialAlerts presente');
  assert.doesNotMatch(hook, /readAlertIds|markAsRead|useState|useCallback|filter\(/);
  assert.match(hook, /alerts,\s*totalActive: alerts\.length/);
  assert.doesNotMatch(hooks, /readAlertIds|markAlertAsRead/);
});

test('o painel não tem "Marcar como lido", readAlertIds nem markAsRead', () => {
  const panel = read(PANEL);
  assert.doesNotMatch(panel, /Marcar como lido/);
  assert.doesNotMatch(panel, /readAlertIds|markAsRead/);
  assert.doesNotMatch(panel, /CloseIcon/);
  assert.doesNotMatch(panel, /Alertas e Insights/);
});

test('o painel rotula as condições como calculadas no período, não como notificações', () => {
  const panel = read(PANEL);
  assert.match(panel, /Condições do período\n/);
  assert.match(panel, /Condições do período indisponíveis/);
  assert.match(panel, /<p className="text-xs text-muted">Calculadas a partir dos dados do período selecionado; não ficam salvas como notificações\.<\/p>/);
  assert.match(panel, /Calculado em \{new Date\(alert\.createdAt\)\.toLocaleDateString\('pt-BR'\)\}/);
  assert.match(panel, /\{alertsView\?\.note && <p className="text-xs text-muted">\{alertsView\.note\}<\/p>\}/);
});

test('"Tudo certo por aqui!" só aparece no ramo sem note de cobertura parcial', () => {
  const source = code(PANEL);
  assert.equal(source.split('Tudo certo por aqui!').length - 1, 1, 'uma única ocorrência');
  const emptyBranch = /if \(alerts\.length === 0\) \{([\s\S]*?)\n    \}\n/.exec(source)?.[1] ?? '';
  assert.ok(emptyBranch.length > 0, 'ramo de lista vazia');

  // Dentro do ramo vazio: o ramo com `note` retorna antes (e traz o aviso amarelo);
  // o "Tudo certo" fica depois, fora desse `if`.
  const noteStart = emptyBranch.indexOf('if (alertsView?.note) {');
  assert.ok(noteStart >= 0, 'ramo da nota');
  let depth = 0;
  let noteEnd = -1;
  for (let index = emptyBranch.indexOf('{', noteStart); index < emptyBranch.length; index += 1) {
    if (emptyBranch[index] === '{') depth += 1;
    if (emptyBranch[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        noteEnd = index;
        break;
      }
    }
  }
  assert.ok(noteEnd > noteStart, 'ramo da nota fechado');
  const withNote = emptyBranch.slice(noteStart, noteEnd + 1);
  const withoutNote = emptyBranch.slice(noteEnd + 1);

  assert.match(withNote, /return \(/);
  assert.doesNotMatch(withNote, /Tudo certo por aqui!/);
  assert.doesNotMatch(withNote, /<CheckIcon|bg-green-/);
  assert.match(withNote, /<WarningIcon/);
  assert.match(withNote, /bg-yellow-100/);
  assert.match(withNote, /Nenhuma condição identificada nas fontes disponíveis/);
  assert.match(withNote, /\{alertsView\.note\}/);

  assert.match(withoutNote, /Tudo certo por aqui!/);
  assert.match(withoutNote, /Nenhuma condição de atenção identificada no período\./);
  assert.match(withoutNote, /<CheckIcon/);
  assert.doesNotMatch(withoutNote, /alertsView/);
});

test('bloco sem números não afirma "tudo certo"', () => {
  const source = code(PANEL);
  const unavailable = /if \(alertsView && !alertsView\.hasNumbers\) \{([\s\S]*?)\n    \}\n/.exec(source)?.[1] ?? '';
  assert.ok(unavailable.length > 0);
  assert.match(unavailable, /Condições do período indisponíveis/);
  assert.doesNotMatch(unavailable, /Tudo certo por aqui!/);
  // O ramo indisponível vem antes do vazio.
  assert.ok(source.indexOf('!alertsView.hasNumbers') < source.indexOf('alerts.length === 0'));
});
