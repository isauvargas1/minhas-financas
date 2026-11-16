import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import type { WorkTimeConfig } from './calculation';
import type { WorkCalendar } from './calendar';
import {
  deleteWorkTimePreference,
  saveWorkTimeDisplayMode,
  saveWorkTimePreference,
  subscribeWorkTimePreference,
  type WorkTimePreferenceSnapshot,
} from './api';
import {
  effectiveDisplayMode,
  isWorkTimeEnabled,
  workCalendarOf,
  type WorkTimeDisplayMode,
  type WorkTimePreference,
} from './contract';
import { useIncomeEstimate, type IncomeEstimateState } from './useIncomeEstimate';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface WorkTimeContextValue {
  /** `idle` sem conta pronta; `error` quando a leitura falhou (a interface mostra dinheiro). */
  status: LoadStatus;
  /** Preferência válida do usuário atual, ou `null` (ausente, inválida, carregando ou com falha). */
  preference: WorkTimePreference | null;
  /** Há um documento, mas fora do contrato. */
  isStoredInvalid: boolean;
  /** O estado mostrado inclui uma gravação desta aba ainda não confirmada pelo servidor. */
  hasPendingWrites: boolean;
  /** A conversão está ligada (preferência válida e ativada): o alternador aparece. */
  isAvailable: boolean;
  /** Modo de exibição escolhido; `money` em qualquer dúvida. */
  displayMode: WorkTimeDisplayMode;
  /**
   * Renda e minutos da estimativa pronta, só no modo tempo; `null` no modo
   * dinheiro e enquanto a estimativa carrega, falha ou está indisponível
   * (os valores ficam em reais).
   */
  config: WorkTimeConfig | null;
  /** Estimativa automática da preferência salva (P5-F.1), do uid atual. */
  estimate: IncomeEstimateState;
  savePreference: (preference: WorkTimePreference) => Promise<void>;
  setDisplayMode: (mode: WorkTimeDisplayMode) => Promise<void>;
  deletePreference: () => Promise<void>;
  retry: () => void;
  /** Uid para o qual o estado vale; quem confirma uma gravação compara com o atual. */
  ownerUid: string | null;
}

const WorkTimeContext = createContext<WorkTimeContextValue | undefined>(undefined);

interface ListenerState {
  uid: string | null;
  status: LoadStatus;
  snapshot: WorkTimePreferenceSnapshot | null;
}

const NO_ACCOUNT = new Error('Entre na sua conta para alterar esta preferência.');
const EMPTY_CALENDAR: WorkCalendar = { routines: [], worksOnHolidays: false, localHolidays: [], exceptions: [] };
const NO_IDS: readonly string[] = [];

/**
 * Preferência privada de tempo de trabalho equivalente (P5-F, REQ-FUT-01;
 * contrato v2 e estimativa automática da P5-F.1).
 *
 * Fica abaixo do `WorkspaceProvider`: o listener só começa depois que o
 * `bootstrapAccount` do usuário atual concluiu (antes disso as Rules negam,
 * porque a conta ainda não existe). O estado é marcado com o uid: na troca de
 * conta, até a primeira leitura da conta nova, nada da anterior aparece e os
 * valores ficam em dinheiro. Respostas atrasadas de outra conta não chegam,
 * porque o listener é cancelado quando o uid muda. Outras abas e dispositivos
 * recebem as mudanças pelo mesmo listener. Nada é copiado para o React Query
 * nem para o `localStorage`.
 *
 * A estimativa (renda elegível ÷ horas planejadas) é uma só por contexto:
 * calculada aqui, da preferência do uid atual e das fontes oficiais, e
 * reaproveitada por todos os pontos de exibição. Com outro uid, a
 * preferência é `null` e a estimativa fica parada, então nada de outra conta
 * aparece; enquanto carrega, os valores ficam em reais.
 */
