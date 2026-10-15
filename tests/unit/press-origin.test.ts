import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import TestRenderer, {type ReactTestRenderer} from 'react-test-renderer';

import {
  GESTURE_CLICK_WINDOW_MS,
  PRESS_TARGET_ATTRIBUTE,
  applyGestureClickRoute,
  createGestureClickRouter,
  pressTargetProps,
  routeGestureClick,
  usePointerOriginTracking,
  type GestureClick,
  type PointerOrigin,
} from '../../src/lib/pressOrigin.ts';

/**
 * P5-E1.1 — o clique de um gesto vai para o elemento em que o gesto começou.
 * Num toque, o `click` de compatibilidade é gerado depois do `touchend` e, se
 * o layout muda nesse intervalo (um aviso arquivado saindo da lista), cai em
 * outro elemento. O navegador decide se houve clique; estas regras decidem
 * onde ele age: reentregue ao dono de origem (toque), só impedido (mouse,
 * origem sem dono, dono fora da página) ou intocado (teclado, leitor de tela,
 * outro ponteiro, gesto antigo, mesmo dono).
 */

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

/** Elemento mínimo: `closest` sobe pelos pais até achar um dono de gesto. */
class FakeElement extends EventTarget {
  readonly name: string;
  readonly parentElement: FakeElement | null;
  readonly isOwner: boolean;
  isConnected = true;
  clicks = 0;
  focuses: Array<FocusOptions | undefined> = [];

  constructor(name: string, parentElement: FakeElement | null = null, isOwner = false) {
    super();
    this.name = name;
    this.parentElement = parentElement;
    this.isOwner = isOwner;
  }

  closest(selector: string): FakeElement | null {
    assert.equal(selector, `[${PRESS_TARGET_ATTRIBUTE}]`);
    for (let node: FakeElement | null = this; node; node = node.parentElement) {
      if (node.isOwner) return node;
    }
    return null;
  }

  click(): void {
    this.clicks += 1;
  }

  focus(options?: FocusOptions): void {
    this.focuses.push(options);
  }
}

/** Nó de texto: sem `closest`, só o elemento pai. */
class FakeText extends EventTarget {
  readonly parentElement: FakeElement;

  constructor(parentElement: FakeElement) {
    super();
    this.parentElement = parentElement;
  }
}

// Painel: cabeçalho (sem dono) e lista; cada aviso é dono e tem botões que também são.
const panelHeader = new FakeElement('cabeçalho do painel');
const list = new FakeElement('lista');
const rowA = new FakeElement('aviso A', list, true);
const titleA = new FakeElement('título A', rowA);
const archiveA = new FakeElement('arquivar A', rowA, true);
const iconA = new FakeElement('ícone de arquivar A', archiveA);
const rowB = new FakeElement('aviso B', list, true);
const bodyB = new FakeElement('texto B', rowB);
const archiveB = new FakeElement('arquivar B', rowB, true);
const loadMore = new FakeElement('carregar mais (sem dono)', list);
const backdrop = new FakeElement('fundo', null, true);

const touchDown = (target: EventTarget, pointerId = 7, timeStamp = 1_000): PointerOrigin =>
  ({target, pointerId, pointerType: 'touch', timeStamp});
const mouseDown = (target: EventTarget, timeStamp = 1_000): PointerOrigin =>
  ({target, pointerId: 1, pointerType: 'mouse', timeStamp});
/** `click` do gesto (Chromium: PointerEvent com o mesmo `pointerId`). */
const clickOn = (target: EventTarget, pointerId: number | undefined = 7, timeStamp = 1_015): GestureClick =>
  ({detail: 1, target, pointerId, timeStamp});

const rerouteTo = (owner: FakeElement) => ({action: 'reroute', to: owner as unknown as Element});

test('pressTargetProps marca o dono com o atributo do roteamento', () => {
  assert.deepEqual(pressTargetProps, {[PRESS_TARGET_ATTRIBUTE]: ''});
});

