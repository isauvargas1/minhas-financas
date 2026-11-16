/**
 * Textos em pt-BR do tempo de trabalho equivalente (P5-F.1). Módulo PURO:
 * sem React, sem Firebase, imports com extensão `.ts`.
 */
import type { EstimateNote, EstimateUnavailableReason, WorkTimeEstimate } from './estimate.ts';
import type { IncomeItemView, IncomeKind } from './incomeBasis.ts';

/** Etapa A do assistente: texto pedido para a apresentação. */
export const WORK_TIME_INTRO =
  'O FênixGran pode mostrar aproximadamente quantas horas de trabalho correspondem aos valores das suas receitas e despesas. Usaremos suas receitas registradas e sua jornada habitual para calcular essa estimativa.';

export const WORK_TIME_INTRO_POINTS: readonly string[] = [
  'O cálculo é aproximado.',
  'Os valores em reais nunca mudam: lançamentos, saldos e relatórios continuam como estão.',
  'Você pode desligar o recurso quando quiser.',
  'Todas as configurações podem ser alteradas depois, em Configurações.',
  'Seus dados pessoais não são compartilhados com outros usuários, nem com quem participa dos seus espaços.',
];

/** Aviso da memória de cálculo (texto pedido). */
export const ESTIMATE_DISCLAIMER =
  'Este valor é uma estimativa baseada nas receitas registradas e na jornada de trabalho configurada. Ele pode variar conforme sua renda, férias, feriados, horas extras e outras alterações na rotina. Não representa necessariamente seu salário líquido nem o custo real do seu trabalho.';

/** Aviso exigido antes de usar a receita de um workspace PJ. */
export const BUSINESS_INCOME_WARNING =
  'Faturamento de empresa (PJ) não é necessariamente renda pessoal: o valor bruto pode incluir custos, impostos e o que fica na empresa. Use essa fonte só se ela representar a sua remuneração. A estimativa passa a ser identificada como baseada em receita empresarial.';

export const UNAVAILABLE_REASON_TEXT: Record<EstimateUnavailableReason, string> = {
  business_not_confirmed: 'A fonte escolhida é um espaço PJ. Confirme que quer usar a receita empresarial, ou escolha um espaço PF.',
  report_unavailable: 'O relatório oficial deste espaço ainda não está disponível para os meses do cálculo. Tente de novo em instantes.',
  exclusion_unconfirmed: 'Não foi possível confirmar se um recebimento que você desconsiderou foi estornado. Para não descontar um valor que o estorno já anulou, a estimativa fica suspensa. Tente de novo em instantes.',
  no_income: 'Não há receitas efetivadas nos meses considerados. Assim que houver, a estimativa aparece.',
  no_work_minutes: 'A jornada configurada não tem horas nos meses considerados. Revise a rotina e as exceções.',
  ambiguous_routines: 'Em algum dia do período, rotinas se cruzam e há intervalo no trecho em comum: não dá para saber onde cai a pausa, e as horas não podem ser calculadas com segurança. Ajuste as rotinas, os feriados ou as exceções em Configurações.',
  ambiguous_reduced_eve: 'Em algum dia do período, o dia anterior tem jornada reduzida num horário que passa da meia-noite, e não dá para confirmar que parte dele foi trabalhada: as horas desse dia não podem ser calculadas com segurança. Ajuste as exceções ou as rotinas em Configurações.',
  income_too_low: 'A renda do período é menor que R$ 1,00, pouco para uma estimativa.',
  income_too_high: 'A renda do período passa do limite seguro da estimativa.',
  work_minutes_too_high: 'As horas do período passam do limite da estimativa. Revise a rotina.',
  hourly_rate_too_low: 'Com essa renda e essas horas, a hora valeria menos de R$ 0,01.',
};

const formatMonth = (month: string): string => `${month.slice(5, 7)}/${month.slice(0, 4)}`;
const formatDate = (date: string): string => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

