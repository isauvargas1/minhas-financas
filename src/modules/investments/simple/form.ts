/**
 * Formulários simples: máscara, validação e montagem de payload (Etapa 2, §4,
 * §8 e §9).
 *
 * Tudo aqui é função pura. A interface não decide nada sobre o domínio: ela
 * coleta texto, chama estas funções e envia o resultado. É o que permite testar
 * "depositado = Não vira aporte pendente" sem renderizar React — o repositório
 * não tem runner de componente, e inventar um seria trocar a suíte por uma
 * dependência nova.
 *
 * O que a interface **nunca** monta, por contrato do §4: `accountId`,
 * `assetId`, `quantityMicros`, `assetType`, posição ou resultado. O backend
 * deriva tudo isso.
 */

export const MAX_CENTS = 9_000_000_000_000;
export const MAX_DESCRIPTION_LENGTH = 240;

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Centavos → texto do campo ("1.234,56"). Sem o "R$", que é prefixo visual. */
export const formatCentsInput = (cents: number): string =>
  currencyFormatter.format(cents / 100);

/**
 * Texto digitado → centavos.
 *
 * A máscara é de dígitos: o usuário digita e o valor "entra pela direita", que
 * é o comportamento que o campo de dinheiro brasileiro tem em todo lugar.
 * Qualquer caractere não numérico é ignorado, então colar "R$ 1.234,56"
 * funciona.
 */
export const parseCurrencyInput = (text: string): number => {
  const digits = String(text ?? '').replace(/\D/g, '');
  if (digits.length === 0) return 0;
  const cents = Number(digits.slice(-15));
  return Number.isSafeInteger(cents) ? cents : 0;
};

/** Reformata o campo a cada tecla, mantendo a leitura em moeda. */
export const maskCurrencyInput = (text: string): string => {
  const cents = parseCurrencyInput(text);
  return cents === 0 ? '' : formatCentsInput(cents);
};

const pad = (value: number): string => String(value).padStart(2, '0');

/** Hoje no formato do `<input type="date">`, em horário local. */
export const dateInputValue = (moment: Date): string =>
  `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}`;

export const isValidDateInput = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());

/**
 * Data do campo → instante ISO aceito pelo domínio.
 *
 * Duas armadilhas resolvidas de uma vez:
 *
 * - **Fuso.** `new Date('2026-08-10')` é meia-noite **UTC**, que no Brasil é
 *   dia 9. O instante é ancorado ao meio-dia local, como o baseline já fazia
 *   ao exibir datas, e aí nenhum fuso usual muda o dia.
 * - **Futuro de cinco minutos.** As liquidações recusam data futura com
 *   tolerância de cinco minutos. Meio-dia de hoje é futuro até 11h55, e um
 *   "Confirmar depósito" às 9h seria recusado por uma data que o usuário nem
 *   escolheu. Quando o dia escolhido é hoje e o meio-dia ainda não chegou, o
 *   instante enviado é o agora.
 */
export const dateInputToInstant = (value: string, now: Date): string => {
  const noon = new Date(`${value}T12:00:00`);
  const sameLocalDay =
    noon.getFullYear() === now.getFullYear() &&
    noon.getMonth() === now.getMonth() &&
    noon.getDate() === now.getDate();
  if (sameLocalDay && noon.getTime() > now.getTime()) return now.toISOString();
  return noon.toISOString();
};

// ---------------------------------------------------------------------------
// Novo investimento
// ---------------------------------------------------------------------------

export interface NewInvestmentFormState {
  /** Vazio significa "Sem meta". Meta é opcional por contrato do §4. */
  goalId: string;
  /** Carteira de investimento — item de `investment_class`. */
  classId: string;
  institutionId: string;
  description: string;
  /**
   * Categoria — item de `category` com `transactionSubtype: "investimento"`.
   *
   * Um pendente aberto antes da unificação traz aqui o identificador do grupo
   * histórico `investment_type`, que o backend continua aceitando.
   */
  typeId: string;
  amount: string;
  deposited: boolean;
  date: string;
}