test('toque em "Arquivar" cujo click caiu no corpo de outro aviso volta para o "Arquivar" de origem', () => {
  assert.deepEqual(routeGestureClick(touchDown(iconA), clickOn(bodyB)), rerouteTo(archiveA));
  assert.deepEqual(routeGestureClick(touchDown(iconA), clickOn(titleA)), rerouteTo(archiveA),
    'nem no corpo do próprio aviso: o toque foi no botão');
});

test('toque no corpo de um aviso cujo click caiu em outro aviso, num botão de outro aviso ou fora de dono volta ao aviso tocado', () => {
  assert.deepEqual(routeGestureClick(touchDown(titleA), clickOn(bodyB)), rerouteTo(rowA));
  assert.deepEqual(routeGestureClick(touchDown(titleA), clickOn(archiveB)), rerouteTo(rowA));
  assert.deepEqual(routeGestureClick(touchDown(new FakeText(titleA)), clickOn(loadMore)), rerouteTo(rowA),
    'origem em nó de texto usa o pai; destino sem dono também é desvio');
});

test('o click que cai no mesmo dono em que o gesto começou passa como sempre', () => {
  assert.deepEqual(routeGestureClick(touchDown(iconA), clickOn(archiveA)), {action: 'pass'});
  assert.deepEqual(routeGestureClick(touchDown(titleA), clickOn(rowA)), {action: 'pass'});
  assert.deepEqual(routeGestureClick(touchDown(panelHeader), clickOn(loadMore)), {action: 'pass'},
    'origem e destino sem dono: fora do roteamento');
});

test('toque começado dentro do painel (área sem dono) cujo click caiu no fundo é impedido: o painel não fecha', () => {
  assert.deepEqual(routeGestureClick(touchDown(panelHeader), clickOn(backdrop)), {action: 'block'});
  assert.deepEqual(routeGestureClick(touchDown(backdrop), clickOn(backdrop)), {action: 'pass'}, 'gesto no próprio fundo fecha');
});

test('mouse: click desviado é só impedido (nunca reentregue)', () => {
  assert.deepEqual(routeGestureClick(mouseDown(iconA), {...clickOn(bodyB, 1)}), {action: 'block'});
});

test('dono de origem que já saiu da página: o click é só impedido', () => {
  const gone = new FakeElement('arquivar C (removido)', null, true);
  gone.isConnected = false;
  assert.deepEqual(routeGestureClick(touchDown(gone), clickOn(bodyB)), {action: 'block'});
});

test('teclado, leitor de tela e click() programático (detail 0) passam como sempre', () => {
  assert.deepEqual(routeGestureClick(touchDown(iconA), {detail: 0, target: bodyB, pointerId: -1, timeStamp: 1_015}), {action: 'pass'});
  // Onde o click não é PointerEvent (sem pointerId), só o detail 0 distingue o teclado de um gesto:
  // logo depois de um toque em outro dono, dentro da janela, ele ainda passa.
  assert.deepEqual(routeGestureClick(touchDown(iconA), {detail: 0, target: bodyB, timeStamp: 1_015}), {action: 'pass'});
  assert.deepEqual(routeGestureClick(touchDown(iconA), {detail: 0, target: backdrop, timeStamp: 1_015}), {action: 'pass'});
  // Mesmo pointerId do toque: o detail 0 continua decidindo.
  assert.deepEqual(routeGestureClick(touchDown(iconA, 7), {detail: 0, target: bodyB, pointerId: 7, timeStamp: 1_015}), {action: 'pass'});
});

test('click de outro ponteiro (simulado com -1 ou de outro dedo) não é o gesto registrado e passa', () => {
  assert.deepEqual(routeGestureClick(touchDown(iconA, 7), clickOn(bodyB, -1)), {action: 'pass'});
  assert.deepEqual(routeGestureClick(touchDown(iconA, 7), clickOn(bodyB, 8)), {action: 'pass'});
  assert.deepEqual(routeGestureClick(touchDown(iconA, 7), clickOn(bodyB, undefined)), rerouteTo(archiveA),
    'click sem pointerId (navegador antigo) ainda é tratado pela origem');
});

