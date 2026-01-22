
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useFinanceAIChat } from '../modules/reports/hooks.ts';
import { FinancialReportSnapshot } from '../modules/reports/types.ts';
import { SparklesIcon, ArrowUpIcon, RefreshIcon, WarningIcon } from './Icons.tsx';
import { useWorkspace } from '../WorkspaceContext.tsx';

interface ReportsAIChatProps {
    snapshot: FinancialReportSnapshot;
}

const PF_QUESTIONS = [
    "Como está minha saúde financeira?",
    "Onde posso economizar este mês?",
    "Analise meu uso do cartão de crédito",
    "Estou gastando muito com supérfluos?",
    "Minhas metas estão em risco?"
];

const PJ_QUESTIONS = [
    "Minha empresa está lucrativa neste período?",
    "Quais custos mais pesam no meu negócio?",
    "Como melhorar meu fluxo de caixa?",
    "Meus clientes estão atrasando muito?",
    "Os gastos fixos da empresa estão saudáveis?",
    "Meu uso de cartão PJ é arriscado?",
    "Que estratégias posso usar para aumentar a margem de lucro?"
];

const TypingIndicator = () => (
    <div className="flex items-center gap-1 p-3 bg-surface border border-border rounded-2xl rounded-tl-none w-fit shadow-sm">
        <div className="w-1.5 h-1.5 bg-muted/60 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
        <div className="w-1.5 h-1.5 bg-muted/60 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
        <div className="w-1.5 h-1.5 bg-muted/60 rounded-full animate-bounce"></div>
    </div>
);

