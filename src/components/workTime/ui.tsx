import React, { useEffect, useRef } from 'react';

import { CloseIcon } from '../Icons.tsx';

/**
 * Peças visuais do tempo de trabalho equivalente (P5-F.1), com as mesmas
 * classes da tela da P5-F e do restante das Configurações.
 */

export const inputClass =
  'w-full bg-background border border-border rounded-lg px-4 py-2 text-on-surface focus:ring-2 focus:ring-primary outline-none aria-[invalid=true]:border-red-500';
export const compactInputClass =
  'w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-on-surface focus:ring-2 focus:ring-primary outline-none aria-[invalid=true]:border-red-500';
export const labelClass = 'block text-xs font-bold text-muted uppercase mb-1';
export const cardClass = 'bg-surface rounded-card border border-border p-4 sm:p-6 shadow-sm';
export const primaryButtonClass =
  'py-2.5 px-5 bg-primary hover:bg-primary/90 text-white rounded-xl font-bold shadow-md transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background';
export const secondaryButtonClass =
  'py-2.5 px-5 rounded-xl font-bold border border-border text-on-surface hover:bg-background transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary';
export const linkButtonClass =
  'text-sm font-medium text-primary dark:text-primary-on-dark hover:underline focus:outline-none focus:ring-2 focus:ring-primary rounded disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline';
export const dangerButtonClass =
  'py-2.5 px-5 rounded-xl font-bold border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-red-500';
export const errorTextClass = 'mt-1 text-xs text-red-600 dark:text-red-400';
export const helpTextClass = 'mt-1 text-xs text-muted';
export const noticeClass = 'rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200';

/** Chave liga/desliga acessível (`role="switch"`). */
export const Switch: React.FC<{
  checked: boolean;
  onChange: (value: boolean) => void;
  labelledBy: string;
  describedBy?: string;
  disabled?: boolean;
  testId?: string;
}> = ({ checked, onChange, labelledBy, describedBy, disabled, testId }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-labelledby={labelledBy}
    aria-describedby={describedBy}
    disabled={disabled}
    data-testid={testId}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50 ${checked ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'}`}
  >
    <span
      aria-hidden="true"
      className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`}
    />
  </button>
);

const FOCUSABLE = 'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Diálogo com foco gerenciado, como o `ConfirmationModal` (D-18): o foco
 * vai para o título, Tab e Shift+Tab ficam presos, Escape fecha e, ao
 * fechar, o foco volta ao elemento de origem. O corpo rola por dentro, sem
 * rolagem horizontal da página.
 */
export const WorkTimeDialog: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  title: string;
  titleId: string;
  testId?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}> = ({ isOpen, onClose, title, titleId, testId, footer, children }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return undefined;
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    titleRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      const dialog = dialogRef.current;
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const outside = !dialog.contains(active);
      if (event.shiftKey && (outside || active === first || active === titleRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (outside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (origin?.isConnected) origin.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid={testId}
    >
      <div
        ref={dialogRef}
        className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-lg dark:bg-dark-100"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 p-4 dark:border-gray-700 sm:p-5">
          <h3 id={titleId} ref={titleRef} tabIndex={-1} className="text-lg font-bold text-gray-800 outline-none dark:text-white">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary dark:text-gray-400 dark:hover:text-gray-200"
            aria-label="Fechar"
          >
            <CloseIcon />
          </button>
        </div>
        {/* Corpo rolável alcançável pelo teclado mesmo sem controles dentro (setas e Page Down rolam). */}
        <div
          tabIndex={0}
          aria-labelledby={titleId}
          className="min-w-0 overflow-y-auto p-4 text-sm text-gray-700 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary dark:text-gray-200 sm:p-5"
        >
          {children}
        </div>
        {footer && <div className="flex flex-wrap justify-end gap-3 rounded-b-xl bg-gray-50 p-4 dark:bg-dark-200">{footer}</div>}
      </div>
    </div>
  );
};
