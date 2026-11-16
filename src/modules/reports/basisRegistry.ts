import type { createLiveRefreshScheduler } from './liveRefresh.ts';
import type { BasisFailureState } from './basisRefresh.ts';

/**
 * Registro das bases de relatório de longa duração montadas (P5-F.1): um
 * agendador por chave, dividido por todos os observadores da mesma base, as
 * falhas da versão atual dos dados e se a base já carregou. Módulo sem React e
 * sem SDK: os ganchos de `basisSync.ts` registram as bases e pedem a releitura
 * das próprias quando a projeção muda; `queryKeys.ts` reabre todas na virada
 * do mês; uma mutação nesta aba relê as do workspace dela, por um agendador à
 * parte.
 */
export interface BasisRefreshEntry {
  /** Agendador da escuta e da virada do mês (`FINANCIAL_REPORT_BASIS_REFRESH`). */
  scheduler: ReturnType<typeof createLiveRefreshScheduler>;
  /** Agendador da releitura depois de uma mutação nesta aba, com orçamento próprio (`FINANCIAL_REPORT_BASIS_MUTATION_REFRESH`). */
  mutationScheduler: ReturnType<typeof createLiveRefreshScheduler>;
  users: number;
  failure: BasisFailureState;
  /** Falhas seguidas que param o agendador (o teto de `BASIS_RETRIES_AFTER_ERROR`). */
  maxFailures: number;
  /** Workspace da base (a chave é do uid da sessão). */
  workspaceId: string;
  /** A base já tem dados (lido no cache na hora). Base que nunca carregou não entra no agendador: espera "Tentar de novo" ou uma montagem nova. */
  loaded: () => boolean;
}

export const basisRefreshes = new Map<string, BasisRefreshEntry>();

/**
 * Pede, pelo agendador de cada uma, a releitura das bases registradas e já
 * carregadas com as chaves dadas (todas, sem chaves), zerando as falhas. Quem
 * chama tem um sinal de versão nova para essas bases: a projeção da janela de
 * uma estimativa mudou (as bases dela) ou o mês virou (todas). Uma base parada
 * no teto de falhas volta a ser relida só com um sinal desses.
 */
export const refreshRegisteredBases = (keys?: readonly string[]): void => {
  for (const [key, entry] of basisRefreshes) {
    if ((keys && !keys.includes(key)) || !entry.loaded()) continue;
    entry.failure = { ...entry.failure, failures: 0 };
    scheduleBasisReread(key, entry.scheduler);
  }
};

/**
 * Ordem dos pedidos de releitura e das leituras de cada base, num contador só
 * (sem relógio): uma leitura que começou depois de um pedido lê o estado de um
 * momento posterior a ele. Para a releitura da mutação, o gatilho da projeção
 * pode ainda não ter gravado nesse momento; a escuta, quando viva, vê a
 * gravação depois e pede de novo. Por base: o começo da última leitura, o da
 * leitura cujos dados ela mostra e os pedidos que essa leitura não cobre. A
 * ordem fica quando a base sai de uso: a que volta continua sabendo o que não
 * leu. A lista de pedidos de uma base só cresce enquanto ela não é lida com
 * dados (cada leitura com dados tira os que cobre), dentro dos orçamentos dos
 * agendadores e do teto de falhas.
 */
let basisOrder = 0;
const readStartedAt = new Map<string, number>();
const servedReadStartedAt = new Map<string, number>();
const openRequests = new Map<string, number[]>();
/** Bases que saíram de uso com releitura pendente: são relidas quando voltam (`basisSync.ts`). */
const rereadOnReturn = new Set<string>();
/**
 * Prova de consistência da estimativa (P5-F.1-R1, `work-time/consistency.ts`), na mesma ordem: quando cada
 * versão de cada mês da projeção chegou pela primeira vez a uma escuta da conta e do workspace
 * (`projectionSeen`, até 4 versões por mês). A leitura por id que começou depois viu tudo o que a projeção
 * desse mês viu (o Firestore não devolve, a uma leitura que começa depois de outra terminar, um estado
 * anterior ao dela).
 */
const projectionSeen = new Map<string, Map<string, number>>();
const PROJECTION_VERSIONS_KEPT = 4;