export const emptyNewInvestmentForm = (now: Date, goalId = ''): NewInvestmentFormState => ({
  goalId,
  classId: '',
  institutionId: '',
  description: '',
  typeId: '',
  amount: '',
  deposited: true,
  date: dateInputValue(now),
});

export type SimpleFormErrors = Record<string, string>;

export const validateNewInvestment = (state: NewInvestmentFormState): SimpleFormErrors => {
  const errors: SimpleFormErrors = {};
  if (!state.classId) errors.classId = 'Escolha a carteira de investimento.';
  if (!state.institutionId) errors.institutionId = 'Escolha a instituição.';
  const description = state.description.trim();
  if (description.length === 0) errors.description = 'Descreva o investimento.';
  else if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.description = `Use no máximo ${MAX_DESCRIPTION_LENGTH} caracteres.`;
  }
  if (!state.typeId) errors.typeId = 'Escolha a categoria do investimento.';
  const valueCents = parseCurrencyInput(state.amount);
  if (valueCents <= 0) errors.amount = 'Informe um valor maior que zero.';
  else if (valueCents > MAX_CENTS) errors.amount = 'Valor acima do limite permitido.';
  if (!isValidDateInput(state.date)) errors.date = 'Informe uma data válida.';
  return errors;
};

export interface CategorySelectOption {
  value: string;
  label: string;
}

/**
 * Rótulo da opção de compatibilidade quando o movimento não fotografou nome.
 */
export const LEGACY_CATEGORY_FALLBACK_LABEL = 'Categoria atual';

/**
 * Opções do seletor de categoria do investimento.
 *
 * A lista vem exclusivamente do cadastro atual — `category` com
 * `transactionSubtype: "investimento"`, que é Configurações › Cadastros ›
 * Categorias › Investimentos. Há **uma** exceção: o item já selecionado que
 * não está mais nessa lista.
 *
 * Isso acontece com um pendente aberto antes da unificação, cujo identificador
 * é do grupo histórico `investment_type`: a pessoa abriu a edição para
 * corrigir outra coisa — uma data, um valor —, e exigir uma recategorização
 * para isso transformaria uma correção trivial numa decisão de classificação
 * que ninguém pediu.
 *
 * O mesmo desenho alcança a categoria **inativada** depois do lançamento, e
 * aí ele não é só visual: a correção do pendente envia `replacesMovementId`, e
 * o backend tolera a inatividade **daquele** identificador — o que o
 * movimento substituído já carrega — dentro da mesma transação que o cancela.
 * Corrigir a descrição de um pendente cuja categoria foi aposentada continua
 * possível, sem recategorizar. Escolher **outra** categoria inativa não: a
 * exceção tem o tamanho de um identificador, e a lista abaixo só oferece as
 * ativas mais a que já estava selecionada.
 *
 * A compatibilidade tem o tamanho exato do problema: **uma** opção, rotulada
 * com o nome que o próprio movimento fotografou, e nunca o catálogo antigo
 * inteiro. Escolher qualquer categoria da lista atual faz a opção de
 * compatibilidade desaparecer — o lançamento passa a usar o identificador
 * novo e não há caminho de volta ao cadastro que saiu da experiência comum.
 *
 * O vínculo é sempre por identificador. Nada aqui compara rótulos.
 */
export const buildCategoryOptions = (
  items: Array<{ id: string; name: string }> | undefined,
  selectedId: string,
  selectedFallbackLabel?: string,
): CategorySelectOption[] => {
  const current = (items ?? []).map((item) => ({
    value: item.id,
    label: item.name,
  }));

  if (!selectedId || current.some((option) => option.value === selectedId)) {
    return current;
  }

  return [
    {
      value: selectedId,
      label: selectedFallbackLabel?.trim() || LEGACY_CATEGORY_FALLBACK_LABEL,
    },
    ...current,
  ];
};