export const WorkTimeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { isAccountReady } = useWorkspace();
  const uid = user && isAccountReady ? user.uid : null;
  const [retryNonce, setRetryNonce] = useState(0);
  const [state, setState] = useState<ListenerState>({ uid: null, status: 'idle', snapshot: null });

  useEffect(() => {
    if (!uid) {
      setState({ uid: null, status: 'idle', snapshot: null });
      return undefined;
    }
    setState({ uid, status: 'loading', snapshot: null });
    return subscribeWorkTimePreference(
      uid,
      (snapshot) => setState({ uid, status: 'ready', snapshot }),
      (error) => {
        // Só o código: nenhum dado da preferência vai para o log.
        const code = (error as { code?: unknown } | null)?.code;
        console.error('Falha ao ler a preferência de tempo de trabalho', typeof code === 'string' ? code : 'desconhecido');
        setState({ uid, status: 'error', snapshot: null });
      },
    );
  }, [uid, retryNonce]);

  // Estado de outra sessão nunca é exposto durante a troca de conta.
  const current: ListenerState = state.uid === uid
    ? state
    : { uid, status: uid ? 'loading' : 'idle', snapshot: null };
  const snapshot = current.status === 'ready' ? current.snapshot : null;
  const preference = snapshot?.status === 'valid' ? snapshot.preference : null;
  const displayMode = effectiveDisplayMode(preference);
  const calendar = useMemo<WorkCalendar | null>(() => (preference ? workCalendarOf(preference) : null), [preference]);
  const estimate = useIncomeEstimate({
    workspaceId: preference?.incomeWorkspaceId ?? null,
    mode: preference?.estimateMode ?? 'habitual',
    historyMonths: preference?.historyMonths ?? 3,
    allowBusinessIncome: preference?.allowBusinessIncome ?? false,
    calendar: calendar ?? EMPTY_CALENDAR,
    excludedIds: preference?.excludedIncomeIds ?? NO_IDS,
    enabled: isWorkTimeEnabled(preference),
  });
  const ready = estimate.status === 'done' && estimate.estimate.status === 'ready' ? estimate.estimate.config : null;
  const incomeCents = ready?.incomeCents ?? null;
  const workMinutes = ready?.workMinutes ?? null;
  const config = useMemo<WorkTimeConfig | null>(
    () => (displayMode === 'time' && incomeCents !== null && workMinutes !== null
      ? { incomeCents, workMinutes }
      : null),
    [displayMode, incomeCents, workMinutes],
  );

  const savePreference = useCallback(async (next: WorkTimePreference) => {
    if (!uid) throw NO_ACCOUNT;
    await saveWorkTimePreference(uid, next);
  }, [uid]);

  const setDisplayMode = useCallback(async (mode: WorkTimeDisplayMode) => {
    if (!uid) throw NO_ACCOUNT;
    await saveWorkTimeDisplayMode(uid, mode);
  }, [uid]);

  const deletePreference = useCallback(async () => {
    if (!uid) throw NO_ACCOUNT;
    await deleteWorkTimePreference(uid);
  }, [uid]);

  const retry = useCallback(() => setRetryNonce((value) => value + 1), []);

  const value = useMemo<WorkTimeContextValue>(() => ({
    status: current.status,
    preference,
    isStoredInvalid: snapshot?.status === 'invalid',
    hasPendingWrites: snapshot?.pendingWrites ?? false,
    isAvailable: isWorkTimeEnabled(preference),
    displayMode,
    config,
    estimate,
    savePreference,
    setDisplayMode,
    deletePreference,
    retry,
    ownerUid: uid,
  }), [current.status, preference, snapshot, displayMode, config, estimate, savePreference, setDisplayMode, deletePreference, retry, uid]);

  return <WorkTimeContext.Provider value={value}>{children}</WorkTimeContext.Provider>;
};

/** Para Configurações e Header: exige o provider. */
export const useWorkTime = (): WorkTimeContextValue => {
  const context = useContext(WorkTimeContext);
  if (!context) throw new Error('useWorkTime deve ser usado dentro de WorkTimeProvider');
  return context;
};

/** Para a exibição de valores: sem provider, tudo fica em dinheiro. */
export const useOptionalWorkTime = (): WorkTimeContextValue | undefined => useContext(WorkTimeContext);
