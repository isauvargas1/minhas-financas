import React, { useEffect, useId, useRef } from 'react';
import { CloseIcon, CoinsIcon, HandshakeIcon, WarningIcon } from '../Icons.tsx';

/**
 * Moldura dos diálogos de empréstimo (P3-H): `role="dialog"` com título,
 * foco inicial no título, Tab e Shift+Tab presos no diálogo, Escape e o X
 * fecham, e o foco volta para quem abriu. Enquanto `busy`, fechar não é
 * possível (a operação está no servidor).
 *
 * As variantes reproduzem, classe a classe, as molduras que as telas de
 * empréstimo já tinham (o frontend autenticado não muda de aparência):
 * `pf-form`/`pj-form` = contratação PF/PJ; `pf-action`/`pj-action` =
 * pagamento/recebimento PF/PJ; `confirm` = o `ConfirmationModal` que a
 * exclusão usava, agora com motivo obrigatório (estorno e cancelamento).
 */
const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
  'input:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

export type LoanDialogVariant = 'pf-form' | 'pj-form' | 'pf-action' | 'pj-action' | 'confirm';

interface Shell {
  panel: string;
  header: string;
  title: string;
  close: string;
  body: string;
  /** Rodapé fora do corpo (formulários e confirmação). */
  footer?: string;
  /** Botões dentro do corpo, como nos diálogos de movimento. */
  inlineFooter?: string;
}

const PJ_CLOSE = 'p-2 text-muted hover:text-on-surface transition-colors rounded-full hover:bg-background';