test('gesto antigo (fora da janela) ou sem origem: passa', () => {
  assert.deepEqual(routeGestureClick(touchDown(iconA, 7, 1_000), clickOn(bodyB, 7, 1_000 + GESTURE_CLICK_WINDOW_MS + 1)),
    {action: 'pass'});
  assert.deepEqual(routeGestureClick(touchDown(iconA, 7, 1_000), clickOn(bodyB, 7, 1_000 + GESTURE_CLICK_WINDOW_MS)),
    rerouteTo(archiveA), 'no limite ainda é o mesmo gesto');
  assert.deepEqual(routeGestureClick(null, clickOn(bodyB)), {action: 'pass'});
  assert.deepEqual(routeGestureClick({...touchDown(iconA), target: null}, clickOn(bodyB)), {action: 'pass'});
});

const fakeClickEvent = () => {
  const event = {prevented: 0, stopped: 0, preventDefault() { event.prevented += 1; }, stopPropagation() { event.stopped += 1; }};
  return event;
};

test('aplicar a rota: impede o click onde caiu e reentrega uma única vez ao dono de origem', () => {
  const owner = new FakeElement('arquivar D', null, true);
  const rerouted = fakeClickEvent();
  applyGestureClickRoute({...clickOn(bodyB), ...rerouted, preventDefault: rerouted.preventDefault, stopPropagation: rerouted.stopPropagation},
    {action: 'reroute', to: owner as unknown as Element});
  assert.equal(rerouted.prevented, 1);
  assert.equal(rerouted.stopped, 1);
  assert.equal(owner.clicks, 1);
  assert.deepEqual(owner.focuses, [{preventScroll: true}], 'o foco acompanha o clique reentregue, sem rolar');

  const blocked = fakeClickEvent();
  applyGestureClickRoute({...clickOn(bodyB), preventDefault: blocked.preventDefault, stopPropagation: blocked.stopPropagation},
    {action: 'block'});
  assert.equal(blocked.prevented, 1);
  assert.equal(blocked.stopped, 1);
  assert.equal(owner.clicks, 1, 'impedido não reentrega');
  assert.equal(owner.focuses.length, 1, 'impedido não move o foco');

  // Dono sem click(): o clique só é impedido, sem erro.
  const notClickable = {} as unknown as Element;
  const unclickable = fakeClickEvent();
  assert.doesNotThrow(() => applyGestureClickRoute(
    {...clickOn(bodyB), preventDefault: unclickable.preventDefault, stopPropagation: unclickable.stopPropagation},
    {action: 'reroute', to: notClickable},
  ));
  assert.equal(unclickable.prevented, 1);
  assert.equal(unclickable.stopped, 1);

  const passed = fakeClickEvent();
  applyGestureClickRoute({...clickOn(bodyB), preventDefault: passed.preventDefault, stopPropagation: passed.stopPropagation},
    {action: 'pass'});
  assert.equal(passed.prevented + passed.stopped, 0, 'passa intocado');
});

