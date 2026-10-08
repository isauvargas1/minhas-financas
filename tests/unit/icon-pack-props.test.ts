import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Menu as LucideMenu } from 'lucide-react';
import { IconMenu2 } from '@tabler/icons-react';

import { iconPackProps, phosphorWeightFor } from '../../src/components/iconPackProps.ts';

// O build ESM do Phosphor só resolve pelo Vite (jsx-runtime embutido com
// caminho de pnpm); no Node, o build CommonJS do mesmo pacote é equivalente.
const { List: PhosphorList } = createRequire(import.meta.url)('@phosphor-icons/react') as {
  List: ComponentType<Record<string, unknown>>;
};

/*
 * V-01 (UX-H1): o `AppIcon` monta as props de cada pacote com `iconPackProps`.
 * Os testes renderizam os componentes reais dos três pacotes, nas versões do
 * projeto, com as mesmas props que o `AppIcon` passa.
 */
const render = (component: ComponentType<Record<string, unknown>>, props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(component, props));

const svgAttribute = (markup: string, name: string): string | undefined =>
  new RegExp(`<svg[^>]*\\s${name}="([^"]*)"`).exec(markup)?.[1];

test('lucide: o ícone mantém o traço visível (currentColor) e a espessura do tema', () => {
  const markup = render(LucideMenu as never, { size: 20, strokeWidth: 1.5, ...iconPackProps('lucide', 1.5) });
  assert.equal(svgAttribute(markup, 'stroke'), 'currentColor');
  assert.equal(svgAttribute(markup, 'stroke-width'), '1.5');
  assert.equal(svgAttribute(markup, 'fill'), 'none');
  assert.ok(markup.includes('<line'), 'o desenho do ícone foi renderizado');
});

test('lucide: as props do pacote não trazem a chave `stroke` (era ela que apagava o traço)', () => {
  assert.deepEqual(iconPackProps('lucide', 2), {});
  assert.equal(Object.hasOwn(iconPackProps('lucide', 2), 'stroke'), false);
  // O defeito corrigido, documentado: com `stroke: undefined` o SVG sai sem traço.
  const broken = render(LucideMenu as never, { size: 20, strokeWidth: 2, stroke: undefined });
  assert.equal(svgAttribute(broken, 'stroke'), undefined);
});

test('lucide: a cor do tema continua vindo de currentColor ou de `color`', () => {
  const markup = render(LucideMenu as never, { size: 20, strokeWidth: 2, ...iconPackProps('lucide', 2), color: '#123456' });
  assert.equal(svgAttribute(markup, 'stroke'), '#123456');
});

test('tabler: `stroke` continua sendo a espessura do traço, com cor currentColor', () => {
  const markup = render(IconMenu2 as never, { size: 20, strokeWidth: 2.5, ...iconPackProps('tabler', 2.5) });
  assert.equal(svgAttribute(markup, 'stroke'), 'currentColor');
  assert.equal(svgAttribute(markup, 'stroke-width'), '2.5');
  assert.ok(markup.includes('<path'), 'o desenho do ícone foi renderizado');
});

test('phosphor: o peso segue a espessura do tema e o preenchimento usa currentColor', () => {
  assert.equal(phosphorWeightFor(1), 'light');
  assert.equal(phosphorWeightFor(1.5), 'light');
  assert.equal(phosphorWeightFor(2), 'regular');
  assert.equal(phosphorWeightFor(2.5), 'bold');
  assert.deepEqual(iconPackProps('phosphor', 1.5), { weight: 'light' });
  const light = render(PhosphorList as never, { size: 20, strokeWidth: 1.5, ...iconPackProps('phosphor', 1.5) });
  const bold = render(PhosphorList as never, { size: 20, strokeWidth: 2.5, ...iconPackProps('phosphor', 2.5) });
  assert.equal(svgAttribute(light, 'fill'), 'currentColor');
  assert.ok(light.includes('<path'), 'o desenho do ícone foi renderizado');
  assert.notEqual(light, bold, 'pesos diferentes desenham caminhos diferentes');
});
