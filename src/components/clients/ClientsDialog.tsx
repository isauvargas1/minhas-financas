import React, { useEffect, useId, useRef } from 'react';
import { CloseIcon, WarningIcon } from '../Icons.tsx';

/**
 * Moldura dos diálogos de clientes e recebíveis (P3-I): `role="dialog"` com
 * título, foco inicial no título, Tab e Shift+Tab presos no diálogo, Escape e
 * o X fecham, e o foco volta para quem abriu. Enquanto `busy`, fechar não é
 * possível (a operação está no servidor).
 *
 * As variantes reproduzem, classe a classe, as molduras que o módulo já tinha
 * (o frontend autenticado não muda de aparência): `form` = os modais "Novo
 * Cliente"/"Novo Recebível"; `confirm` = o `ConfirmationModal` do app, que
 * substitui os `confirm()` do navegador (arquivar, cancelar, estornar).
 */
const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
  'input:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

export type ClientsDialogVariant = 'form' | 'confirm';

const SHELLS: Record<ClientsDialogVariant, {
  panel: string;
  header: string;
  title: string;
  close: string;
  body: string;
  footer: string;
}> = {
  form: {
    panel: 'bg-surface w-full max-w-md rounded-xl shadow-lg border border-border flex flex-col max-h-[90vh] animate-scale-in',
    header: 'flex justify-between items-center p-5 border-b border-border',
    title: 'text-lg font-bold text-on-surface flex items-center gap-2',
    close: 'text-muted hover:text-on-surface',
    body: 'p-6 overflow-y-auto space-y-4',
    footer: 'pt-4 flex justify-end gap-3',
  },
  confirm: {
    panel: 'bg-white dark:bg-dark-100 rounded-xl shadow-lg w-full max-w-md animate-scale-in max-h-[90vh] flex flex-col overflow-hidden',
    header: 'flex justify-between items-center p-5 border-b border-gray-200 dark:border-gray-700',
    title: 'text-lg font-bold text-gray-800 dark:text-white',
    close: 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
    body: 'overflow-y-auto p-6 text-center',
    footer: 'flex justify-end items-center gap-3 p-4 bg-gray-50 dark:bg-dark-200 rounded-b-xl',
  },
};

/** Classes dos campos e botões, as mesmas dos modais da base. */
export const CLIENTS_FORM_STYLES = {
  label: 'block text-sm font-medium text-on-surface mb-1',
  input: 'w-full bg-background border border-border rounded-lg px-4 py-2 text-on-surface focus:ring-2 focus:ring-primary outline-none disabled:opacity-60 disabled:cursor-not-allowed',
  hint: 'text-xs text-muted mt-1',
  cancel: 'px-4 py-2 text-sm font-medium text-muted hover:bg-background rounded-lg transition-colors disabled:opacity-60',
  submit: 'px-6 py-2 bg-primary hover:bg-primary/90 text-white font-medium rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
} as const;

export const CLIENTS_CONFIRM_STYLES = {
  label: 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1',
  input: 'w-full border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-dark-200 text-gray-800 dark:text-gray-200 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-red-500',
  secondary: 'py-2 px-4 rounded-lg bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 font-medium transition-colors disabled:opacity-60',
  danger: 'py-2 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed',
} as const;

interface ClientsDialogProps {
  open: boolean;
  title: string;
  /** Ícone ao lado do título (variante `form`). */
  icon?: React.ReactNode;
  variant?: ClientsDialogVariant;
  onClose: () => void;
  busy?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

const ClientsDialog: React.FC<ClientsDialogProps> = ({
  open, title, icon, variant = 'form', onClose, busy = false, children, footer,
}) => {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;
  const shell = SHELLS[variant];

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement as HTMLElement | null;
    titleRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!busyRef.current) closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === titleRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={() => { if (!busy) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={shell.panel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={shell.header}>
          <h3 id={titleId} ref={titleRef} tabIndex={-1} className={`${shell.title} outline-none`}>
            {variant === 'form' && icon}
            {title}
          </h3>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Fechar" className={`${shell.close} disabled:opacity-50`}>
            <CloseIcon />
          </button>
        </div>
        <div className={shell.body}>
          {variant === 'confirm' && (
            <div className="flex justify-center mb-4">
              <WarningIcon className="h-12 w-12 text-red-500 dark:text-red-400" />
            </div>
          )}
          {children}
          {footer && variant === 'form' && <div className={shell.footer}>{footer}</div>}
        </div>
        {footer && variant === 'confirm' && <div className={shell.footer}>{footer}</div>}
      </div>
    </div>
  );
};

export default ClientsDialog;

/** Erro da última tentativa, anunciado (pt-BR, já traduzido). */
export const ClientsFormError: React.FC<{ message: string | null; variant?: ClientsDialogVariant }> = ({
  message, variant = 'form',
}) => {
  if (!message) return null;
  if (variant === 'confirm') {
    return <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{message}</p>;
  }
  return (
    <p role="alert" className="rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-sm font-medium text-red-700 dark:text-red-300">
      {message}
    </p>
  );
};

/** Aviso de sucesso da última operação, anunciado por leitor de tela. */
export const ClientsNotice: React.FC<{ message: string | null }> = ({ message }) => (
  <p role="status" aria-live="polite" className={message ? 'mb-4 rounded-lg bg-green-50 dark:bg-green-900/20 p-3 text-sm font-medium text-green-800 dark:text-green-200 flex-shrink-0' : 'sr-only'}>
    {message ?? ''}
  </p>
);
