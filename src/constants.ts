
import { Transaction, Category, EntityItem, CreditCard, Goal, SplitGroup, SplitBill, SplitParticipant, SplitShare, RecurringExpense } from './types.ts';

export const initialTransactions: Transaction[] = [
    { id: 9, type: 'parcelado', description: 'Notebook', category: 'Eletrônicos', value: 600, date: '2023-06-30', installments: 5, currentInstallment: 2, cardId: 1 },
    { id: 8, type: 'despesa', description: 'Celular', category: 'Comunicação', value: 60, date: '2023-06-29', cardId: 2, expenseType: 'Variável', paymentMethod: 'Cartão de Crédito', isPaid: true },
    { id: 7, type: 'despesa', description: 'Internet', category: 'Utilidades', value: 120, date: '2023-06-28', cardId: 1, expenseType: 'Fixa', paymentMethod: 'Boleto', isPaid: false },
    { id: 6, type: 'despesa', description: 'Conta de Luz', category: 'Utilidades', value: 180, date: '2023-06-28', expenseType: 'Fixa', paymentMethod: 'Pix', isPaid: true },
    { id: 5, type: 'investimento', description: 'Tesouro Direto', category: 'Tesouro Direto', value: 1000, date: '2023-06-25', goalId: 1, walletId: 2 }, // Ex: Linked to Goal ID 1 (Reserva)
    { id: 4, type: 'receita', description: 'Freelance', category: 'Honorários', value: 2850, date: '2023-06-20' },
    { id: 3, type: 'despesa', description: 'Supermercado', category: 'Alimentação', value: 450, date: '2023-06-15', cardId: 2, expenseType: 'Variável', paymentMethod: 'Cartão de Débito', isPaid: true },
    { id: 2, type: 'despesa', description: 'Aluguel', category: 'Moradia', value: 1200, date: '2023-06-10', expenseType: 'Fixa', paymentMethod: 'Transferência', isPaid: true },
    { id: 1, type: 'receita', description: 'Salário Mensal', category: 'Salário', value: 5000, date: '2023-06-05' },
];

// --- GOALS MOCK DATA ---
export const initialGoals: Goal[] = [
    {
        id: 1,
        name: 'Reserva de Emergência',
        description: '6 meses de custo de vida para segurança.',
        category: 'reserva_emergencia',
        status: 'em_andamento',
        priority: 'alta',
        targetAmount: 30000,
        currentAmount: 1000, // Derived from transaction ID 5
        startDate: '2023-01-01',
        deadline: '2024-12-31',
        horizon: 'curto',
        visual: {
            color: '#10b981', // Emerald
            icon: 'ShieldCheck',
            emoji: '🛡️',
            progressBarType: 'circular'
        },
        createdAt: '2023-01-01T10:00:00Z',
        updatedAt: '2023-06-25T14:00:00Z'
    },
    {
        id: 2,
        name: 'Viagem Europa 2026',
        description: 'Férias de 20 dias na Itália e França.',
        category: 'viagem',
        status: 'em_andamento',
        priority: 'media',
        targetAmount: 25000,
        currentAmount: 0,
        startDate: '2023-06-01',
        deadline: '2026-05-01',
        horizon: 'medio',
        visual: {
            color: '#3b82f6', // Blue
            icon: 'Plane',
            emoji: '✈️',
            progressBarType: 'linear'
        },
        createdAt: '2023-06-01T09:00:00Z',
        updatedAt: '2023-06-01T09:00:00Z'
    },
    {
        id: 3,
        name: 'Trocar Notebook',
        description: 'Macbook Pro para trabalho.',
        category: 'eletronicos',
        status: 'pausada',
        priority: 'baixa',
        targetAmount: 15000,
        currentAmount: 0,
        startDate: '2023-02-01',
        deadline: '2024-02-01',
        horizon: 'curto',
        visual: {
            color: '#8b5cf6', // Violet
            icon: 'DeviceLaptop',
            emoji: '💻',
            progressBarType: 'linear'
        },
        createdAt: '2023-02-01T10:00:00Z',
        updatedAt: '2023-05-10T11:00:00Z'
    }
];

// --- SHARED EXPENSES MOCK DATA (New Types) ---