/** Aviso de uma nota da estimativa. */
export const estimateNoteText = (note: EstimateNote): string => {
  switch (note.kind) {
    case 'provisional':
      return `Estimativa provisória: há receitas em ${note.monthsUsed} ${note.monthsUsed === 1 ? 'mês' : 'meses'} dos ${note.monthsRequested} pedidos.`;
    case 'current_month_incomplete':
      return `O mês atual ainda não terminou: entram só as receitas efetivadas até ${formatDate(note.throughDate)}, e a estimativa pode mudar até o fim do mês.`;
    case 'business_income':
      return 'Estimativa baseada em receita empresarial (PJ), por escolha sua.';
    case 'exclusions_skipped':
      return `As receitas que você desconsiderou não foram descontadas em ${note.months.map(formatMonth).join(', ')}: o relatório oficial ${note.months.length === 1 ? 'desse mês' : 'desses meses'} ainda não as inclui. Vale o total oficial.`;
    case 'exclusions_ignored':
      return `${note.count} ${note.count === 1 ? 'receita desconsiderada está' : 'receitas desconsideradas estão'} fora do período ou não ${note.count === 1 ? 'soma' : 'somam'} renda, e não ${note.count === 1 ? 'muda' : 'mudam'} esta estimativa.`;
    case 'exclusions_reversed':
      return `${note.count} ${note.count === 1 ? 'recebimento desconsiderado foi estornado' : 'recebimentos desconsiderados foram estornados'}: o estorno já anula o valor no mês, e a exclusão não muda esta estimativa.`;
    case 'holiday_base_not_covered':
      return `A base de feriados nacionais começa em 2003; em ${note.months.map(formatMonth).join(', ')} nenhum feriado entrou automaticamente.`;
    case 'untimed_overlap':
      return `Em ${note.days} ${note.days === 1 ? 'dia' : 'dias'}, duas rotinas sem horário somaram horas. Se elas se sobrepõem, informe o horário de início e fim.`;
    case 'capped_days':
      return `Em ${note.days} ${note.days === 1 ? 'dia' : 'dias'}, as horas sem horário definido passariam do tempo livre do dia e foram limitadas a ele.`;
  }
};

/**
 * Mensagem da falha da estimativa, sempre em pt-BR. O relatório oficial já falha com texto seguro
 * (`fetchFinancialReport` passa todo erro por `reportErrorMessage`); a leitura dos lançamentos
 * desconsiderados falha com o texto do SDK, que nunca vai para a tela.
 */
export const ESTIMATE_REPORT_READ_FAILED = 'Não foi possível ler as receitas agora. Tente de novo.';
export const ESTIMATE_EXCLUDED_READ_FAILED = 'Não foi possível conferir as receitas desconsideradas agora. Tente de novo.';
/** A última releitura falhou, mas há uma leitura anterior: a estimativa continua com ela. */
export const ESTIMATE_REFRESH_FAILED = 'Não foi possível atualizar a estimativa com os lançamentos mais recentes agora. Ela usa a última leitura.';
/**
 * A estimativa não pode ser confirmada com os totais oficiais (P5-F.1-R1, B03): a escuta das projeções
 * mensais está encerrada. Nenhuma estimativa anterior é mostrada no lugar (P5-F.1-R3.1).
 */
export const ESTIMATE_UNCONFIRMED_FAILED = 'Não foi possível confirmar a estimativa com os totais oficiais. Tente de novo.';
/**
 * P5-F.1-R3 (B03): a estimativa ainda não foi provada consistente com os totais oficiais, depois do tempo de
 * interface. Vale para qualquer motivo da prova (projeção, bases, marcas das receitas desconsideradas), então o
 * texto não aponta causa. Não é falha nem aprovação: os valores ficam em reais até a prova.
 */
export const ESTIMATE_UPDATING = 'A estimativa está em atualização: ainda não foi possível confirmá-la com os totais oficiais. Enquanto isso, os valores ficam em reais.';

