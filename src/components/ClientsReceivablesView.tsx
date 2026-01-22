
import React, { useState, useMemo } from 'react';
import { useClients, useCreateClient, useUpdateClient, useDeleteClient, useReceivables, useCreateReceivable, useUpdateReceivableStatus, useDeleteReceivable } from '../modules/clients/hooks.ts';
import { Client, Receivable } from '../modules/clients/types.ts';
import { UsersIcon, FileInvoiceIcon, PlusIcon, SearchIcon, EditIcon, DeleteIcon, CheckIcon, WarningIcon, CurrencyDollarIcon } from './Icons.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';
import ClientFormModal from './ClientFormModal.tsx';
import ReceivableFormModal from './ReceivableFormModal.tsx';

const ClientsReceivablesView: React.FC = () => {
    const { data: clients, isLoading: isClientsLoading } = useClients();
    const { data: receivables, isLoading: isReceivablesLoading } = useReceivables();
    
    // Mutations
    const createClient = useCreateClient();
    const updateClient = useUpdateClient();
    const deleteClient = useDeleteClient();
    
    const createReceivable = useCreateReceivable();
    const updateReceivable = useUpdateReceivableStatus();
    const deleteReceivable = useDeleteReceivable();

    const { playSound } = useTheme();

    const [activeTab, setActiveTab] = useState<'clients' | 'receivables'>('receivables');
    const [searchQuery, setSearchQuery] = useState('');
    
    // Modals
    const [isClientModalOpen, setIsClientModalOpen] = useState(false);
    const [clientToEdit, setClientToEdit] = useState<Client | null>(null);
    const [isReceivableModalOpen, setIsReceivableModalOpen] = useState(false);
    const [receivableToEdit, setReceivableToEdit] = useState<Receivable | null>(null);

    // -- Summary Logic --
    const summary = useMemo(() => {
        if (!receivables) return { totalReceivable: 0, totalOverdue: 0, nextDue: 0 };
        
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        
        let totalReceivable = 0;
        let totalOverdue = 0;
        let nextDue = 0;

        receivables.forEach(r => {
            if (r.status === 'recebido' || r.status === 'cancelado') return;
            
            totalReceivable += r.amount;
            
            if (r.dueDate < todayStr) {
                totalOverdue += r.amount;
            }
            
            // Check if due in next 7 days
            const dueDate = new Date(r.dueDate);
            const diffTime = dueDate.getTime() - now.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays >= 0 && diffDays <= 7) {
                nextDue += r.amount;
            }
        });

        return { totalReceivable, totalOverdue, nextDue };
    }, [receivables]);

    // -- Filter Logic --
    const filteredClients = useMemo(() => {
        if (!clients) return [];
        return clients.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.email?.toLowerCase().includes(searchQuery.toLowerCase()));
    }, [clients, searchQuery]);

    const filteredReceivables = useMemo(() => {
        if (!receivables) return [];
        return receivables.filter(r => r.description.toLowerCase().includes(searchQuery.toLowerCase())).sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
    }, [receivables, searchQuery]);

    // -- Handlers --
    const handleSaveClient = (data: any) => {
        if (clientToEdit) {
            updateClient.mutate({ ...clientToEdit, ...data });
        } else {
            createClient.mutate(data);
        }
        playSound('success');
    };

    const handleDeleteClient = (id: string) => {
        if (confirm('Tem certeza que deseja excluir este cliente?')) {
            deleteClient.mutate(id);
            playSound('success');
        }
    };

    const handleSaveReceivable = (data: any) => {
        if (receivableToEdit) {
            // Full update not implemented in this minimal version, just creating new for now in logic flow or separate update hook
            // For MVP: Assuming create/status update. To edit full fields we'd need useUpdateReceivable hook. 
            // Skipping full edit implementation to keep it simple, only status update is hooked.
            // Let's just create new for simplicity if "edit" implies creating similar? 
            // Actually, let's treat edit as create for now or just log warning. 
            console.warn("Edit receivable full fields not implemented in minimal version.");
        } else {
            createReceivable.mutate(data);
            playSound('success');
        }
    };

    const handleDeleteReceivable = (id: string) => {
        if (confirm('Excluir este recebível?')) {
            deleteReceivable.mutate(id);
            playSound('success');
        }
    };

    const handleStatusUpdate = (id: string, status: Receivable['status']) => {
        updateReceivable.mutate({ id, status });
        playSound('success');
    };

    const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
    const formatDate = (date: string) => new Date(date).toLocaleDateString('pt-BR');

    const getClientName = (id: string) => clients?.find(c => c.id === id)?.name || 'Cliente Removido';

    return (
        <div className="h-full flex flex-col animate-fade-in">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4 flex-shrink-0">
                <div>
                    <h2 className="text-2xl font-bold text-on-surface flex items-center gap-2">
                        <UsersIcon className="h-6 w-6 text-primary" />
                        Clientes & Recebíveis
                    </h2>
                    <p className="text-sm text-muted">Gestão de cobranças e carteira de clientes</p>
                </div>
                <div className="flex gap-2 w-full md:w-auto">
                    <div className="relative flex-1 md:w-64">
                        <input 
                            type="text" 
                            placeholder="Buscar..." 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 bg-surface border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary outline-none text-on-surface"
                        />
                        <SearchIcon className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
                    </div>
                    <button 
                        onClick={() => {
                            if (activeTab === 'clients') {
                                setClientToEdit(null);
                                setIsClientModalOpen(true);
                            } else {
                                setReceivableToEdit(null);
                                setIsReceivableModalOpen(true);
                            }
                        }}
                        className="bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 shadow-sm transition-colors whitespace-nowrap"
                    >
                        <PlusIcon className="w-4 h-4" />
                        {activeTab === 'clients' ? 'Novo Cliente' : 'Novo Recebível'}
                    </button>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 flex-shrink-0">
                <div className="bg-surface p-4 rounded-xl border border-border shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-blue-100 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 rounded-lg">
                        <FileInvoiceIcon className="w-6 h-6" />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-muted uppercase">Total a Receber</p>
                        <p className="text-xl font-bold text-on-surface">{formatCurrency(summary.totalReceivable)}</p>
                    </div>
                </div>
                <div className="bg-surface p-4 rounded-xl border border-border shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400 rounded-lg">
                        <WarningIcon className="w-6 h-6" />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-muted uppercase">Em Atraso</p>
                        <p className="text-xl font-bold text-red-600 dark:text-red-400">{formatCurrency(summary.totalOverdue)}</p>
                    </div>
                </div>
                <div className="bg-surface p-4 rounded-xl border border-border shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400 rounded-lg">
                        <CurrencyDollarIcon className="w-6 h-6" />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-muted uppercase">Próximos 7 Dias</p>
                        <p className="text-xl font-bold text-green-600 dark:text-green-400">{formatCurrency(summary.nextDue)}</p>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border mb-4 flex-shrink-0">
                <button 
                    onClick={() => setActiveTab('receivables')}
                    className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'receivables' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-on-surface'}`}
                >
                    <FileInvoiceIcon className="h-4 w-4" /> Recebíveis
                </button>
                <button 
                    onClick={() => setActiveTab('clients')}
                    className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'clients' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-on-surface'}`}
                >
                    <UsersIcon className="h-4 w-4" /> Clientes
                </button>
            </div>

            {/* Content List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar bg-surface border border-border rounded-xl shadow-sm">
                {activeTab === 'receivables' && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-background text-muted uppercase font-bold text-xs border-b border-border sticky top-0">
                                <tr>
                                    <th className="px-6 py-3">Descrição</th>
                                    <th className="px-6 py-3">Cliente</th>
                                    <th className="px-6 py-3">Vencimento</th>
                                    <th className="px-6 py-3 text-right">Valor</th>
                                    <th className="px-6 py-3 text-center">Status</th>
                                    <th className="px-6 py-3 text-right">Ações</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {isReceivablesLoading ? (
                                    <tr><td colSpan={6} className="p-8 text-center text-muted">Carregando...</td></tr>
                                ) : filteredReceivables.length === 0 ? (
                                    <tr><td colSpan={6} className="p-8 text-center text-muted">Nenhum recebível encontrado.</td></tr>
                                ) : (
                                    filteredReceivables.map(r => (
                                        <tr key={r.id} className="hover:bg-background/50 transition-colors group">
                                            <td className="px-6 py-3 font-medium text-on-surface">{r.description}</td>
                                            <td className="px-6 py-3 text-on-surface">{getClientName(r.clientId)}</td>
                                            <td className={`px-6 py-3 ${r.status !== 'recebido' && r.dueDate < new Date().toISOString().split('T')[0] ? 'text-red-500 font-medium' : 'text-muted'}`}>
                                                {formatDate(r.dueDate)}
                                            </td>
                                            <td className="px-6 py-3 text-right font-bold text-on-surface">{formatCurrency(r.amount)}</td>
                                            <td className="px-6 py-3 text-center">
                                                <span className={`px-2 py-1 rounded text-xs font-bold uppercase ${
                                                    r.status === 'recebido' ? 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-300' :
                                                    r.status === 'atrasado' ? 'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-300' :
                                                    r.status === 'cancelado' ? 'bg-gray-100 text-gray-600 dark:bg-gray-800' :
                                                    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300'
                                                }`}>
                                                    {r.status}
                                                </span>
                                            </td>
                                            <td className="px-6 py-3 text-right">
                                                <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    {r.status !== 'recebido' && (
                                                        <button onClick={() => handleStatusUpdate(r.id, 'recebido')} className="p-1.5 bg-green-50 text-green-600 hover:bg-green-100 rounded" title="Marcar Recebido">
                                                            <CheckIcon className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                    <button onClick={() => handleDeleteReceivable(r.id)} className="p-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded" title="Excluir">
                                                        <DeleteIcon className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                )}

                {activeTab === 'clients' && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-background text-muted uppercase font-bold text-xs border-b border-border sticky top-0">
                                <tr>
                                    <th className="px-6 py-3">Nome</th>
                                    <th className="px-6 py-3">Contato</th>
                                    <th className="px-6 py-3">Documento</th>
                                    <th className="px-6 py-3 text-right">Ações</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {isClientsLoading ? (
                                    <tr><td colSpan={4} className="p-8 text-center text-muted">Carregando...</td></tr>
                                ) : filteredClients.length === 0 ? (
                                    <tr><td colSpan={4} className="p-8 text-center text-muted">Nenhum cliente encontrado.</td></tr>
                                ) : (
                                    filteredClients.map(c => (
                                        <tr key={c.id} className="hover:bg-background/50 transition-colors group">
                                            <td className="px-6 py-3 font-medium text-on-surface">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                                                        {c.name.charAt(0).toUpperCase()}
                                                    </div>
                                                    {c.name}
                                                </div>
                                            </td>
                                            <td className="px-6 py-3 text-muted">
                                                <div className="flex flex-col">
                                                    <span>{c.email || '-'}</span>
                                                    <span className="text-xs opacity-70">{c.phone || ''}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-3 text-muted">{c.document || '-'}</td>
                                            <td className="px-6 py-3 text-right">
                                                <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button onClick={() => { setClientToEdit(c); setIsClientModalOpen(true); }} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded">
                                                        <EditIcon className="w-4 h-4" />
                                                    </button>
                                                    <button onClick={() => handleDeleteClient(c.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded">
                                                        <DeleteIcon className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <ClientFormModal 
                isOpen={isClientModalOpen}
                onClose={() => setIsClientModalOpen(false)}
                onSave={handleSaveClient}
                clientToEdit={clientToEdit}
            />

            <ReceivableFormModal 
                isOpen={isReceivableModalOpen}
                onClose={() => setIsReceivableModalOpen(false)}
                onSave={handleSaveReceivable}
                clients={clients || []}
            />
        </div>
    );
};

export default ClientsReceivablesView;
