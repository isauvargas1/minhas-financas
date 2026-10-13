import { createElement, type ComponentProps } from 'react';
import { AnimatePresence as RealAnimatePresence } from 'framer-motion';

export * from 'framer-motion';

/*
 * P5-E1.1 — só no bundle de `e2e/notifications-exit-race.spec.ts`: o mesmo
 * AnimatePresence do framer-motion, que, depois de chamar o `onExitComplete`
 * do painel (primeiro e sem mudança), avisa o teste uma vez. É o instante em
 * que a última saída terminou e o re-render adiado do AnimatePresence ainda
 * não aconteceu.
 */
type ProbeWindow = Window & { __afterExitComplete?: (() => void) | null };

export const AnimatePresence = (props: ComponentProps<typeof RealAnimatePresence>) =>
  createElement(RealAnimatePresence, {
    ...props,
    onExitComplete: () => {
      props.onExitComplete?.();
      const probe = window as ProbeWindow;
      const after = probe.__afterExitComplete;
      probe.__afterExitComplete = null;
      after?.();
    },
  });