export const estimateFailureMessage = (source: 'report' | 'excluded', error: unknown): string => {
  if (source === 'excluded') return ESTIMATE_EXCLUDED_READ_FAILED;
  return error instanceof Error && error.message.trim() !== '' ? error.message : ESTIMATE_REPORT_READ_FAILED;
};

/** Ressalvas do aviso do topo no modo tempo: mês incompleto, poucos meses de renda ou fonte PJ. */
export const ESTIMATE_QUALIFIER_CURRENT_MONTH = 'Base: o mês atual, ainda incompleto; a renda pode variar até o fim do mês.';
export const ESTIMATE_QUALIFIER_PROVISIONAL = 'Estimativa provisória: há menos meses de renda que o período escolhido.';
export const ESTIMATE_QUALIFIER_BUSINESS = 'Renda de um espaço empresarial (PJ), por escolha sua.';
export const ESTIMATE_QUALIFIER_STALE = 'Não foi possível atualizar a estimativa com os lançamentos mais recentes: ela usa a leitura anterior. Tente de novo em Configurações.';
export const estimateQualifiers = (
  estimate: Pick<Extract<WorkTimeEstimate, { status: 'ready' }>, 'mode' | 'provisional' | 'workspaceType'>,
  refreshFailed = false,
): string[] => [
  estimate.mode === 'current_month'
    ? ESTIMATE_QUALIFIER_CURRENT_MONTH
    : estimate.provisional ? ESTIMATE_QUALIFIER_PROVISIONAL : null,
  estimate.workspaceType === 'PJ' ? ESTIMATE_QUALIFIER_BUSINESS : null,
  refreshFailed ? ESTIMATE_QUALIFIER_STALE : null,
].filter((text): text is string => text !== null);

/**
 * Memória de cálculo de uma estimativa que parou antes de calcular os meses (RR-R32-11, P5-GATE-FINAL): a indisponível
 * por um motivo decidido antes das receitas, ou por rotinas ambíguas, não tem meses calculados. Ela não aplicou
 * desconsideradas, feriados nem exceções, e dizer "nenhuma" seria falso quando a pessoa tem alguma.
 */
export const calculationReachedMonths = (estimate: Pick<WorkTimeEstimate, 'months'>): boolean => estimate.months.length > 0;
export const DETAILS_EXCLUSIONS_NOT_APPLIED =
  'As receitas desconsideradas não foram aplicadas: a estimativa parou antes de calcular os meses.';
export const DETAILS_CALENDAR_NOT_APPLIED =
  'Feriados, férias, folgas e exceções não foram aplicados: a estimativa parou antes de calcular os meses.';

/** Limitações que valem sempre (memória de cálculo). */
export const STANDING_LIMITATIONS: readonly string[] = [
  'Feriados nacionais vêm das leis federais (Lei nº 662/1949 com a redação da Lei nº 10.607/2002, Lei nº 6.802/1980 e Lei nº 14.759/2023). Feriados estaduais e municipais não entram automaticamente, porque não há fonte oficial verificada integrada: cadastre os da sua cidade em Feriados locais.',
  'Pontos facultativos (Carnaval, Quarta-feira de Cinzas, Corpus Christi) e a Sexta-feira da Paixão, definida por lei municipal, não entram sozinhos. Inclua-os se forem folga para você.',
  'Dias de eleição (domingos de outubro dos anos pares) também não entram sozinhos. Se forem folga para você, inclua-os em Feriados locais pelo atalho de eleições.',
  'Uma receita comum lançada para registrar aporte, empréstimo informal, transferência ou reembolso não pode ser identificada sem ler a descrição. Confira em Receitas consideradas e desconsidere o que não for renda.',
  'O estorno de um recebimento de cliente fica na data do próprio recebimento e anula o valor dele naquele mês, como no relatório de caixa: estornar um recebimento de um mês que já passou muda a estimativa que usa esse mês.',
  'Receitas futuras ou previstas não entram: só o que já foi efetivado. O FênixGran não projeta receitas recorrentes.',
  'Cada turno conta no dia em que começa. Turnos que se cruzam contam o tempo em comum uma vez, e o intervalo de cada turno é descontado uma vez. Um turno com intervalo só pode cruzar outro se ficar inteiro dentro de horários sem intervalo: fora disso, não dá para saber onde cai a pausa, e as horas não são calculadas. Jornadas sem horário somam.',
];

