import React, { useEffect, useRef } from 'react';

import { CloseIcon } from '../../../../components/Icons';

/**
 * Primitivas visuais dos modais simples de investimento (Etapa 2, §2).
 *
 * O usuário precisa reconhecer o formulário antigo. Estas classes são as do
 * baseline `3395f465` — mesma sobreposição, mesmo painel, mesmo cabeçalho
 * grudado, mesmo `commonInputClasses` com o anel azul do tipo investimento.
 * O que mudou é só o que está **atrás**: nada aqui escreve em `transactions`.
 *
 * Um arquivo, e não uma cópia por modal, porque foi exatamente a triplicação
 * de `Dialog`/`Field` que o `components/shared.tsx` do domínio já teve de
 * desfazer uma vez.
 */

export const inputClasses =
  'w-full border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-dark-200 ' +
  'text-gray-800 dark:text-gray-200 rounded-lg px-4 py-2 focus:outline-none ' +
  'focus:ring-2 focus:ring-blue-500';

export const labelClasses =
  'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';

export const submitClasses =
  'w-full text-white font-medium py-3 px-4 rounded-lg shadow-md transition-colors ' +
  'duration-200 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 ' +
  'disabled:opacity-60 disabled:cursor-not-allowed';

export const Required: React.FC = () => <span className="text-red-500">*</span>;

export const FieldError: React.FC<{ id: string; message?: string }> = ({ id, message }) =>
  message ? (
    <p id={id} role="alert" className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
      {message}
    </p>
  ) : null;

/**
 * Painel do modal, com o mesmo esqueleto do baseline mais o fechamento por
 * Escape e o foco inicial no título que a versão atual do `TransactionModal`
 * já adotou. Acessibilidade é acréscimo, nunca subtração.
 */
export const SimpleModal: React.FC<{
  title: string;
  open: boolean;
  onClose(): void;
  children: React.ReactNode;
}> = ({ title, open, onClose, children }) => {
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    titleRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4 transition-opacity"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="simple-investment-modal-title"
        className="bg-white dark:bg-dark-100 rounded-xl shadow-lg w-full max-w-lg transition-transform transform scale-95 animate-scale-in max-h-[90vh] overflow-y-auto"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex justify-between items-center p-6 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-dark-100 z-10">
          <h3
            id="simple-investment-modal-title"
            ref={titleRef}
            tabIndex={-1}
            className="text-xl font-bold text-gray-800 dark:text-white outline-none"
          >
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
      {/*
        `animate-scale-in` não existe na configuração do Tailwind servida pelo
        CDN; o baseline declarava a animação no próprio modal. Mantida aqui
        pelo mesmo motivo — o painel entra com o mesmo movimento de antes.
      */}
      <style>{`
        @keyframes scale-in {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .animate-scale-in { animation: scale-in 0.2s ease-out forwards; }
      `}</style>
    </div>
  );
};

/**
 * Campo de dinheiro em BRL.
 *
 * O baseline usava `<input type="number">` cru; o §4 pede valor formatado como
 * moeda. A máscara entra pela direita, em centavos, e o prefixo "R$" é visual —
 * o que o formulário devolve continua sendo texto, convertido por
 * `parseCurrencyInput`.
 */
export const CurrencyField: React.FC<{
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
  error?: string;
  required?: boolean;
  hint?: string;
  disabled?: boolean;
}> = ({ id, label, value, onChange, error, required, hint, disabled }) => (
  <div>
    <label htmlFor={id} className={labelClasses}>
      {label} {required && <Required />}
    </label>
    <div className="relative">
      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-gray-500 dark:text-gray-400">
        R$
      </span>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        value={value}
        placeholder="0,00"
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${inputClasses} pl-10`}
      />
    </div>
    {hint && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
    <FieldError id={`${id}-error`} message={error} />
  </div>
);

export interface SelectOption { value: string; label: string }

export const SelectField: React.FC<{
  id: string;
  label: string;
  value: string;
  options: SelectOption[];
  onChange(value: string): void;
  placeholder?: string;
  error?: string;
  required?: boolean;
  hint?: string;
  emptyHint?: string;
  disabled?: boolean;
}> = ({
  id, label, value, options, onChange, placeholder = 'Selecione...',
  error, required, hint, emptyHint, disabled,
}) => (
  <div>
    <label htmlFor={id} className={labelClasses}>
      {label} {required && <Required />}
    </label>
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      className={inputClasses}
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
    {options.length === 0 && emptyHint && (
      <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">{emptyHint}</p>
    )}
    {hint && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
    <FieldError id={`${id}-error`} message={error} />
  </div>
);

export const DateField: React.FC<{
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
  error?: string;
  required?: boolean;
}> = ({ id, label, value, onChange, error, required }) => (
  <div>
    <label htmlFor={id} className={labelClasses}>
      {label} {required && <Required />}
    </label>
    <input
      id={id}
      type="date"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      className={inputClasses}
    />
    <FieldError id={`${id}-error`} message={error} />
  </div>
);

/** Pergunta de duas respostas, no mesmo bloco cinza do baseline. */
export const YesNoField: React.FC<{
  name: string;
  legend: string;
  value: boolean;
  onChange(value: boolean): void;
  children?: React.ReactNode;
}> = ({ name, legend, value, onChange, children }) => (
  <fieldset className="bg-gray-50 dark:bg-dark-200 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
    <legend className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 px-1">
      {legend}
    </legend>
    <div className="flex gap-4 mb-3">
      <label className="flex items-center cursor-pointer">
        <input
          type="radio"
          name={name}
          checked={value}
          onChange={() => onChange(true)}
          className="mr-2 text-blue-600 focus:ring-blue-500"
        />
        <span className="text-gray-700 dark:text-gray-300">Sim</span>
      </label>
      <label className="flex items-center cursor-pointer">
        <input
          type="radio"
          name={name}
          checked={!value}
          onChange={() => onChange(false)}
          className="mr-2 text-blue-600 focus:ring-blue-500"
        />
        <span className="text-gray-700 dark:text-gray-300">Não</span>
      </label>
    </div>
    {children}
  </fieldset>
);

export const ErrorBanner: React.FC<{ message?: string }> = ({ message }) =>
  message ? (
    <div
      role="alert"
      className="mb-4 rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300"
    >
      {message}
    </div>
  ) : null;
