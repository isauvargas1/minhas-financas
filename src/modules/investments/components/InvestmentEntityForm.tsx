import React from 'react';
import type { InvestmentAccount, InvestmentAsset } from '../types';

/**
 * Formulário compartilhado de conta e ativo de investimento.
 *
 * Usado pela tela patrimonial e por Configurações > Cadastros. Extraído para
 * que as duas superfícies não divirjam nos campos, nos rótulos ou nas regras
 * PF/PJ de finalidade de alocação.
 */

export const InvestmentField: React.FC<
  React.InputHTMLAttributes<HTMLInputElement> & { label: string }
> = ({ label, ...props }) => (
  <label className="grid gap-1 text-sm font-medium">
    {label}
    <input {...props} className="rounded-lg border border-outline/30 bg-surface px-3 py-2" />
  </label>
);

export interface InvestmentEntityFormProps {
  kind: 'account' | 'asset';
  profileType: 'PF' | 'PJ';
  selected: InvestmentAccount | InvestmentAsset | null;
  pending: boolean;
  onSubmit(payload: Record<string, unknown>): void;
}

export const InvestmentEntityForm: React.FC<InvestmentEntityFormProps> = ({
  kind, profileType, selected, pending, onSubmit,
}) => {
  const handle = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (kind === 'account') {
      onSubmit({
        accountId: selected?.id,
        name: form.get('name'),
        institutionName: form.get('institutionName'),
      });
      return;
    }
    onSubmit({
      assetId: selected?.id,
      name: form.get('name'),
      symbol: form.get('symbol') || undefined,
      assetType: form.get('assetType'),
      allocationPurpose: form.get('allocationPurpose'),
    });
  };

  if (kind === 'account') {
    const account = selected as InvestmentAccount | null;
    return (
      <form onSubmit={handle} className="grid gap-4">
        <InvestmentField label="Nome da conta" name="name" required defaultValue={account?.name} />
        <InvestmentField label="Instituição" name="institutionName" required defaultValue={account?.institutionName} />
        <p className="text-xs text-on-surface-variant">
          Conta de investimento é o registro da instituição onde o patrimônio está
          custodiado. Não se confunde com carteira de caixa, que continua nos
          cadastros gerais e representa dinheiro disponível.
        </p>
        <button disabled={pending} className="rounded-lg bg-primary px-4 py-2 text-on-primary">Salvar conta</button>
      </form>
    );
  }

  const asset = selected as InvestmentAsset | null;
  return (
    <form onSubmit={handle} className="grid gap-4">
      <InvestmentField label="Nome do ativo" name="name" required defaultValue={asset?.name} />
      <InvestmentField label="Código do ativo (opcional)" name="symbol" defaultValue={asset?.symbol} />
      <label className="grid gap-1 text-sm font-medium">
        Tipo
        <select name="assetType" className="rounded-lg border px-3 py-2" defaultValue={asset?.assetType ?? 'fixed_income'}>
          <option value="fixed_income">Renda fixa</option>
          <option value="fund">Fundo</option>
          <option value="stock">Ação</option>
          <option value="etf">ETF</option>
          <option value="crypto">Criptoativo</option>
          <option value="other">Outro</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium">
        Finalidade
        <select name="allocationPurpose" className="rounded-lg border px-3 py-2" defaultValue={asset?.allocationPurpose ?? 'unassigned'}>
          <option value="unassigned">Não classificado</option>
          {profileType === 'PF' ? (
            <>
              <option value="retirement">Aposentadoria</option>
              <option value="goal">Objetivo</option>
            </>
          ) : (
            <>
              <option value="reserve">Reserva</option>
              <option value="financial_application">Aplicação financeira</option>
              <option value="reinvestment">Reinvestimento</option>
              <option value="fixed_asset">Imobilizado</option>
            </>
          )}
        </select>
      </label>
      <p className="text-xs text-on-surface-variant">
        A finalidade não poderá ser alterada depois do primeiro aporte, para
        preservar relatórios históricos.
      </p>
      <button disabled={pending} className="rounded-lg bg-primary px-4 py-2 text-on-primary">Salvar ativo</button>
    </form>
  );
};

export default InvestmentEntityForm;
