import React, { useState } from 'react';

import type { LoanCreateForm } from '../../modules/loans/payloads.ts';
import { AMORTIZATION_LABELS, LOAN_TYPE_LABELS } from '../../modules/loans/presentation.ts';
import type { LoanAmortization, LoanProfileType, LoanType } from '../../modules/loans/types.ts';

/**
 * Peças compartilhadas da contratação PF/PJ (P3-H). Os valores ficam como
 * texto; a conversão para centavos e taxa inteira é do `toCreateLoanPayload`.
 * Não há prévia de cronograma: ele é calculado pelo backend ao salvar.
 */
export type LoanFormPatch = (patch: Partial<LoanCreateForm>) => void;

const SEGMENT: Record<LoanProfileType, string> = {
  PF: 'flex-1 py-3 text-sm font-bold rounded-lg transition-all',
  PJ: 'flex-1 py-3 text-xs font-black uppercase rounded-lg transition-all',
};

const ORDER: Record<LoanProfileType, LoanType[]> = {
  PF: ['lend', 'borrow'],
  PJ: ['borrow', 'lend'],
};

/**
 * Natureza no mesmo seletor segmentado de antes, agora com rádios nativos
 * transparentes por cima de cada segmento: setas do teclado, clique e leitor
 * de tela funcionam sem mudar o visual; o anel aparece só com foco por
 * teclado.
 */
export const LoanNatureToggle: React.FC<{
  profileType: LoanProfileType;
  name: string;
  value: LoanType;
  onChange: (value: LoanType) => void;
  labelledBy?: string;
}> = ({ profileType, name, value, onChange, labelledBy }) => (
  <div
    role="radiogroup"
    {...(labelledBy ? { 'aria-labelledby': labelledBy } : { 'aria-label': 'Natureza' })}
    className="flex bg-background p-1 rounded-xl border border-border"
  >
    {ORDER[profileType].map((type) => {
      const checked = value === type;
      return (
        <label
          key={type}
          className={`relative text-center cursor-pointer ${SEGMENT[profileType]} ${checked ? 'bg-primary text-white shadow-md' : 'text-muted hover:text-on-surface'} [&:has(:focus-visible)]:ring-2 [&:has(:focus-visible)]:ring-primary`}
        >
          <input
            type="radio"
            name={name}
            value={type}
            checked={checked}
            onChange={() => onChange(type)}
            className="absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0"
          />
          {LOAN_TYPE_LABELS[profileType][type]}
        </label>
      );
    })}
  </div>
);

/**
 * "Dividir em parcelas": desmarcado = pagamento único (1 parcela); marcado
 * mostra a quantidade (2 a 360), como no formulário anterior.
 */
export const useInstallmentSplit = (form: LoanCreateForm, onChange: LoanFormPatch) => {
  const [split, setSplit] = useState(form.installments !== '1');
  const toggle = (checked: boolean) => {
    setSplit(checked);
    onChange({ installments: checked ? '2' : '1' });
  };
  return { split, toggle };
};

export const AMORTIZATION_OPTIONS: LoanAmortization[] = ['price', 'sac', 'simple'];
export const amortizationLabel = (value: LoanAmortization): string => AMORTIZATION_LABELS[value];
