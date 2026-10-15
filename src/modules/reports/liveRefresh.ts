/**
 * Agenda as releituras do relatório disparadas pelo listener da projeção de
 * caixa (P5-C1). Mudanças em rajada viram uma releitura só, `coalesceMs`
 * depois da última. Um orçamento limita o total: até `burst` releituras
 * seguidas e reposição de uma a cada `refillMs` — no máximo
 * `burst + 1 h ÷ refillMs` por hora (100 com os valores padrão). Assim, mesmo
 * com escritas contínuas de outros membros, o Dashboard (duas chamadas por
 * releitura) fica abaixo do limite de frequência da callable (300 por hora).
 * Sem orçamento, a releitura espera a reposição; nenhuma mudança se perde,
 * porque a releitura lê o estado do momento em que acontece.
 */
export const LIVE_REFRESH_COALESCE_MS = 2_000;
export const LIVE_REFRESH_BURST = 40;
export const LIVE_REFRESH_REFILL_MS = 60_000;

export interface LiveRefreshClock {
    now: () => number;
    setTimer: (run: () => void, ms: number) => unknown;
    clearTimer: (handle: unknown) => void;
}

export interface LiveRefreshOptions {
    coalesceMs: number;
    burst: number;
    refillMs: number;
}

const systemClock: LiveRefreshClock = {
    now: () => Date.now(),
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const createLiveRefreshScheduler = (
    onRefresh: () => void,
    clock: LiveRefreshClock = systemClock,
    options: LiveRefreshOptions = {
        coalesceMs: LIVE_REFRESH_COALESCE_MS,
        burst: LIVE_REFRESH_BURST,
        refillMs: LIVE_REFRESH_REFILL_MS,
    },
) => {
    let tokens = options.burst;
    let refilledAt = clock.now();
    let pending: unknown = null;

    const refill = () => {
        const steps = Math.floor((clock.now() - refilledAt) / options.refillMs);
        if (steps <= 0) return;
        tokens = Math.min(options.burst, tokens + steps);
        refilledAt += steps * options.refillMs;
    };

    const fire = () => {
        pending = null;
        refill();
        if (tokens <= 0) {
            pending = clock.setTimer(fire, refilledAt + options.refillMs - clock.now());
            return;
        }
        tokens -= 1;
        onRefresh();
    };

    return {
        /** Uma mudança observada: (re)agenda a releitura agrupada. */
        notify: () => {
            if (pending !== null) clock.clearTimer(pending);
            pending = clock.setTimer(fire, options.coalesceMs);
        },
        /** Cancela a releitura pendente (troca de documento ou desmontagem). */
        cancel: () => {
            if (pending !== null) clock.clearTimer(pending);
            pending = null;
        },
    };
};