const ReportsAIChat: React.FC<ReportsAIChatProps> = ({ snapshot }) => {
    const { history, isLoading, isError, sendQuestion, clearHistory } = useFinanceAIChat();
    const { activeWorkspace } = useWorkspace();
    const [input, setInput] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const MotionDiv = motion.div as any;

    const suggestedQuestions = activeWorkspace.type === 'PJ' ? PJ_QUESTIONS : PF_QUESTIONS;

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [history, isLoading]);

    const handleSend = (text: string) => {
        if (!text.trim()) return;
        sendQuestion(text, snapshot);
        setInput('');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend(input);
        }
    };

    // Simple Markdown formatter
    const formatMessage = (text: string) => {
        return text.split('\n').map((line, i) => (
            <React.Fragment key={i}>
                {line.split(/(\*\*.*?\*\*)/g).map((part, j) => 
                    part.startsWith('**') && part.endsWith('**') ? (
                        <strong key={j} className="font-bold text-indigo-700 dark:text-indigo-300">{part.slice(2, -2)}</strong>
                    ) : (
                        part
                    )
                )}
                <br />
            </React.Fragment>
        ));
    };

    return (
        <div className="flex flex-col h-[600px] max-h-[75vh] bg-surface rounded-xl border border-border shadow-sm overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-border bg-background flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-md relative">
                        <SparklesIcon className="w-5 h-5" />
                        <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-white dark:border-dark-100 rounded-full"></span>
                    </div>
                    <div>
                        <h3 className="font-bold text-on-surface">Consultor IA {activeWorkspace.type === 'PJ' && 'Empresarial'}</h3>
                        <p className="text-xs text-muted">
                            Analisando: <span className="font-medium text-primary">{snapshot.periodLabel}</span>
                        </p>
                    </div>
                </div>
                {history.length > 0 && (
                    <button 
                        onClick={clearHistory}
                        className="text-xs text-muted hover:text-primary transition-colors flex items-center gap-1 px-2 py-1 rounded hover:bg-background/80 outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        title="Limpar conversa"
                    >
                        <RefreshIcon className="w-3 h-3" /> Limpar Histórico
                    </button>
                )}
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-gray-50/50 dark:bg-black/20 space-y-6">
                {history.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-60">
                        <div className="w-20 h-20 bg-indigo-50 dark:bg-indigo-900/10 rounded-full flex items-center justify-center mb-6">
                            <SparklesIcon className="w-10 h-10 text-indigo-300" />
                        </div>
                        <h4 className="text-lg font-medium text-on-surface mb-2">Como posso ajudar hoje?</h4>
                        <p className="text-sm text-muted max-w-xs leading-relaxed">
                            {activeWorkspace.type === 'PJ' 
                                ? 'Tenho acesso aos dados financeiros da sua empresa e posso ajudar com decisões de negócio, fluxo de caixa, custos e lucratividade.' 
                                : 'Tenho acesso aos seus relatórios atuais e posso responder dúvidas sobre seu orçamento e investimentos.'
                            }
                        </p>
                    </div>
                ) : (
                    <AnimatePresence initial={false}>
                        {history.map((msg) => (
                            <MotionDiv 
                                key={msg.id} 
                                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                transition={{ duration: 0.2 }}
                                className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                                <div 
                                    className={`max-w-[85%] rounded-2xl p-4 shadow-sm text-sm leading-relaxed relative group ${
                                        msg.type === 'user' 
                                            ? 'bg-primary text-white rounded-br-none ml-12' 
                                            : 'bg-surface dark:bg-dark-200 border border-border text-on-surface rounded-tl-none mr-12'
                                    }`}
                                >
                                    {msg.type === 'ai' ? formatMessage(msg.text) : msg.text}
                                    <div className={`text-[10px] mt-2 opacity-0 group-hover:opacity-70 transition-opacity text-right ${msg.type === 'user' ? 'text-white/80' : 'text-muted'}`}>
                                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                </div>
                            </MotionDiv>
                        ))}
                    </AnimatePresence>
                )}
                
                {isLoading && (
                    <MotionDiv 
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex justify-start"
                    >
                        <TypingIndicator />
                    </MotionDiv>
                )}
                
                {isError && (
                    <div className="flex justify-center my-4">
                        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 px-4 py-2 rounded-lg text-xs flex items-center gap-2 border border-red-100 dark:border-red-900/30">
                            <WarningIcon className="w-4 h-4" />
                            Erro de conexão. Tente novamente.
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-surface border-t border-border">
                {/* Suggestions */}
                {history.length === 0 && (
                    <div className="flex flex-wrap gap-2 mb-4 animate-fade-in">
                        {suggestedQuestions.map((q, idx) => (
                            <button
                                key={idx}
                                onClick={() => handleSend(q)}
                                className="text-xs bg-background border border-border hover:border-primary hover:text-primary text-muted px-3 py-1.5 rounded-full transition-all duration-200 hover:scale-105 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
                            >
                                {q}
                            </button>
                        ))}
                    </div>
                )}

                <div className="relative flex items-end gap-2">
                    <div className="relative flex-1">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={activeWorkspace.type === 'PJ' ? "Pergunte sobre estratégia, custos ou lucro..." : "Digite sua pergunta sobre suas finanças..."}
                            className="w-full bg-background border border-border rounded-xl px-4 py-3 pr-12 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all shadow-sm resize-none custom-scrollbar placeholder:text-muted/60"
                            rows={1}
                            style={{ minHeight: '48px', maxHeight: '120px' }}
                        />
                    </div>
                    <button
                        onClick={() => handleSend(input)}
                        disabled={!input.trim() || isLoading}
                        className="p-3 bg-primary hover:bg-primary/90 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white rounded-xl transition-all shadow-md hover:shadow-lg disabled:shadow-none active:scale-95 flex-shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary"
                        aria-label="Enviar mensagem"
                    >
                        <ArrowUpIcon className="w-5 h-5" />
                    </button>
                </div>
                <p className="text-[10px] text-center text-muted mt-3 opacity-70">
                    A IA pode cometer erros. Verifique os dados importantes nos gráficos.
                </p>
            </div>
        </div>
    );
};

export default ReportsAIChat;