/** Pede a releitura da base pelo agendador dado, guardando a ordem do pedido. */
export const scheduleBasisReread = (key: string, scheduler: { notify: () => void }): void => {
  basisOrder += 1;
  const open = openRequests.get(key) ?? [];
  open.push(basisOrder);
  openRequests.set(key, open);
  scheduler.notify();
};

/** Uma leitura da base começou (a `queryFn`); devolve a ordem dela. */
export const noteBasisReadStart = (key: string): number => {
  basisOrder += 1;
  readStartedAt.set(key, basisOrder);
  return basisOrder;
};

/**
 * A leitura que começou na ordem dada trouxe dados. Se nenhuma outra começou
 * depois dela (a nova cancela a anterior), são os dados que a base passa a
 * mostrar, e os pedidos anteriores ao começo dela ficam cobertos.
 */
export const noteBasisReadServed = (key: string, started: number): void => {
  if (readStartedAt.get(key) !== started) return;
  servedReadStartedAt.set(key, started);
  const open = (openRequests.get(key) ?? []).filter((request) => request > started);
  if (open.length > 0) openRequests.set(key, open);
  else openRequests.delete(key);
};

/** Uma leitura que depende das bases (a das desconsideradas por id) começa: a ordem dela. */
export const noteDependentReadStart = (): number => {
  basisOrder += 1;
  return basisOrder;
};

/**
 * Uma escuta recebeu do servidor o mês `month` na versão `version` (`serverVersionKey`): devolve a ordem
 * em que essa versão chegou pela primeira vez a uma escuta de `syncKey`.
 */
export const noteProjectionSeen = (syncKey: string, month: string, version: string): number => {
  const key = `${syncKey}\n${month}`;
  const versions = projectionSeen.get(key) ?? new Map<string, number>();
  let order = versions.get(version);
  if (order === undefined) {
    basisOrder += 1;
    order = basisOrder;
    versions.set(version, order);
    if (versions.size > PROJECTION_VERSIONS_KEPT) versions.delete(versions.keys().next().value as string);
    projectionSeen.set(key, versions);
  }
  return order;
};

/**
 * Depois de uma mutação nesta aba: relê as bases carregadas do workspace pelo
 * agendador da mutação (agrupado e com orçamento próprio, sem gastar o da
 * escuta), sem zerar as falhas: a base parada no teto (as duas últimas
 * leituras falharam, e ela está em erro) continua parada, e a estimativa
 * avisa a falha. O total oficial só muda depois do gatilho da projeção, e
 * quem vê a mudança é a escuta; esta releitura cobre o que a escuta não vê: o
 * gatilho que desiste e marca a projeção para reconstrução sem mudar os
 * documentos mensais (a base volta sem bloco exato e a estimativa fica
 * indisponível), e a escuta encerrada. Nunca relê as leituras de receitas:
 * elas só seguem a base, e uma base nova com outra receita é segurada até elas
 * serem relidas (`basisSync.ts`).
 */
export const rereadWorkspaceBases = (workspaceId: string): void => {
  for (const [key, entry] of basisRefreshes) {
    if (entry.workspaceId !== workspaceId || !entry.loaded() || entry.failure.failures >= entry.maxFailures) continue;
    scheduleBasisReread(key, entry.mutationScheduler);
  }
};

/** A base tem releitura pendente em algum dos dois agendadores (agrupando mudanças ou esperando a reposição do orçamento). */
const rereadPending = (key: string): boolean => {
  const entry = basisRefreshes.get(key);
  return entry !== undefined && (entry.scheduler.scheduled() || entry.mutationScheduler.scheduled());
};

/**
 * A base tem releitura pendente pedida depois do começo da última leitura
 * dela: um sinal que essa leitura pode não ter visto ainda vai relê-la. A base
 * que sai de uso assim fica desatualizada e marcada, e é relida quando volta
 * (`basisSync.ts`).
 */
export const basisRereadScheduled = (key: string): boolean => {
  if (!rereadPending(key)) return false;
  const open = openRequests.get(key);
  return open !== undefined && open[open.length - 1] > (readStartedAt.get(key) ?? 0);
};