export const INCOME_KIND_LABELS: Record<IncomeKind, string> = {
  income: 'Receita',
  receivable: 'Recebimento de cliente',
  receivable_reversal: 'Estorno de recebimento',
  pending: 'Receita prevista',
  loan: 'Empréstimo',
  card_payment: 'Pagamento de fatura',
  split: 'Divisão de contas',
  investment: 'Investimento',
  voided: 'Anulado',
  expense: 'Despesa',
  invalid: 'Fora do padrão',
};

/** Por que o item entra, sai ou reduz a renda. */
export const INCOME_KIND_REASONS: Record<IncomeKind, string> = {
  income: 'Receita efetivada: entra pelo valor.',
  receivable: 'Recebimento de cliente: entra o principal; juros e multa ficam fora (são resultado financeiro).',
  receivable_reversal: 'Estorno de recebimento: fica na data do recebimento e anula o valor dele naquele mês.',
  pending: 'Ainda não efetivada: não entra.',
  loan: 'Valor de empréstimo não é renda: não entra.',
  card_payment: 'Movimento de fatura de cartão não é renda: não entra.',
  split: 'Reembolso ou compensação da divisão de contas só recompõe gastos: não entra.',
  investment: 'Aporte, resgate ou rendimento de investimento não é renda do trabalho: não entra.',
  voided: 'Lançamento anulado: não entra.',
  expense: 'Despesa: não entra.',
  invalid: 'Fora do padrão de lançamento: não entra.',
};

/** Como um item aparece no painel "Receitas consideradas". */
export interface IncomeItemPresentation {
  /** Situação do item nesta estimativa. */
  status: string;
  /** Aviso do estorno do recebimento, quando houver. */
  reversalNote: string | null;
  /** Mostra a caixa de considerar ou desconsiderar. */
  canToggle: boolean;
}

/**
 * Texto e caixa de cada item do painel. Item depois do período (mês corrente no modo habitual)
 * ainda não entra na conta. O estorno de recebimento fica na data do próprio recebimento, então os
 * dois estão sempre no mesmo mês e um anula o outro: o recebimento estornado não precisa ser
 * desconsiderado, e o já desconsiderado não tira nada da estimativa (o estorno é lido junto com
 * ele, `excludedItemOf`); a caixa continua, para voltar a considerá-lo.
 */
export const incomeItemPresentation = (item: IncomeItemView, months: readonly string[]): IncomeItemPresentation => {
  const inside = months.includes(item.month);
  const status = !item.excludable
    ? INCOME_KIND_REASONS[item.classification.kind]
    : item.excludedByUser
      ? 'Desconsiderada por você: não entra nesta estimativa.'
      : inside ? 'Considerada na estimativa.' : 'Depois do período desta estimativa: ainda não entra na conta.';
  let reversalNote: string | null = null;
  if (item.reversed) {
    const where = inside
      ? 'Recebimento estornado: o estorno fica na data do recebimento e já anula o valor dele neste mês.'
      : 'Recebimento estornado: o estorno fica na data do recebimento e anula o valor dele no mesmo mês, depois do período desta estimativa.';
    const action = item.excludedByUser
      ? ' Você o desconsiderou, mas a exclusão não tira nada da estimativa: o estorno já anula o valor. Pode voltar a considerá-lo.'
      : ' Não é preciso desconsiderá-lo.';
    reversalNote = `${where}${action}`;
  }
  return { status, reversalNote, canToggle: item.excludable && (!item.reversed || item.excludedByUser) };
};
