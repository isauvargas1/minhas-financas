import React, { useEffect, useRef } from 'react';

/**
 * Primitivas compartilhadas pelas superfícies do domínio patrimonial.
 *
 * Existiam três cópias quase idênticas de `Dialog`, `Field` e `safeError` — em
 * `InvestmentRegistrySection`, em `InvestmentsPortfolioView` e em
 * `InvestmentEntityForm`, este último código morto que declarava existir
 * justamente para impedir a divergência que já havia acontecido. Uma única
 * definição elimina a divergência de acessibilidade e de mensagem de erro
 * entre telas que o usuário percebe como a mesma coisa.
 */

/**
 * Mensagem de erro segura para a tela.
 *
 * Nenhuma mensagem técnica de Firebase, Firestore ou callable chega ao
 * usuário: o código do erro escolhe uma frase em pt-BR, e o resto é
 * descartado. Quando o backend devolve uma pré-condição de domínio, a
 * mensagem dele **é** a explicação e vale mais que uma frase genérica.
 */
export { safeInvestmentError as safeError } from '../errors';

export const Dialog: React.FC<{
  title: string;
  open: boolean;
  onClose(): void;
  children: React.ReactNode;
}> = ({ title, open, onClose, children }) => {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open && !ref.current?.open) {
      opener.current = document.activeElement as HTMLElement;
      ref.current?.showModal();
    } else if (!open && ref.current?.open) {
      ref.current.close();
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClose={() => opener.current?.focus()}
      className="w-[min(94vw,36rem)] rounded-2xl bg-surface p-0 text-on-surface shadow-2xl backdrop:bg-black/50"
    >
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h3 className="text-lg font-bold">{title}</h3>
        <button type="button" onClick={onClose} aria-label="Fechar janela" className="rounded-lg px-3 py-2 hover:bg-background">×</button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
};

export const Field: React.FC<
  React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }
> = ({ label, hint, ...props }) => (
  <label className="grid gap-1 text-sm font-medium">
    {label}
    <input {...props} className="rounded-lg border border-border bg-surface px-3 py-2" />
    {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
  </label>
);

export const money = (cents = 0): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