test('roteador: reentrega o click desviado do gesto e encerra o gesto no primeiro click', () => {
  const router = createGestureClickRouter();
  const owner = new FakeElement('arquivar E', list, true);
  const icon = new FakeElement('ícone de arquivar E', owner);
  const body = new FakeElement('texto do aviso F', new FakeElement('aviso F', list, true));
  const event = (target: EventTarget, detail = 1) => {
    const fake = fakeClickEvent();
    return {detail, target, pointerId: 9, timeStamp: 1_015, preventDefault: fake.preventDefault, stopPropagation: fake.stopPropagation, fake};
  };

  router.recordPointerDown({target: icon, pointerId: 9, pointerType: 'touch', timeStamp: 1_000});
  const first = event(body);
  router.routeClick(first);
  assert.equal(owner.clicks, 1, 'reentregue ao "Arquivar" de origem');
  assert.equal(first.fake.prevented, 1);

  const second = event(body);
  router.routeClick(second);
  assert.equal(owner.clicks, 1, 'sem novo pointerdown, a origem antiga não serve a outro click');
  assert.equal(second.fake.prevented, 0);

  router.recordPointerDown({target: icon, pointerId: 10, pointerType: 'touch', timeStamp: 2_000});
  const keyboard = event(body, 0);
  router.routeClick(keyboard);
  assert.equal(keyboard.fake.prevented, 0, 'click de teclado não encerra nem usa o gesto');
  // Click sem pointerId e com detail 0 (teclado onde o click não é PointerEvent), dentro da janela:
  // passa intocado e não consome o gesto, que segue valendo para o click do próprio toque.
  const keyboardNoPointer = {...event(body, 0), pointerId: undefined, timeStamp: 2_010};
  router.routeClick(keyboardNoPointer);
  assert.equal(keyboardNoPointer.fake.prevented, 0, 'teclado sem pointerId passa intocado');
  assert.equal(owner.clicks, 1, 'teclado não é reentregue à origem do toque');
  const touchClick = {...event(body), pointerId: 10, timeStamp: 2_015};
  router.routeClick(touchClick);
  assert.equal(owner.clicks, 2, 'o click do toque ainda é reentregue: o teclado não consumiu o gesto');
  assert.equal(touchClick.fake.prevented, 1);
  router.reset();
  const afterReset = event(body);
  router.routeClick(afterReset);
  assert.equal(owner.clicks, 2, 'depois do reset, nada é reentregue');
  assert.equal(afterReset.fake.prevented, 0, 'reset limpa a origem');
});

// --- Ouvintes no documento ----------------------------------------------------------

test('o roteamento usa um único par de ouvintes de captura, encerra o gesto no primeiro click e solta tudo ao sair', async () => {
  const fakeDocument = new EventTarget();
  const added: Array<{type: string; options: unknown}> = [];
  const removed: Array<{type: string; options: unknown}> = [];
  const add = fakeDocument.addEventListener.bind(fakeDocument);
  const remove = fakeDocument.removeEventListener.bind(fakeDocument);
  fakeDocument.addEventListener = (type, listener, options) => { added.push({type, options}); add(type, listener, options); };
  fakeDocument.removeEventListener = (type, listener, options) => { removed.push({type, options}); remove(type, listener, options); };
  const globals = globalThis as {document?: unknown};
  const previous = globals.document;
  globals.document = fakeDocument;
  try {
    const Probe = () => { usePointerOriginTracking(); return null; };
    let renderer: ReactTestRenderer | null = null;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(createElement('div', null, createElement(Probe), createElement(Probe)));
    });
    assert.deepEqual(added, [{type: 'pointerdown', options: true}, {type: 'click', options: true}], 'dois componentes, um par');

    // Gesto registrado no próprio documento (alvo sem dono) e click de ponteiro no documento:
    // mesmo "dono" (nenhum) → passa; o primeiro click encerra o gesto.
    const pointerdown = new Event('pointerdown');
    fakeDocument.dispatchEvent(pointerdown);
    const firstClick = Object.assign(new Event('click', {cancelable: true}), {detail: 1});
    fakeDocument.dispatchEvent(firstClick);
    assert.equal(firstClick.defaultPrevented, false);

    await TestRenderer.act(async () => {
      renderer?.update(createElement('div', null, createElement(Probe)));
    });
    assert.deepEqual(removed, [], 'ainda há quem use');
    await TestRenderer.act(async () => { renderer?.unmount(); });
    assert.deepEqual(removed, [{type: 'pointerdown', options: true}, {type: 'click', options: true}]);
  } finally {
    globals.document = previous;
  }
});
