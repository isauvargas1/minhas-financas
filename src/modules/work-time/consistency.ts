/**
 * Prova de consistência da estimativa (P5-F.1-R1, B03; regra 5 substituída na P5-F.1-R3). Módulo PURO: sem
 * React, sem Firebase, imports com extensão `.ts`.
 *
 * A estimativa junta leituras feitas em momentos diferentes: a série do relatório oficial, o 12º mês (só na
 * janela de 12 meses) e os lançamentos desconsiderados, por id. Quando depende dessas leituras (a que converte, a
 * indisponível com a memória de cálculo preenchida e a de rotinas ambíguas), ela só é mostrada quando a
 * correspondência entre elas é demonstrada por uma fonte oficial e a sincronização terminou; fora disso, vale um
 * estado sem conversão ("calculando", "estimativa em atualização" ou a falha com "Tentar de novo"), nunca uma
 * estimativa anterior (P5-F.1-R3.1). A indisponível por um motivo decidido antes das receitas aparece como está
 * (`holdEstimate`, P5-F.1-R3.2). A fonte é a projeção mensal de caixa (`cash_report_periods`) confirmada pelo servidor e,
 * com desconsideradas, as marcas de aplicação da projeção (`projectionProof.ts`).
 *
 * Uma estimativa é provada quando:
 *
 * 1. **Bloco exato.** Sem bloco exato nas bases, nada é provado. A estimativa calculada assim é "indisponível",
 *    sem números (`report_unavailable`; `computeWorkTimeEstimate` não converte nada), e aparece como está, sem depender
 *    da prova (`holdEstimate`); a
 *    regra só impede que uma estimativa que convertesse sem bloco exato apareça sem a confirmação do servidor
 *    (P5-F.1-R3.2, F-03 da revisão financeira: a exatidão da prova e a do cálculo são expressões separadas).
 * 2. **Projeção confirmada.** Há um retorno do servidor da escuta para os meses da janela, ainda válido: com a
 *    escuta encerrada, ou com o SDK servindo só do cache local (sem conexão), nada é provado. Vale para toda
 *    janela (1, 3, 6 ou 12 meses, ou o mês corrente), com uma base ou duas, com ou sem desconsiderada: uma base
 *    lida (ou servida do cache do React Query) não prova sozinha que é o estado atual (P5-F.1-R3.2, RR-R31-05).
 * 3. **Bases na projeção.** A receita de cada mês da janela nas bases é a da projeção confirmada: a série
 *    e o 12º mês correspondem ao mesmo estado (mês sem documento vale 0). No mês corrente, a série soma os
 *    dias até a data de referência e a projeção traz o mês inteiro; são iguais porque nenhum lançamento
 *    confirmado tem data futura (D-29), e a base de um dia anterior sem a receita de hoje diverge e é relida.
 *    Uma divergência que persiste depois das releituras continua sem prova: nenhuma quantidade de releituras
 *    aceita a base que não alcança a projeção.
 * 4. **Leitura das desconsideradas depois da projeção.** A leitura em uso começou depois de a versão atual de
 *    cada mês com desconsiderada chegar a uma escuta da conta e do workspace (a ordem do registro, sem
 *    relógio). Uma versão nova desses meses pede outra leitura. É frescor, não a prova: a prova é a regra 5.
 * 5. **Marcas de aplicação, no mesmo instante dos meses** (P5-F.1-R3). A leitura das desconsideradas traz,
 *    de uma transação só de leitura, os meses da janela e as marcas de cada desconsiderada e de cada espelho
 *    de estorno: a receita das bases é a desses meses, e cada marca diz que a projeção contém exatamente o
 *    conteúdo lido do lançamento (mesma impressão digital), ou nada dele. Sem isso, não há prova, por mais que
 *    se espere: nenhum prazo, total coincidente ou avanço de `updatedAt` aprova a conversão.
 */
import { incomeDiverges, type ConfirmedProjection, type MonthlyIncome } from '../reports/basisRefresh.ts';
import type { ProjectionProof } from './projectionProof.ts';

export interface ConsistencyInput {
  /** Meses da janela da estimativa. */
  months: readonly string[];
  /** A estimativa desconta lançamentos desconsiderados (lidos por id). */
  hasExclusions: boolean;
  /** Receita das bases e se todos os blocos são exatos; `null` enquanto alguma carrega. */
  basis: { income: MonthlyIncome; exact: boolean } | null;
  /** O último retorno do servidor da escuta, ainda válido (`null` antes dele, com a escuta encerrada ou sem conexão). */
  projection: ConfirmedProjection | null;
  /** Ordem em que a leitura das desconsideradas em uso começou; `null` sem leitura. */
  excludedStartedOrder: number | null;
  /** Meses das desconsideradas na leitura em uso. */
  excludedMonths: readonly string[];
  /** A prova pelas marcas da leitura em uso (regra 5); `null` sem leitura. */
  exclusionsProof: ProjectionProof | null;
}

export type ConsistencyReason = 'loading' | 'inexact' | 'projection' | 'bases' | 'exclusions_read' | 'projection_marks';

export type ConsistencyResult = { proven: true } | { proven: false; reason: ConsistencyReason };

/** As regras do topo, nesta ordem; a primeira que falha é o motivo. */
export const proveEstimateConsistency = (input: ConsistencyInput): ConsistencyResult => {
  if (input.basis === null) return { proven: false, reason: 'loading' };
  // Sem bloco exato, nada é provado: a estimativa sai indisponível sem números (`report_unavailable`) e aparece como
  // está; nenhuma pronta converte assim.
  if (!input.basis.exact) return { proven: false, reason: 'inexact' };
  const projection = input.projection;
  if (projection === null) return { proven: false, reason: 'projection' };
  if (incomeDiverges(projection.income, input.basis.income, input.months)) return { proven: false, reason: 'bases' };
  if (!input.hasExclusions) return { proven: true };
  const started = input.excludedStartedOrder;
  if (started === null || input.exclusionsProof === null) return { proven: false, reason: 'loading' };
  const window = new Set(input.months);
  for (const month of input.excludedMonths) {
    if (window.has(month) && started <= (projection.seen[month] ?? Number.POSITIVE_INFINITY)) {
      return { proven: false, reason: 'exclusions_read' };
    }
  }
  if (!input.exclusionsProof.proven) return { proven: false, reason: 'projection_marks' };
  return { proven: true };
};
