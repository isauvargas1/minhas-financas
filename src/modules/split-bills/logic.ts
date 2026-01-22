
/**
 * Lógica pura para cálculos de divisão de contas.
 * Isolada para facilitar testes unitários e reutilização.
 */

export type SplitMethod = 'igual' | 'porcentagem' | 'valor_fixo';

interface CalculateSharesParams {
    total: number;
    method: SplitMethod;
    participantIds: string[]; // IDs dos participantes selecionados para divisão
    manualInputs: Record<string, string>; // Inputs do usuário (valor ou %)
}

/**
 * Calcula o valor devido por cada participante com base no método escolhido.
 */
export const calculateSplitShares = ({
    total,
    method,
    participantIds,
    manualInputs
}: CalculateSharesParams): Record<string, number> => {
    const count = participantIds.length;
    
    // Casos base inválidos
    if (count === 0) return {};
    if (total === 0) return {};

    const result: Record<string, number> = {};

    if (method === 'igual') {
        // Divisão Simples
        const splitValue = total / count;
        participantIds.forEach(id => {
            result[id] = splitValue;
        });
    } 
    else if (method === 'valor_fixo') {
        // Valores explícitos definidos pelo usuário
        participantIds.forEach(id => {
            const val = parseFloat(manualInputs[id]);
            result[id] = isNaN(val) ? 0 : val;
        });
    } 
    else if (method === 'porcentagem') {
        // Porcentagem do total
        participantIds.forEach(id => {
            const pct = parseFloat(manualInputs[id]);
            const validPct = isNaN(pct) ? 0 : pct;
            result[id] = (total * validPct) / 100;
        });
    }

    return result;
};

/**
 * Valida se a soma das partes corresponde ao total.
 * Retorna a diferença (pode ser positiva ou negativa).
 */
export const validateSplitTotal = (total: number, shares: Record<string, number>): number => {
    const sum = Object.values(shares).reduce((acc, curr) => acc + curr, 0);
    // Arredondar para evitar erros de ponto flutuante minúsculos
    const diff = total - sum;
    return parseFloat(diff.toFixed(2));
};

/**
 * Gera as parcelas para integração com Cartão de Crédito
 */
export const calculateInstallments = (
    totalValue: number, 
    installmentsCount: number
): { installmentValue: number, remainder: number } => {
    if (installmentsCount <= 0) return { installmentValue: totalValue, remainder: 0 };
    
    const installmentValue = parseFloat((totalValue / installmentsCount).toFixed(2));
    const totalCalculated = installmentValue * installmentsCount;
    const remainder = parseFloat((totalValue - totalCalculated).toFixed(2));

    return { installmentValue, remainder };
};