/**
 * Com mais de uma base (a janela de 12 meses): alguma base mostra uma leitura
 * que começou depois de um pedido que outra ainda não leu e que ainda vai
 * relê-la (releitura pendente). A estimativa segura enquanto isso
 * (`basisSync.ts`, `outOfStep`), para não mostrar uma base nova com outra que
 * o mesmo sinal ainda vai reler. As bases cujas leituras começaram antes do
 * mesmo pedido pendente estão em passo e não seguram uma à outra; a base que
 * não vai ser relida (no teto de falhas) também não segura.
 */
export const basesOutOfStep = (keys: readonly string[]): boolean =>
  keys.some((behind) => {
    const firstOpen = openRequests.get(behind)?.[0];
    if (firstOpen === undefined || !rereadPending(behind)) return false;
    return keys.some((other) => other !== behind && (servedReadStartedAt.get(other) ?? 0) > firstOpen);
  });

/** Marca a base que sai de uso com releitura pendente. */
export const markRereadOnReturn = (key: string): void => {
  rereadOnReturn.add(key);
};

/** A base que volta a ser usada estava marcada (a marca vale uma vez). */
export const takeRereadOnReturn = (key: string): boolean => rereadOnReturn.delete(key);

/**
 * Esvazia o registro: as bases (com os agendadores cancelados), a ordem e as
 * marcas. Na sessão, o registro vive com a aplicação; os testes o esvaziam
 * entre um caso e outro.
 */
export const clearBasisRegistry = (): void => {
  for (const entry of basisRefreshes.values()) {
    entry.scheduler.cancel();
    entry.mutationScheduler.cancel();
  }
  basisRefreshes.clear();
  readStartedAt.clear();
  servedReadStartedAt.clear();
  openRequests.clear();
  rereadOnReturn.clear();
  projectionSeen.clear();
};

/** Chave da sincronização de uma estimativa: a conta e o workspace-fonte. */
export const syncKeyOf = (uid: string, workspaceId: string): string => `${uid}|${workspaceId}`;

/**
 * Retornos do servidor às escutas das projeções, pela chave da sincronização,
 * e quantos já tinham chegado quando cada base começou a última leitura (pela
 * chave da base). Uma leitura que começou antes do último retorno pode ter lido
 * um estado anterior a ele (por exemplo, uma receita lançada e anulada durante
 * a leitura): a sincronização compara de novo e pode pedir outra releitura.
 */
const serverSnapshots = new Map<string, number>();
export const noteServerSnapshot = (key: string): void => {
  serverSnapshots.set(key, (serverSnapshots.get(key) ?? 0) + 1);
};
export const serverSnapshotCount = (key: string): number => serverSnapshots.get(key) ?? 0;
export const basisFetchStarts = new Map<string, number>();

/**
 * Escutas das projeções encerradas por erro, pela chave da sincronização
 * (`uid|workspace`). O SDK não reabre uma escuta encerrada, e cada estimativa
 * (o provedor, a prévia de Configurações, o assistente) tem a sua: sem este
 * registro, o "Tentar de novo" de uma não alcançaria a do provedor, que não
 * tem botão em nenhuma tela. Cada uma registra como se reabrir; o "Tentar de
 * novo" de qualquer estimativa e cada retorno do servidor a outra escuta da
 * mesma chave (sinal de que o acesso voltou) reabrem todas as registradas.
 */
const failedListeners = new Map<string, Set<() => void>>();

/** Registra a reabertura de uma escuta encerrada; devolve como desfazer o registro. */
export const registerFailedListener = (key: string, reopen: () => void): (() => void) => {
  const set = failedListeners.get(key) ?? new Set<() => void>();
  set.add(reopen);
  failedListeners.set(key, set);
  return () => {
    const current = failedListeners.get(key);
    if (!current) return;
    current.delete(reopen);
    if (current.size === 0) failedListeners.delete(key);
  };
};

/** Reabre as escutas encerradas da chave (cada uma uma vez; o registro é esvaziado). */
export const reopenFailedListeners = (key: string): void => {
  const set = failedListeners.get(key);
  if (!set) return;
  failedListeners.delete(key);
  for (const reopen of set) reopen();
};
