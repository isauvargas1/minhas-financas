// P5-E1.1 — reprodução determinística, fora do app, do defeito de remoção do
// AnimatePresence do framer-motion 10.16.4 (mesma versão do app, React 18.2).
//
// Mecanismo: quando a última saída em andamento termina, o AnimatePresence agenda
// `forceRender()` para o próximo quadro. O `forceRender` vem de `useForceUpdate`,
// que faz `setForcedRenderCount(forcedRenderCount + 1)` com o valor capturado no
// render em que a função foi criada. A saída de um item que começa ANTES desse
// render adiado captura o mesmo `forceRender` (contador N). O render adiado leva o
// contador a N+1; quando a saída do segundo item termina, o `forceRender` dele
// grava N+1 de novo, o React descarta a atualização igual e o item fica no DOM
// (opacidade 0, altura 0) até algum outro render do pai.
//
// Aqui a segunda remoção é disparada de dentro do `onExitComplete` da primeira:
// é exatamente a janela entre o fim da saída e o render adiado. `?fix=1` liga a
// correção usada no painel: o pai re-renderiza a cada `onExitComplete`. `?layout=1`
// põe `layout` nas linhas, como no painel original; `?n=` é o número de itens (padrão 3).
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';

const params = new URLSearchParams(location.search);
const fix = params.get('fix') === '1';
const withLayout = params.get('layout') === '1';
const log = [];
window.__log = log;
const push = (s) => log.push(`${Math.round(performance.now())} ${s}`);

function List() {
  const [items, setItems] = useState(() => 'abcdefgh'.slice(0, Number(params.get('n') ?? 3)).split(''));
  const [, setExitTick] = useState(0);
  window.__remove = (id) => flushSync(() => setItems((current) => current.filter((item) => item !== id)));
  return (
    <AnimatePresence
      initial={false}
      onExitComplete={() => {
        push('exitComplete');
        const next = window.__onExitComplete;
        window.__onExitComplete = null;
        if (next) next();
        if (fix) setExitTick((tick) => tick + 1);
      }}
    >
      {items.map((id) => (
        <motion.div
          key={id}
          data-id={id}
          layout={withLayout}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.1 }}
          style={{ height: 40 }}
          onAnimationComplete={() => push(`saída concluída ${id}`)}
        >
          {id}
        </motion.div>
      ))}
    </AnimatePresence>
  );
}

createRoot(document.getElementById('root')).render(<List />);