export const initialSplitGroups: SplitGroup[] = [
    {
        id: '1',
        nome: 'Casa Dividida',
        tipo: 'fixo',
        descricao: 'Despesas de aluguel e mercado da república.',
        ativo: true,
        dataCriacao: '2023-01-15',
        corPrincipal: '#4f46e5',
        icone: 'Home',
    },
    {
        id: '2',
        nome: 'Viagem Cabo Frio',
        tipo: 'temporario',
        descricao: 'Gastos do feriado.',
        ativo: true,
        dataCriacao: '2023-04-10',
        corPrincipal: '#0ea5e9',
        icone: 'Plane',
    }
];

export const initialSplitParticipants: SplitParticipant[] = [
    // Grupo 1
    { id: '1', groupId: '1', nomeExibicao: 'Você', papel: 'dono', corIdentidade: '#4f46e5', avatarEmojiOpcional: '👤' },
    { id: '2', groupId: '1', nomeExibicao: 'Alice', papel: 'participante', corIdentidade: '#ec4899', avatarEmojiOpcional: '👩' },
    { id: '3', groupId: '1', nomeExibicao: 'Bruno', papel: 'participante', corIdentidade: '#eab308', avatarEmojiOpcional: '👨' },
    
    // Grupo 2
    { id: '4', groupId: '2', nomeExibicao: 'Você', papel: 'dono', corIdentidade: '#4f46e5', avatarEmojiOpcional: '👤' },
    { id: '5', groupId: '2', nomeExibicao: 'Carla', papel: 'participante', corIdentidade: '#f97316', avatarEmojiOpcional: '👩‍🦰' },
    { id: '6', groupId: '2', nomeExibicao: 'Daniel', papel: 'participante', corIdentidade: '#10b981', avatarEmojiOpcional: '🧔' },
    { id: '7', groupId: '2', nomeExibicao: 'Eduarda', papel: 'participante', corIdentidade: '#8b5cf6', avatarEmojiOpcional: '👩‍🦳' },
];

export const initialSplitBills: SplitBill[] = [
    { 
        id: '1', 
        groupId: '1', 
        descricao: 'Aluguel Junho', 
        tipoValor: 'fixo', 
        valorReal: 1500, 
        moeda: 'BRL',
        competencia: '2023-06',
        statusPagamento: 'pendente',
        formaPagamento: 'transferencia',
        categoriaNome: 'Moradia',
        pagadorPrincipalId: '1',
        createdAt: '2023-06-05'
    },
    { 
        id: '2', 
        groupId: '1', 
        descricao: 'Mercado Semanal', 
        tipoValor: 'variavel', 
        valorReal: 450, 
        moeda: 'BRL',
        competencia: '2023-06',
        statusPagamento: 'pago',
        formaPagamento: 'cartaoCredito',
        categoriaNome: 'Alimentação',
        pagadorPrincipalId: '2',
        createdAt: '2023-06-12'
    },
    { 
        id: '3', 
        groupId: '2', 
        descricao: 'Gasolina Ida', 
        tipoValor: 'variavel', 
        valorReal: 200, 
        moeda: 'BRL',
        competencia: '2023-04',
        statusPagamento: 'pago',
        formaPagamento: 'pix',
        categoriaNome: 'Transporte',
        pagadorPrincipalId: '4', // Você
        createdAt: '2023-04-10'
    },
    { 
        id: '4', 
        groupId: '2', 
        descricao: 'Jantar Sábado', 
        tipoValor: 'variavel', 
        valorReal: 320, 
        moeda: 'BRL',
        competencia: '2023-04',
        statusPagamento: 'parcialmentePago',
        formaPagamento: 'cartaoCredito',
        categoriaNome: 'Alimentação',
        pagadorPrincipalId: '5', // Carla
        createdAt: '2023-04-11'
    },
];

