
import { RecurringExpense, RecurringOccurrence, RecurringBillingPeriod } from './types.ts';

export const addPeriod = (date: Date, period: RecurringBillingPeriod, count: number = 1): Date => {
    const newDate = new Date(date);
    switch (period) {
        case 'semanal':
            newDate.setDate(newDate.getDate() + (7 * count));
            break;
        case 'quinzenal':
            newDate.setDate(newDate.getDate() + (15 * count));
            break;
        case 'mensal':
            newDate.setMonth(newDate.getMonth() + count);
            break;
        case 'bimestral':
            newDate.setMonth(newDate.getMonth() + (2 * count));
            break;
        case 'trimestral':
            newDate.setMonth(newDate.getMonth() + (3 * count));
            break;
        case 'semestral':
            newDate.setMonth(newDate.getMonth() + (6 * count));
            break;
        case 'anual':
            newDate.setFullYear(newDate.getFullYear() + count);
            break;
    }
    return newDate;
};

/**
 * Gera ocorrências projetadas para uma despesa dentro de um intervalo de datas.
 * Não salva no banco, apenas calcula matematicamente.
 */
export const projectOccurrences = (
    expense: RecurringExpense,
    startRange: Date,
    endRange: Date
): RecurringOccurrence[] => {
    const occurrences: RecurringOccurrence[] = [];
    
    // Data inicial de cálculo (data de início do contrato/assinatura)
    // Precisamos ajustar o horário para evitar problemas de fuso na comparação simples
    let currentDate = new Date(expense.dataInicio + 'T00:00:00');
    
    // Se a despesa tem um dia de cobrança fixo e é mensal/anual, tentamos respeitar esse dia
    if (expense.diaCobranca && ['mensal', 'bimestral', 'trimestral', 'semestral', 'anual'].includes(expense.periodo)) {
        // Ajusta o dia da data de início para o dia de cobrança, se possível
        // Cuidado com meses que não têm dia 31, etc. O JS ajusta automaticamente para o próximo mês, 
        // então precisamos ser cuidadosos. Para simplificar neste mock, assumimos o ajuste automático do Date.
        const originalMonth = currentDate.getMonth();
        currentDate.setDate(expense.diaCobranca);
        // Se mudou de mês (ex: 31 de Fev vira Março), volta para o último dia do mês correto? 
        // Lógica simplificada: O JS cuida do overflow.
    }

    // Avança até o início do range ou data atual, para não gerar histórico infinito desnecessário
    // Otimização: Se dataInicio for muito antiga, pular iterações até perto de startRange
    
    // Loop de geração
    while (currentDate <= endRange) {
        // Verifica data fim do contrato
        if (expense.dataFim && currentDate > new Date(expense.dataFim + 'T23:59:59')) {
            break;
        }

        // Se estiver dentro da janela de visualização, adiciona
        if (currentDate >= startRange) {
            const competencia = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
            
            occurrences.push({
                id: `occ_${expense.id}_${competencia}`, // ID virtual determinístico
                recurringExpenseId: expense.id,
                competencia,
                dataPrevista: currentDate.toISOString().split('T')[0],
                valorPrevisto: expense.valorPadrao,
                status: 'pendente', // Status padrão projetado
            });
        }

        // Próxima data
        currentDate = addPeriod(currentDate, expense.periodo);
    }

    return occurrences;
};
