import { useEffect } from 'react';

/**
 * P5-E1.1 — o clique de um gesto vai para o elemento em que o gesto começou.
 *
 * Num toque, o navegador entrega `pointerdown`/`touchstart`/`touchend` ao
 * elemento tocado e só depois gera o `click` de compatibilidade, com um novo
 * teste de acerto. Se o layout muda nesse intervalo (por exemplo, um aviso
 * arquivado sai da lista com animação e os de baixo sobem), o `click` cai em
 * outro elemento: o corpo de outro aviso (marca como lido, navega e fecha o
 * painel), outro botão ou o fundo que fecha o painel.
 *
 * O navegador continua decidindo SE houve clique (toque curto, sem rolagem,
 * sem parar inércia, sem toque longo); aqui só se corrige ONDE ele age. Um
 * ouvinte de captura no documento guarda a origem do último `pointerdown` e,
 * quando o `click` desse mesmo gesto cai num "dono" diferente daquele em que o
 * gesto começou (dono = elemento marcado com `data-press-target`), impede que
 * ele aja ali e:
 * - toque ou caneta: reentrega o clique ao dono de origem (`click()`), se ele
 *   ainda está na página;
 * - mouse, origem sem dono ou dono que saiu da página: só impede.
 * Clique sem ponteiro (teclado, leitor de tela, `click()` programático), de
 * outro ponteiro ou de gesto antigo passa como sempre.
 */

export const PRESS_TARGET_ATTRIBUTE = 'data-press-target';

/** Marca o elemento como dono de gesto. */
export const pressTargetProps = { [PRESS_TARGET_ATTRIBUTE]: '' } as const;

/** Acima disto entre `pointerdown` e `click`, não é o mesmo gesto (ex.: segurar o mouse). */
export const GESTURE_CLICK_WINDOW_MS = 1000;

/** Origem do último `pointerdown`. */
export interface PointerOrigin {
  readonly target: EventTarget | null;
  readonly pointerId: number | undefined;
  readonly pointerType: string | undefined;
  readonly timeStamp: number;
}

/** O que a regra lê do `click` (no Chromium o `click` é um `PointerEvent`). */
export interface GestureClick {
  readonly detail: number;
  readonly target: EventTarget | null;
  readonly timeStamp: number;
  readonly pointerId?: number;
}

export type GestureClickRoute =
  | { readonly action: 'pass' }
  | { readonly action: 'block' }
  | { readonly action: 'reroute'; readonly to: Element };

const PASS: GestureClickRoute = { action: 'pass' };
const BLOCK: GestureClickRoute = { action: 'block' };

type OwnerCandidate = EventTarget & {
  readonly closest?: unknown;
  readonly parentElement?: Element | null;
  readonly isConnected?: boolean;
};

/** Dono de gesto mais próximo do alvo (ou `null` se ele não tem dono). */
const pressOwnerOf = (target: EventTarget): Element | null => {
  const candidate = target as OwnerCandidate;
  const element = typeof candidate.closest === 'function' ? (candidate as unknown as Element) : candidate.parentElement ?? null;
  return element ? element.closest(`[${PRESS_TARGET_ATTRIBUTE}]`) : null;
};

/**
 * Regra pura: para onde vai o `click`.
 * - `pass`: sem ponteiro (`detail === 0`), sem origem, de outro ponteiro, de
 *   gesto antigo ou caindo no mesmo dono em que o gesto começou;
 * - `reroute`: toque/caneta que caiu em outro dono (ou fora de qualquer dono)
 *   volta ao dono de origem;
 * - `block`: mouse, origem sem dono ou dono de origem fora da página.
 */
export const routeGestureClick = (origin: PointerOrigin | null, click: GestureClick): GestureClickRoute => {
  if (click.detail === 0 || origin === null || origin.target === null || click.target === null) return PASS;
  if (typeof click.pointerId === 'number' && typeof origin.pointerId === 'number' && click.pointerId !== origin.pointerId) {
    return PASS;
  }
  if (click.timeStamp - origin.timeStamp > GESTURE_CLICK_WINDOW_MS) return PASS;
  const from = pressOwnerOf(origin.target);
  const to = pressOwnerOf(click.target);
  if (from === to) return PASS;
  if (from === null || origin.pointerType === 'mouse' || (from as OwnerCandidate).isConnected === false) return BLOCK;
  return { action: 'reroute', to: from };
};

/** O que o tratamento usa do evento de clique. */
export interface RoutableClickEvent extends GestureClick {
  preventDefault(): void;
  stopPropagation(): void;
}

/** O que a reentrega usa do dono de origem. */
type ClickableOwner = { readonly click?: unknown; readonly focus?: unknown };

/**
 * Aplica a rota: impede o clique onde caiu e, se for o caso, o reentrega à
 * origem. O foco vai junto (o `mousedown` de compatibilidade pode tê-lo levado
 * ao elemento em que o clique caiu), sem rolar a tela. Dono sem `click()` só
 * tem o clique impedido.
 */
export const applyGestureClickRoute = (event: RoutableClickEvent, route: GestureClickRoute): void => {
  if (route.action === 'pass') return;
  event.preventDefault();
  event.stopPropagation();
  if (route.action !== 'reroute') return;
  const owner = route.to as unknown as ClickableOwner;
  if (typeof owner.click !== 'function') return;
  if (typeof owner.focus === 'function') (owner.focus as (options: FocusOptions) => void).call(owner, { preventScroll: true });
  (owner.click as () => void).call(owner);
};

/** O que o roteador lê do `pointerdown`. */
export interface PointerDownLike {
  readonly target: EventTarget | null;
  readonly pointerId?: number;
  readonly pointerType?: string;
  readonly timeStamp: number;
}

export interface GestureClickRouter {
  readonly recordPointerDown: (event: PointerDownLike) => void;
  readonly routeClick: (event: RoutableClickEvent) => void;
  readonly reset: () => void;
}

/** Roteador com a origem do último gesto (uma instância por página). */
export const createGestureClickRouter = (): GestureClickRouter => {
  let lastPointerDown: PointerOrigin | null = null;
  return {
    recordPointerDown: (event) => {
      lastPointerDown = {
        target: event.target,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        timeStamp: event.timeStamp,
      };
    },
    routeClick: (event) => {
      const origin = lastPointerDown;
      // O clique de ponteiro encerra o gesto: a origem não serve a outro clique.
      if (event.detail !== 0) lastPointerDown = null;
      applyGestureClickRoute(event, routeGestureClick(origin, event));
    },
    reset: () => {
      lastPointerDown = null;
    },
  };
};

const router = createGestureClickRouter();
let trackingSubscribers = 0;

const recordPointerDown = (event: PointerEvent): void => router.recordPointerDown(event);
const routeClick = (event: MouseEvent): void => router.routeClick(event);

/**
 * Mantém o roteamento do clique enquanto o componente está montado: um único
 * par de ouvintes de captura no documento (`pointerdown` e `click`), contado
 * por quem o usa.
 */
export const usePointerOriginTracking = (): void => {
  useEffect(() => {
    if (trackingSubscribers === 0) {
      document.addEventListener('pointerdown', recordPointerDown, true);
      document.addEventListener('click', routeClick, true);
    }
    trackingSubscribers += 1;
    return () => {
      trackingSubscribers -= 1;
      if (trackingSubscribers === 0) {
        document.removeEventListener('pointerdown', recordPointerDown, true);
        document.removeEventListener('click', routeClick, true);
        router.reset();
      }
    };
  }, []);
};