export const initialSplitShares: SplitShare[] = [
    // Aluguel Junho (1500) -> 500 cada (3 pessoas)
    { id: '1', billId: '1', participantId: '1', valorDevido: 500, valorPago: 500, status: 'pagoDireto' }, // Pagou pois é o principal
    { id: '2', billId: '1', participantId: '2', valorDevido: 500, valorPago: 0, status: 'aPagar' },
    { id: '3', billId: '1', participantId: '3', valorDevido: 500, valorPago: 0, status: 'aPagar' },

    // Mercado (450) -> 150 cada
    { id: '4', billId: '2', participantId: '1', valorDevido: 150, valorPago: 150, status: 'pagoAoPagadorPrincipal' },
    { id: '5', billId: '2', participantId: '2', valorDevido: 150, valorPago: 150, status: 'pagoDireto' }, // Pagador
    { id: '6', billId: '2', participantId: '3', valorDevido: 150, valorPago: 150, status: 'pagoAoPagadorPrincipal' },
    
    // Gasolina (200) -> 50 cada (4 pessoas)
    { id: '7', billId: '3', participantId: '4', valorDevido: 50, valorPago: 50, status: 'pagoDireto' },
    { id: '8', billId: '3', participantId: '5', valorDevido: 50, valorPago: 50, status: 'pagoAoPagadorPrincipal' },
    { id: '9', billId: '3', participantId: '6', valorDevido: 50, valorPago: 50, status: 'pagoAoPagadorPrincipal' },
    { id: '10', billId: '3', participantId: '7', valorDevido: 50, valorPago: 50, status: 'pagoAoPagadorPrincipal' },

    // Jantar (320) -> 80 cada (4 pessoas)
    { id: '11', billId: '4', participantId: '4', valorDevido: 80, valorPago: 0, status: 'aPagar' },
    { id: '12', billId: '4', participantId: '5', valorDevido: 80, valorPago: 80, status: 'pagoDireto' }, // Pagador
    { id: '13', billId: '4', participantId: '6', valorDevido: 80, valorPago: 80, status: 'pagoAoPagadorPrincipal' },
    { id: '14', billId: '4', participantId: '7', valorDevido: 80, valorPago: 0, status: 'aPagar' },
];

// --- RECURRING EXPENSES MOCK DATA (New Types) ---
export const initialRecurringExpenses: RecurringExpense[] = [
    {
        id: '1',
        nome: 'Netflix',
        tipo: 'assinatura',
        descricao: 'Plano 4K da família',
        valorPadrao: 55.90,
        moeda: 'BRL',
        periodo: 'mensal',
        diaCobranca: 15,
        dataInicio: '2023-01-01',
        metodoPagamento: 'cartaoCredito',
        cartaoIdOpcional: '1', // Nubank Gold ID as string
        usarCartaoAutomaticamente: true,
        gerarDespesaAutomaticamente: true,
        corPrincipal: '#E50914',
        icone: 'Movie',
        status: 'ativo',
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-06-20T00:00:00Z'
    },
    {
        id: '2',
        nome: 'Spotify Premium',
        tipo: 'assinatura',
        valorPadrao: 21.90,
        moeda: 'BRL',
        periodo: 'mensal',
        diaCobranca: 10,
        dataInicio: '2023-02-01',
        metodoPagamento: 'cartaoCredito',
        cartaoIdOpcional: '1',
        usarCartaoAutomaticamente: true,
        gerarDespesaAutomaticamente: true,
        corPrincipal: '#1DB954',
        icone: 'Music',
        status: 'ativo',
        createdAt: '2023-02-01T00:00:00Z'
    },
    {
        id: '3',
        nome: 'Aluguel',
        tipo: 'contaFixa',
        descricao: 'Apartamento Centro',
        valorPadrao: 1500.00,
        moeda: 'BRL',
        periodo: 'mensal',
        diaCobranca: 5,
        dataInicio: '2023-01-01',
        metodoPagamento: 'pix',
        splitGroupIdOpcional: '1', // Casa Dividida ID
        dividirAutomaticamenteNoGrupo: true,
        gerarDespesaAutomaticamente: false, // Requer aprovação manual
        corPrincipal: '#4f46e5',
        icone: 'Home',
        status: 'ativo',
        createdAt: '2023-01-01T00:00:00Z'
    },
    {
        id: '4',
        nome: 'Amazon Prime',
        tipo: 'assinatura',
        valorPadrao: 119.00,
        moeda: 'BRL',
        periodo: 'anual',
        diaCobranca: 15, // Março
        dataInicio: '2023-03-15',
        metodoPagamento: 'cartaoCredito',
        cartaoIdOpcional: '2', // Visa Platinum
        usarCartaoAutomaticamente: true,
        gerarDespesaAutomaticamente: true,
        corPrincipal: '#00A8E1',
        icone: 'ShoppingCart',
        status: 'ativo',
        createdAt: '2023-03-15T00:00:00Z'
    }
];