export interface CreateSimpleInvestmentInput {
  institutionId: string;
  classId: string;
  typeId: string;
  description: string;
  valueCents: number;
  settled: boolean;
  occurredAt: string;
  goalId?: string;
  /**
   * Aporte pendente que este lançamento substitui (§11).
   *
   * Presente só na correção de um pendente. É o que faz o backend cancelar o
   * antecessor e criar o substituto na **mesma** transação: uma edição
   * recusada devolve o pendente original intacto, em vez de deixá-lo
   * cancelado sem substituto.
   */
  replacesMovementId?: string;
}

/**
 * Estado do formulário → payload de `createSimpleInvestment`.
 *
 * "Esse valor já foi depositado?" é a única pergunta que decide o efeito
 * financeiro: `Sim` liquida, `Não` cria a intenção pendente, sem mover
 * patrimônio nem caixa. `walletId` não é enviado — é informação operacional
 * opcional no backend, e o §4 proíbe transformá-la em campo obrigatório.
 *
 * `replacesMovementId` só viaja na correção de um pendente, e entra no digest
 * da intenção como qualquer outro campo: retry e duplo clique da **mesma**
 * correção repetem a mesma chave e produzem um fato financeiro só.
 */
export const buildCreateSimpleInvestmentInput = (
  state: NewInvestmentFormState,
  now: Date,
  replacesMovementId?: string,
): CreateSimpleInvestmentInput => ({
  institutionId: state.institutionId,
  classId: state.classId,
  typeId: state.typeId,
  description: state.description.trim(),
  valueCents: parseCurrencyInput(state.amount),
  settled: state.deposited,
  occurredAt: dateInputToInstant(state.date, now),
  ...(state.goalId ? { goalId: state.goalId } : {}),
  ...(replacesMovementId ? { replacesMovementId } : {}),
});

// ---------------------------------------------------------------------------
// Retirada
// ---------------------------------------------------------------------------

export interface WithdrawFormState {
  amount: string;
  received: boolean;
  date: string;
  /** Opcional, atrás de "Mais detalhes". Vazio significa "tudo é capital". */
  gain: string;
}

export const emptyWithdrawForm = (now: Date): WithdrawFormState => ({
  amount: '',
  received: true,
  date: dateInputValue(now),
  gain: '',
});

export const validateWithdraw = (state: WithdrawFormState): SimpleFormErrors => {
  const errors: SimpleFormErrors = {};
  const valueCents = parseCurrencyInput(state.amount);
  if (valueCents <= 0) errors.amount = 'Informe um valor maior que zero.';
  else if (valueCents > MAX_CENTS) errors.amount = 'Valor acima do limite permitido.';
  const gainCents = parseCurrencyInput(state.gain);
  if (gainCents > valueCents) {
    errors.gain = 'O rendimento não pode ser maior que o valor da retirada.';
  }
  if (!isValidDateInput(state.date)) errors.date = 'Informe uma data válida.';
  return errors;
};

export interface WithdrawSimpleInvestmentInput {
  positionId: string;
  valueCents: number;
  received: boolean;
  occurredAt: string;
  gainCents?: number;
}

/**
 * Estado do formulário → payload de `withdrawSimpleInvestment`.
 *
 * `gainCents` só viaja quando o usuário informou. Ausente, o backend trata o
 * total como capital e recusa uma retirada acima do capital aplicado — nada é
 * estimado no cliente, que não tem como saber a rentabilidade.
 */
export const buildWithdrawSimpleInvestmentInput = (
  state: WithdrawFormState,
  positionId: string,
  now: Date,
): WithdrawSimpleInvestmentInput => {
  const gainCents = parseCurrencyInput(state.gain);
  return {
    positionId,
    valueCents: parseCurrencyInput(state.amount),
    received: state.received,
    occurredAt: dateInputToInstant(state.date, now),
    ...(gainCents > 0 ? { gainCents } : {}),
  };
};
