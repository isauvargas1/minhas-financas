import React, { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from './Icons.tsx';
import {
    aiDocumentTypeLabel,
    formatFileSize,
    type AiDocumentMimeType,
} from '../modules/ai/documentFile.ts';

/**
 * Confirmação de envio ao provedor de IA (P5-E1).
 *
 * Antes de qualquer conteúdo sair do navegador, a pessoa vê o que será
 * enviado, a quem e quanto custa, e confirma aquela operação. Não é
 * consentimento LGPD: é a confirmação de uma ação, por envio. Nenhuma caixa
 * vem pré-marcada; cancelar (botão, Fechar, Escape ou clique fora) não envia
 * nada.
 */
export type AiShareVariant =
    | { kind: 'analysis'; question: string; periodLabel: string }
    | { kind: 'document'; fileName: string; mimeType: AiDocumentMimeType; sizeBytes: number }
    | { kind: 'voice_start' }
    | { kind: 'voice_send'; transcript: string };

interface AiShareConsentDialogProps {
    variant: AiShareVariant | null;
    onCancel: () => void;
    onConfirm: () => void;
    /** Envio em curso: a confirmação fica desabilitada. */
    isBusy?: boolean;
    /** Elemento que recebe o foco ao fechar; sem ele, volta ao de origem. */
    returnFocus?: () => HTMLElement | null;
}

const FOCUSABLE = 'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

const TITLES: Record<AiShareVariant['kind'], string> = {
    analysis: 'Enviar pergunta ao assistente de IA',
    document: 'Enviar comprovante para leitura por IA',
    voice_start: 'Preencher por voz',
    voice_send: 'Enviar texto reconhecido à IA',
};

const CONFIRM_LABELS: Record<AiShareVariant['kind'], string> = {
    analysis: 'Enviar pergunta',
    document: 'Enviar comprovante',
    voice_start: 'Iniciar gravação',
    voice_send: 'Enviar texto',
};

/**
 * P5-E1.1: área que rola precisa ser alcançável pelo teclado (WCAG 2.1.1). Ela
 * só entra na ordem do Tab (`tabindex="0"`) enquanto o conteúdo passa da altura
 * visível, por exemplo no celular ou com uma pergunta longa; sem rolagem, nada
 * muda.
 */
const useFocusableWhenScrollable = <T extends HTMLElement>() => {
    const ref = useRef<T>(null);
    useLayoutEffect(() => {
        const node = ref.current;
        if (!node) return undefined;
        const update = () => {
            if (node.scrollHeight > node.clientHeight + 1) node.tabIndex = 0;
            else node.removeAttribute('tabindex');
        };
        update();
        if (typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(update);
        observer.observe(node);
        for (const child of Array.from(node.children)) observer.observe(child);
        return () => observer.disconnect();
    });
    return ref;
};

const QuotedText: React.FC<{ label: string; text: string }> = ({ label, text }) => {
    const quoteRef = useFocusableWhenScrollable<HTMLParagraphElement>();
    return (
        <div className="mb-4">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase">{label}</p>
            <p ref={quoteRef} className="whitespace-pre-wrap break-words max-h-32 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-dark-200 px-3 py-2 text-sm text-gray-800 dark:text-gray-200">
                {text}
            </p>
        </div>
    );
};

const Items: React.FC<{ items: string[] }> = ({ items }) => (
    <ul className="list-disc pl-5 space-y-2 text-sm text-gray-600 dark:text-gray-300 break-words">
        {items.map((item) => <li key={item}>{item}</li>)}
    </ul>
);

const renderBody = (variant: AiShareVariant): React.ReactNode => {
    switch (variant.kind) {
        case 'analysis':
            return (
                <>
                    <QuotedText label="Sua pergunta" text={variant.question} />
                    <Items items={[
                        `Para responder, o FênixGran envia ao Google (Gemini API), provedor de IA usado pelo FênixGran, o texto da sua pergunta e um resumo financeiro deste espaço de trabalho, preparado pelo sistema para o período: ${variant.periodLabel}.`,
                        'O resumo tem apenas valores agregados do período: saldos, entradas e saídas, receitas e despesas, indicadores, cartões, dívidas e valores a receber, movimentações de investimentos e, conforme sua permissão, o patrimônio investido, alertas, o tipo do espaço (pessoal ou empresa) e até 5 grupos de despesas identificados só pela posição (Grupo de despesas 1, 2…).',
                        'O resumo não inclui os nomes das categorias, nomes de clientes ou de cartões, descrições de lançamentos nem identificadores internos.',
                        'A pergunta que você digitou vai inteira e pode conter dados pessoais que você mesmo tenha escrito. Evite incluir dados pessoais desnecessários.',
                        'A resposta é gerada por IA, pode conter erros e não altera nenhum registro financeiro. Confira antes de tomar decisões.',
                        'Cada envio usa 1 crédito de IA do plano, mesmo que o serviço de IA falhe depois de aceitar o pedido.',
                    ]} />
                </>
            );
        case 'document':
            return (
                <>
                    <p className="mb-4 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-dark-200 px-3 py-2 text-sm font-medium text-gray-800 dark:text-gray-200 break-all">
                        {variant.fileName} · {aiDocumentTypeLabel(variant.mimeType)} · {formatFileSize(variant.sizeBytes)}
                    </p>
                    <Items items={[
                        'O arquivo inteiro será enviado ao Google (Gemini API), provedor de IA usado pelo FênixGran, apenas para sugerir os campos deste formulário. Envie somente o comprovante da operação.',
                        'O FênixGran não guarda o arquivo. A leitura pode conter erros: nada é salvo até você revisar e confirmar o lançamento.',
                        'Usa 1 crédito de IA do plano.',
                    ]} />
                </>
            );
        case 'voice_start':
            return (
                <Items items={[
                    'O reconhecimento de fala é feito pelo seu navegador. Dependendo do navegador, o áudio pode ser enviado ao serviço de reconhecimento de voz do fornecedor do navegador (por exemplo, o Google no Chrome), fora do controle do FênixGran.',
                    'Depois da gravação, você verá o texto reconhecido e decidirá se ele será enviado ao Google (Gemini API) para sugerir os campos.',
                    'A gravação não usa créditos; o envio do texto usa 1 crédito de IA do plano.',
                ]} />
            );
        case 'voice_send':
            return (
                <>
                    <QuotedText label="Texto reconhecido" text={variant.transcript} />
                    <Items items={[
                        'Este texto será enviado ao Google (Gemini API), provedor de IA usado pelo FênixGran, apenas para sugerir os campos deste formulário. A sugestão pode conter erros: nada é salvo até você revisar e confirmar o lançamento.',
                        'Usa 1 crédito de IA do plano.',
                    ]} />
                </>
            );
    }
};

const AiShareConsentDialog: React.FC<AiShareConsentDialogProps> = ({
    variant,
    onCancel,
    onConfirm,
    isBusy = false,
    returnFocus,
}) => {
    const titleId = useId();
    const bodyId = useId();
    const dialogRef = useRef<HTMLDivElement>(null);
    const bodyRef = useFocusableWhenScrollable<HTMLDivElement>();
    const cancelRef = useRef<HTMLButtonElement>(null);
    const onCancelRef = useRef(onCancel);
    onCancelRef.current = onCancel;
    const returnFocusRef = useRef(returnFocus);
    returnFocusRef.current = returnFocus;
    const isOpen = variant !== null;

    useEffect(() => {
        if (!isOpen) return undefined;
        const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        cancelRef.current?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                // Só este diálogo fecha; o formulário por trás segue aberto.
                event.preventDefault();
                event.stopPropagation();
                onCancelRef.current();
                return;
            }
            const dialog = dialogRef.current;
            if (event.key !== 'Tab' || !dialog) return;
            // O foco fica preso aqui: o ouvinte de Tab do formulário não age.
            event.stopPropagation();
            const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;
            const outside = !dialog.contains(active);
            if (event.shiftKey && (outside || active === first)) {
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
            const target = returnFocusRef.current?.() ?? (origin?.isConnected ? origin : null);
            target?.focus();
        };
    }, [isOpen]);

    if (!variant) return null;

    const handleConfirm = () => {
        if (isBusy) return;
        onConfirm();
    };

    // Portal: o diálogo não herda `transform` nem rolagem de quem o abriu. Os
    // cliques não sobem pela árvore React até a moldura do formulário.
    return createPortal(
        <div
            className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[70] p-4 transition-opacity"
            onClick={(event) => { event.stopPropagation(); onCancel(); }}
        >
            <div
                ref={dialogRef}
                role="dialog"
                data-testid="ai-share-dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={bodyId}
                className="bg-white dark:bg-dark-100 rounded-xl shadow-lg w-full max-w-md max-h-[90vh] flex flex-col"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex justify-between items-center gap-3 p-5 border-b border-gray-200 dark:border-gray-700">
                    <h3 id={titleId} className="text-lg font-bold text-gray-800 dark:text-white break-words min-w-0">{TITLES[variant.kind]}</h3>
                    <button type="button" onClick={onCancel} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex-shrink-0" aria-label="Fechar">
                        <CloseIcon />
                    </button>
                </div>

                <div id={bodyId} ref={bodyRef} className="p-6 overflow-y-auto min-h-0">
                    {renderBody(variant)}
                </div>

                <div className="flex flex-wrap justify-end items-center gap-3 p-4 bg-gray-50 dark:bg-dark-200 rounded-b-xl">
                    <button ref={cancelRef} type="button" onClick={onCancel} className="py-2 px-4 rounded-lg bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 font-medium transition-colors">
                        Cancelar
                    </button>
                    <button type="button" onClick={handleConfirm} disabled={isBusy} aria-busy={isBusy} className="py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium shadow-sm transition-colors">
                        {CONFIRM_LABELS[variant.kind]}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
};

export default AiShareConsentDialog;
