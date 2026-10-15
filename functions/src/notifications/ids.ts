import {sha256} from "../shared/hashing";
import {
  NotificationContractError,
  type NotificationDomain,
  type NotificationEventType,
} from "./contract";

/**
 * Identidade determinística do evento (P5-D2): o mesmo fato de domínio
 * reprocessado (reentrega do gatilho, reexecução da rotina, retry) produz
 * sempre o mesmo ID, e `create` com esse ID publica uma única vez.
 *
 * O episódio distingue fatos repetidos da mesma entidade (ex.: `overdueFrom`
 * do empréstimo, `dueDate` do recebível, instante do commit que tornou o
 * saldo negativo). Nunca aleatório, nunca o relógio da execução.
 *
 * Isto sozinho não impede reemissão depois do TTL: essa garantia vem da
 * condição de emissão de cada produtor (transição de estado ou janela de
 * emissão), documentada nos produtores.
 *
 * Os avisos de cartões (D-36) mantêm o formato próprio, `cc<tipo>_<hash>`
 * (`cards/closing.ts`), já coberto pelos testes do domínio.
 */
type ProducerDomain = Exclude<NotificationDomain, "credit_card">;

const PREFIX_BY_DOMAIN: Record<ProducerDomain, string> = {
  loan: "ln",
  receivable: "rc",
  cash_account: "ca",
  goal: "gl",
  recurring: "ro",
};

const SEGMENT = /^[^:/\s][^:/]{0,255}$/;

export interface NotificationIdentity {
  workspaceId: string;
  domain: ProducerDomain;
  entityId: string;
  eventType: NotificationEventType;
  episode: string;
}

export const notificationIdFor = (identity: NotificationIdentity): string => {
  const parts = [
    identity.workspaceId,
    identity.domain,
    identity.entityId,
    identity.eventType,
    identity.episode,
  ];
  for (const part of parts) {
    if (typeof part !== "string" || !SEGMENT.test(part)) {
      throw new NotificationContractError("invalid_identity");
    }
  }
  return `${PREFIX_BY_DOMAIN[identity.domain]}_` +
    sha256(parts.join(":")).slice(0, 32);
};
