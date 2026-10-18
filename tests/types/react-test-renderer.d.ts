/*
 * Tipos mínimos de `react-test-renderer@18.2.0` (devDependency usada só para
 * executar hooks React reais nos testes unitários, sem DOM). O pacote
 * `@types/react-test-renderer@18` traria `@types/react@18`, em conflito com
 * os tipos do React já instalados; aqui só o que os testes usam.
 */
declare module 'react-test-renderer' {
  import type {ReactElement} from 'react';

  export interface ReactTestRenderer {
    update(element: ReactElement): void;
    unmount(): void;
  }

  export function create(element: ReactElement): ReactTestRenderer;
  export function act(callback: () => void | Promise<void>): Promise<void>;

  const TestRenderer: {
    create: typeof create;
    act: typeof act;
  };
  export default TestRenderer;
}
