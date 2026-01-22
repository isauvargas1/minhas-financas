
export type RecurringExpenseType =
  | 'assinatura'   // Netflix, Spotify, etc.
  | 'contaFixa'    // aluguel, condomínio
  | 'servico'      // academia, personal, etc.
  | 'outro';

export type RecurringBillingPeriod =
  | 'semanal'
  | 'quinzenal'
  | 'mensal'
  | 'bimestral'
  | 'trimestral'
  | 'semestral'
  | 'anual';

export type RecurringPaymentMethod =
  | 'cartaoCredito'
  | 'debitoConta'
  | 'boleto'
  | 'pix'
  | 'dinheiro'
  | 'outro';

export type RecurringStatus =
  | 'ativo'
  | 'pausado'
  | 'cancelado';

export interface RecurringAdjustment {
    id: string;
    date: string;
    oldValue: number;
    newValue: number;
    note?: string;
}

export interface RecurringExpense {
  id: string;
  nome: string;                  // Netflix, Academia, Conta de Luz etc.
  tipo: RecurringExpenseType;
  descricao?: string;

  valorPadrao: number;           // valor previsto recorrente
  adjustments?: RecurringAdjustment[]; // Histórico de reajustes

  moeda: 'BRL';                  // deixe preparado para expansão futura
  periodo: RecurringBillingPeriod;
  diaCobranca: number;           // ex.: dia 5 de cada mês
  dataInicio: string;            // ISO
  dataFim?: string;              // se tiver data para terminar

  metodoPagamento: RecurringPaymentMethod;

  // Integração com cartão de crédito
  cartaoIdOpcional?: string;         // id do cartão cadastrado
  usarCartaoAutomaticamente?: boolean; // se true, gera compra recorrente no cartão

  // Integração com despesas
  categoriaDespesaId?: string;
  ultimaDespesaGeradaId?: string;    // id da última despesa no módulo de gastos
  gerarDespesaAutomaticamente: boolean;

  // Integração com divisão de contas
  splitGroupIdOpcional?: string;     // id de um grupo de divisão de contas
  dividirAutomaticamenteNoGrupo?: boolean;

  // Personalização visual
  corPrincipal: string;
  icone: string;                     // nome no sistema de ícones
  emojiOpcional?: string;

  status: RecurringStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface RecurringOccurrence {
  id: string;
  recurringExpenseId: string;
  competencia: string;         // ex.: '2025-03'
  dataPrevista: string;
  valorPrevisto: number;
  valorReal?: number;
  despesaId?: string;          // despesa efetiva no módulo de gastos
  cartaoCompraId?: string;     // se pago com cartão
  splitBillId?: string;        // se foi dividido em grupo
  status: 'pendente' | 'gerado' | 'pago' | 'ignorado';
  createdAt?: string;
  updatedAt?: string;
}
