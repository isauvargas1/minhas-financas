import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

import type { Page } from '@playwright/test';

/**
 * Auditoria axe-core (WCAG 2.0/2.1 A e AA) para os E2E.
 *
 * O axe-core é `devDependency` desde a P5-D2. O arquivo `axe.min.js` é lido de
 * `E2E_AXE_CORE_PATH` ou do pacote `axe-core`. Sem nenhum dos dois, a
 * auditoria FALHA com a instrução abaixo: ausência da evidência obrigatória
 * não vira aprovação silenciosa.
 */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

export interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: Array<{ target: string[]; html: string }>;
}

const axeSource = (): string => {
  const fromEnv = process.env.E2E_AXE_CORE_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  try {
    return createRequire(import.meta.url).resolve('axe-core/axe.min.js');
  } catch {
    throw new Error(
      'axe-core não encontrado: instale o pacote `axe-core` ou defina E2E_AXE_CORE_PATH com o caminho de `axe.min.js`.',
    );
  }
};

/**
 * Violações no trecho da página indicado por `include` (seletor CSS); `exclude`
 * tira do escopo trechos já registrados como defeito conhecido (seletores CSS).
 */
export const axeViolations = async (
  page: Page,
  include: string,
  exclude: string[] = [],
): Promise<AxeViolation[]> => {
  await page.addScriptTag({ path: axeSource() });
  return page.evaluate(async ({ tags, scope, skip }) => {
    // @ts-expect-error axe é injetado na página.
    const result = await window.axe.run(
      { include: [scope], ...(skip.length > 0 ? { exclude: skip.map((selector) => [selector]) } : {}) },
      { runOnly: { type: 'tag', values: tags } },
    );
    return result.violations.map((violation: AxeViolation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.slice(0, 8).map((node) => ({ target: node.target, html: node.html.slice(0, 160) })),
    }));
  }, { tags: WCAG_TAGS, scope: include, skip: exclude });
};