const SHELLS: Record<LoanDialogVariant, Shell> = {
  'pf-form': {
    panel: 'bg-surface rounded-xl shadow-lg w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden',
    header: 'flex justify-between items-center p-6 border-b border-border bg-background/50',
    title: 'text-xl font-bold text-on-surface',
    close: 'text-muted hover:text-on-surface',
    body: 'flex-1 overflow-y-auto p-6 custom-scrollbar',
    footer: 'p-6 border-t border-border flex justify-end gap-3 bg-background/50',
  },
  'pj-form': {
    panel: 'bg-surface rounded-2xl shadow-2xl w-full max-w-3xl max-h-[95vh] flex flex-col overflow-hidden',
    header: 'flex justify-between items-center p-6 border-b border-border bg-background/50',
    title: 'text-xl font-black text-on-surface tracking-tight',
    close: PJ_CLOSE,
    body: 'flex-1 overflow-y-auto p-8 custom-scrollbar',
    footer: 'p-6 border-t border-border flex justify-end gap-3 bg-background/50',
  },
  'pf-action': {
    panel: 'bg-surface rounded-xl shadow-lg w-full max-w-md animate-scale-in max-h-[90vh] flex flex-col overflow-hidden',
    header: 'flex justify-between items-center p-5 border-b border-border',
    title: 'text-lg font-bold text-on-surface flex items-center gap-2',
    close: 'text-muted hover:text-on-surface',
    body: 'overflow-y-auto p-6 custom-scrollbar',
    inlineFooter: 'mt-5 pt-4 flex justify-end gap-3',
  },
  'pj-action': {
    panel: 'bg-surface rounded-2xl shadow-2xl w-full max-w-lg animate-scale-in max-h-[90vh] flex flex-col overflow-hidden',
    header: 'flex justify-between items-center p-6 border-b border-border bg-background/50 rounded-t-2xl',
    title: 'text-lg font-black text-on-surface tracking-tight uppercase tracking-wider',
    close: PJ_CLOSE,
    body: 'overflow-y-auto p-8 custom-scrollbar',
    inlineFooter: 'mt-6 pt-4 flex justify-end gap-3',
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

export interface LoanDialogStyles {
  label: string;
  input: string;
  /** Espaçamento vertical do conteúdo do formulário. */
  stack: string;
  primary: string;
  secondary: string;
  danger: string;
}

const DISABLED = ' disabled:opacity-60 disabled:cursor-not-allowed';
const PF_INPUT = 'w-full border border-border rounded-lg px-4 py-2 bg-background text-on-surface outline-none focus:ring-2 focus:ring-primary text-sm';
const PF_LABEL = 'block text-[10px] font-bold text-muted uppercase tracking-wider mb-1';
const PJ_LABEL = 'block text-[10px] font-black text-muted uppercase tracking-widest mb-1.5';

const STYLES: Record<LoanDialogVariant, LoanDialogStyles> = {
  'pf-form': {
    label: PF_LABEL,
    input: PF_INPUT,
    stack: 'space-y-6',
    primary: `px-8 py-2 bg-primary text-white rounded-lg font-bold shadow-md hover:bg-primary/90 transition-all active:scale-95${DISABLED}`,
    secondary: `px-5 py-2 bg-background border border-border text-on-surface rounded-lg hover:bg-surface transition-colors font-medium${DISABLED}`,
    danger: `px-8 py-2 bg-red-700 text-white rounded-lg font-bold shadow-md hover:bg-red-800 transition-all${DISABLED}`,
  },
  'pj-form': {
    label: PJ_LABEL,
    input: `${PF_INPUT} transition-all`,
    stack: 'space-y-8',
    primary: `px-10 py-2.5 bg-primary text-white rounded-xl font-black shadow-lg hover:bg-primary/90 transition-all active:scale-95 text-sm uppercase tracking-wider${DISABLED}`,
    secondary: `px-6 py-2.5 bg-background border border-border text-on-surface rounded-xl hover:bg-surface transition-all font-bold text-sm${DISABLED}`,
    danger: `px-10 py-2.5 bg-red-700 text-white rounded-xl font-black shadow-lg hover:bg-red-800 transition-all text-sm uppercase tracking-wider${DISABLED}`,
  },
  'pf-action': {
    label: PF_LABEL,
    input: PF_INPUT,
    stack: 'space-y-5',
    primary: `px-6 py-2 bg-primary text-white rounded-lg font-bold shadow-md hover:bg-primary/90 transition-all active:scale-95${DISABLED}`,
    secondary: `px-4 py-2 bg-background border border-border text-on-surface rounded-lg font-medium${DISABLED}`,
    danger: `px-6 py-2 bg-red-700 text-white rounded-lg font-bold shadow-md hover:bg-red-800 transition-all${DISABLED}`,
  },
  'pj-action': {
    label: PJ_LABEL,
    input: `${PF_INPUT} transition-all`,
    stack: 'space-y-6',
    primary: `px-10 py-2.5 bg-primary text-white rounded-xl font-black shadow-lg hover:bg-primary/90 transition-all active:scale-95 text-sm uppercase tracking-wider${DISABLED}`,
    secondary: `px-6 py-2.5 bg-background border border-border text-on-surface rounded-xl font-bold text-sm shadow-sm transition-all${DISABLED}`,
    danger: `px-10 py-2.5 bg-red-700 text-white rounded-xl font-black shadow-lg hover:bg-red-800 transition-all text-sm uppercase tracking-wider${DISABLED}`,
  },
  confirm: {
    label: 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1',
    input: 'w-full border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-dark-200 text-gray-800 dark:text-gray-200 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-red-500',
    stack: 'space-y-0',
    primary: `py-2 px-4 rounded-lg bg-primary hover:bg-primary/90 text-white font-medium shadow-sm transition-colors${DISABLED}`,
    secondary: 'py-2 px-4 rounded-lg bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 font-medium transition-colors disabled:opacity-60',
    danger: `py-2 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium shadow-sm transition-colors${DISABLED}`,
  },
};

export const loanDialogStyles = (variant: LoanDialogVariant): LoanDialogStyles => STYLES[variant];

/** Diálogo de ação no visual do perfil do espaço. */
export const actionVariantOf = (profileType: 'PF' | 'PJ'): LoanDialogVariant =>
  profileType === 'PJ' ? 'pj-action' : 'pf-action';

interface LoanDialogProps {
  open: boolean;
  title: string;
  /** Linha abaixo do título (só `pj-form`, como no registro PJ). */
  subtitle?: string;
  variant?: LoanDialogVariant;
  onClose: () => void;
  busy?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

const LoanDialog: React.FC<LoanDialogProps> = ({
  open, title, subtitle, variant = 'pf-action', onClose, busy = false, children, footer,
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

  const heading = (
    <h3 id={titleId} ref={titleRef} tabIndex={-1} className={`${shell.title} outline-none`}>
      {variant === 'pf-action' && <CoinsIcon className="w-5 h-5 text-primary" />}
      {title}
    </h3>
  );

  let titleBlock: React.ReactNode = heading;
  if (variant === 'pf-form') {
    titleBlock = (
      <div className="flex items-center gap-3">
        <HandshakeIcon className="w-6 h-6 text-primary" />
        {heading}
      </div>
    );
  } else if (variant === 'pj-form') {
    titleBlock = (
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-primary/10 rounded-xl text-primary shadow-inner">
          <HandshakeIcon className="w-6 h-6" />
        </div>
        <div>
          {heading}
          {subtitle && <p className="text-[10px] text-muted uppercase font-bold tracking-wider">{subtitle}</p>}
        </div>
      </div>
    );
  } else if (variant === 'pj-action') {
    titleBlock = (
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg text-primary shadow-inner">
          <CoinsIcon className="w-5 h-5" />
        </div>
        {heading}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4 animate-fade-in"
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
          {titleBlock}
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
          {footer && shell.inlineFooter && <div className={shell.inlineFooter}>{footer}</div>}
        </div>
        {footer && shell.footer && <div className={shell.footer}>{footer}</div>}
      </div>
    </div>
  );
};

export default LoanDialog;

/** Erro da última tentativa, anunciado (pt-BR, já traduzido). */
export const LoanFormError: React.FC<{ message: string | null; variant?: LoanDialogVariant }> = ({ message, variant }) => {
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

/** Campo de valor com o prefixo "R$" dentro, como nos formulários da base. */
export const LoanMoneyInput: React.FC<React.InputHTMLAttributes<HTMLInputElement> & {
  inputClass: string;
  prefixClass?: string;
}> = ({ inputClass, prefixClass = 'absolute left-3.5 top-2 text-muted font-bold text-sm', className, ...props }) => (
  <div className="relative">
    <span className={prefixClass} aria-hidden="true">R$</span>
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      placeholder="0,00"
      {...props}
      className={`${inputClass} pl-10 ${className ?? ''}`}
    />
  </div>
);
