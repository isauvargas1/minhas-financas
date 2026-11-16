import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import '../../src/index.css';
import ReportPeriodSelect from '../../src/components/ReportPeriodSelect.tsx';
import type { ReportTimeRange } from '../../src/modules/reports/types.ts';

/*
 * P5-GATE-FINAL (2ª revisão, PTBR2-02 e PTBR2-03) — página de teste com o ReportPeriodSelect real, as opções do
 * relatório (as de `getAvailableReportPeriods`, copiadas: o módulo da API inicializa o Firebase) e o CSS real do app (Tailwind do build, com as variáveis de tema que a página define), sobre o fundo
 * da página, como na tela de Relatórios. Só é empacotada por `e2e/a11y-keyboard-p5gate.spec.ts`.
 */
const OPTIONS: { label: string; value: ReportTimeRange }[] = [
  { label: 'Últimos 7 dias', value: '7d' },
  { label: 'Últimos 30 dias', value: '30d' },
  { label: 'Últimos 3 meses', value: '90d' },
  { label: 'Último Ano', value: '12m' },
  { label: 'Ano Atual (YTD)', value: 'ytd' },
  { label: 'Todo o Período', value: 'all' },
];

const Harness = () => {
  const [value, setValue] = useState<ReportTimeRange>('30d');
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="flex justify-end">
        <ReportPeriodSelect value={value} onChange={setValue} options={OPTIONS} />
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<Harness />);