export const categories: Category = {
    receita: ['Salário', 'Honorários', 'Venda de Produto', 'Reembolso', 'Dividendos', 'Outros'],
    despesa: ['Alimentação', 'Moradia', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Utilidades', 'Comunicação', 'Outros'],
    investimento: ['Ações', 'Fundos Imobiliários', 'Tesouro Direto', 'CDB', 'Poupança', 'Outros'],
    parcelado: ['Eletrônicos', 'Eletrodomésticos', 'Móveis', 'Vestuário', 'Outros']
};

export const expenseTypesOptions = [
    'Fixa', 'Variável', 'Operacional', 'Pessoal', 'Recorrente', 'Emergencial'
];

export const paymentMethodsOptions = [
    'Dinheiro', 'Pix', 'Boleto', 'Cartão de Crédito', 'Cartão de Débito', 'Transferência'
];

export const transactionTypeColors = {
    receita: 'text-green-600 dark:text-green-400',
    despesa: 'text-red-600 dark:text-red-400',
    investimento: 'text-blue-600 dark:text-blue-400',
    parcelado: 'text-purple-600 dark:text-purple-400',
};

export const chartColors = {
    light: {
        receita: '#22c55e', // green-500
        despesa: '#ef4444', // red-500
        investimento: '#3b82f6', // blue-500
        parcelado: '#a855f7' // purple-500
    },
    dark: {
        receita: '#4ade80', // green-400
        despesa: '#f87171', // red-400
        investimento: '#60a5fa', // blue-400
        parcelado: '#c084fc' // purple-400
    }
}

// Initial Data for CRUD Settings with Icons
export const initialProductsServices: EntityItem[] = [
    { id: 1, name: 'Consultoria de TI', icon: 'DeviceDesktop', iconColor: '#4f46e5', iconStroke: 2 },
    { id: 2, name: 'Manutenção Elétrica', icon: 'Bolt', iconColor: '#eab308', iconStroke: 2 },
    { id: 3, name: 'Netflix', icon: 'Movie', iconColor: '#ef4444', iconStroke: 1.5 },
    { id: 4, name: 'Spotify', icon: 'Music', iconColor: '#22c55e', iconStroke: 2 },
];

export const initialExpenseTypes: EntityItem[] = [
    { id: 1, name: 'Fixa', icon: 'Lock', iconColor: '#64748b', iconStroke: 2 },
    { id: 2, name: 'Variável', icon: 'ChartArrows', iconColor: '#f97316', iconStroke: 2 },
    { id: 3, name: 'Emergencial', icon: 'AlertTriangle', iconColor: '#dc2626', iconStroke: 2.5 },
];

export const initialCategoriesSettings: EntityItem[] = [
    // Despesas
    { id: 1, name: 'Alimentação', icon: 'ShoppingCart', iconColor: '#ef4444', iconStroke: 2, type: 'despesa' },
    { id: 2, name: 'Moradia', icon: 'Home', iconColor: '#3b82f6', iconStroke: 2, type: 'despesa' },
    { id: 3, name: 'Transporte', icon: 'Car', iconColor: '#eab308', iconStroke: 2, type: 'despesa' },
    { id: 4, name: 'Saúde', icon: 'Heart', iconColor: '#ec4899', iconStroke: 2, type: 'despesa' },
    { id: 5, name: 'Lazer', icon: 'Confetti', iconColor: '#8b5cf6', iconStroke: 2, type: 'despesa' },
    { id: 6, name: 'Educação', icon: 'School', iconColor: '#0ea5e9', iconStroke: 2, type: 'despesa' },
    { id: 7, name: 'Utilidades', icon: 'Bulb', iconColor: '#f59e0b', iconStroke: 2, type: 'despesa' },
    
    // Receitas
    { id: 10, name: 'Salário', icon: 'Briefcase', iconColor: '#22c55e', iconStroke: 2, type: 'receita' },
    { id: 11, name: 'Honorários', icon: 'Certificate', iconColor: '#8b5cf6', iconStroke: 2, type: 'receita' },
    { id: 12, name: 'Venda de Produto', icon: 'Tag', iconColor: '#f97316', iconStroke: 2, type: 'receita' },
    { id: 13, name: 'Reembolso', icon: 'ReceiptRefund', iconColor: '#6366f1', iconStroke: 2, type: 'receita' },
    { id: 14, name: 'Dividendos', icon: 'ChartPie', iconColor: '#10b981', iconStroke: 2, type: 'receita' },
    
    // Investimentos
    { id: 20, name: 'Ações', icon: 'TrendingUp', iconColor: '#3b82f6', iconStroke: 2, type: 'investimento' },
    { id: 21, name: 'Fundos Imobiliários', icon: 'BuildingSkyscraper', iconColor: '#f59e0b', iconStroke: 2, type: 'investimento' },
    { id: 22, name: 'Tesouro Direto', icon: 'BuildingBank', iconColor: '#10b981', iconStroke: 2, type: 'investimento' },
    { id: 23, name: 'CDB', icon: 'Percentage', iconColor: '#8b5cf6', iconStroke: 2, type: 'investimento' },
    { id: 24, name: 'Poupança', icon: 'PigMoney', iconColor: '#ec4899', iconStroke: 2, type: 'investimento' },

    // Parcelado
    { id: 30, name: 'Eletrônicos', icon: 'DeviceMobile', iconColor: '#6366f1', iconStroke: 2, type: 'parcelado' },
    { id: 31, name: 'Eletrodomésticos', icon: 'ToolsKitchen', iconColor: '#ef4444', iconStroke: 2, type: 'parcelado' },
    { id: 32, name: 'Móveis', icon: 'Sofa', iconColor: '#eab308', iconStroke: 2, type: 'parcelado' },
    { id: 33, name: 'Vestuário', icon: 'Shirt', iconColor: '#ec4899', iconStroke: 2, type: 'parcelado' },
];

export const initialPaymentTypes: EntityItem[] = [
    { id: 1, name: 'Dinheiro', icon: 'Cash', iconColor: '#10b981', iconStroke: 2 },
    { id: 2, name: 'Cartão de Crédito', icon: 'CreditCard', iconColor: '#3b82f6', iconStroke: 2 },
    { id: 3, name: 'Cartão de Débito', icon: 'Id', iconColor: '#6366f1', iconStroke: 2 },
    { id: 4, name: 'Pix', icon: 'BrandPix', iconColor: '#14b8a6', iconStroke: 2 },
    { id: 5, name: 'Boleto', icon: 'Barcode', iconColor: '#475569', iconStroke: 2 },
];

export const initialIncomeTypes: EntityItem[] = [
    { id: 1, name: 'Salário Mensal', icon: 'Briefcase', iconColor: '#22c55e', iconStroke: 2 },
    { id: 2, name: 'Freelance', icon: 'DeviceLaptop', iconColor: '#8b5cf6', iconStroke: 2 },
    { id: 3, name: 'Dividendos', icon: 'ChartPie', iconColor: '#f59e0b', iconStroke: 2 },
    { id: 4, name: 'Venda de Bens', icon: 'Tag', iconColor: '#ef4444', iconStroke: 2 },
];

export const initialWallets: EntityItem[] = [
    { id: 1, name: 'Carteira Principal', icon: 'Wallet', iconColor: '#4f46e5', iconStroke: 2 },
    { id: 2, name: 'Reserva de Emergência', icon: 'ShieldCheck', iconColor: '#10b981', iconStroke: 2 },
    { id: 3, name: 'Investimentos Nubank', icon: 'BuildingBank', iconColor: '#8b5cf6', iconStroke: 2 },
    { id: 4, name: 'Binance', icon: 'CoinBitcoin', iconColor: '#f59e0b', iconStroke: 2 },
];

export const initialCreditCards: CreditCard[] = [
    {
        id: 1,
        name: 'Nubank Gold',
        brand: 'Mastercard',
        limitTotal: 5000,
        closingDay: 25,
        dueDay: 5,
        bestDay: 26,
        status: 'active',
        observations: 'Uso pessoal para compras menores.',
        visual: {
            bgType: 'color',
            bgColor: '#820ad1',
            textColor: 'white',
            showName: true,
            showBrand: true,
            showLogo: true
        }
    },
    {
        id: 2,
        name: 'Visa Platinum',
        brand: 'Visa',
        limitTotal: 15000,
        closingDay: 15,
        dueDay: 22,
        bestDay: 16,
        status: 'active',
        observations: 'Apenas para viagens e compras internacionais.',
        visual: {
            bgType: 'gradient',
            bgColor: '#1e3a8a',
            bgGradientColor: '#3b82f6',
            textColor: 'white',
            showName: true,
            showBrand: true,
            showLogo: true
        }
    },
    {
        id: 3,
        name: 'Black Card',
        brand: 'Mastercard',
        limitTotal: 50000,
        closingDay: 10,
        dueDay: 17,
        bestDay: 11,
        status: 'blocked',
        observations: 'Bloqueado temporariamente.',
        visual: {
            bgType: 'color',
            bgColor: '#111111',
            textColor: 'white',
            showName: true,
            showBrand: true,
            showLogo: true
        }
    }
];
