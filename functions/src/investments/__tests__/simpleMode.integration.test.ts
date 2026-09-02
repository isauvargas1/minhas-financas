import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";

import type {WorkspaceAuthorizationContext} from "../../creditCards/auth";
import {
  applyCashPeriodWriteOnce,
  cashPeriodEventKey,
} from "../../cash/periods";
import {
  executeCancelInvestmentMovement,
  executeChangeInvestmentGoal,
  executeCreateInvestmentContribution,
  executeCreateSimpleInvestment,
  executeRecordInvestmentValuation,
  executeReverseInvestmentMovement,
  executeSaveInvestmentAsset,
  executeSettleInvestmentContribution,
  executeSettleSimpleWithdrawal,
  executeUnlinkInvestmentFromGoal,
  executeWithdrawSimpleInvestment,
} from "../operationsV2";
import {executeOnboardInvestmentWorkspace} from "../onboarding";
import {
  deterministicDocumentId,
  FUTURE_DATE_TOLERANCE_MS,
} from "../infrastructure";
import {
  investmentCatalogSeedDocumentId,
  legacyCatalogSeedDocumentId,
  normalizeCatalogName,
  VALUE_MODE_MICROS_PER_CENT,
} from "../simpleMode";
import {executeSeedLegacySettingsCatalog} from "../../goals/operations";

/**
 * Superfície simples do domínio patrimonial (Etapa 1).
 *
 * O que este arquivo prova, e por que cada prova importa:
 *
 * - **identidade** — um investimento novo nasce com ativo próprio derivado da
 *   intenção, nunca do texto. Descrição igual não funde investimentos; retry
 *   da mesma intenção não cria dois.
 * - **instituição** — a conta técnica é amarrada ao **ID** do item de
 *   catálogo. Renomear "BTG" para "BTG Pactual" não pode criar conta nova nem
 *   quebrar histórico.
 * - **pendente não é fato financeiro** — aporte e retirada pendentes não
 *   movem caixa, posição nem meta, e são canceláveis sem apagar documento.
 * - **liquidação acontece uma vez** — retry devolve replay; segunda
 *   liquidação de um mesmo pendente é recusada.
 * - **regime por valor** — a quantidade nunca vem do chamador e permanece em
 *   proporção exata com o custo em qualquer sequência de aportes e retiradas.
 *   Operação quantitativa incompatível é recusada, não silenciosamente
 *   reinterpretada.
 * - **nada de rentabilidade inventada** — a retirada retira custo; pedir mais
 *   do que o capital aplicado é erro de domínio, não uma estimativa.
 */

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST é obrigatório.");
}

const PROJECT = process.env.GCLOUD_PROJECT ?? "minhas-financas-local";
const WS_A = "simple-mode-workspace-a";
const WS_B = "simple-mode-workspace-b";
const OWNER_A = "simple-mode-owner-a";
const MEMBER_A = "simple-mode-member-a";
const OWNER_B = "simple-mode-owner-b";
const GOAL = "simple-mode-goal";

const INSTITUTION = "cat-institution-btg";
const INSTITUTION_2 = "cat-institution-bb";
const PORTFOLIO = "cat-class-aposentadoria";
/*
 * Categoria **semeada** no catálogo genérico — `category` com
 * `transactionSubtype: "investimento"`, que é Configurações › Cadastros ›
 * Categorias › Investimentos, a fonte visível desde a unificação. O
 * identificador é o mesmo que `seedLegacySettingsCatalog` grava, e é dele —
 * nunca do rótulo — que sai a classificação técnica.
 */
const CATEGORY = legacyCatalogSeedDocumentId(
  "category", "investimento", "both", "Tesouro Direto",
);
const CATEGORY_STOCK = legacyCatalogSeedDocumentId(
  "category", "investimento", "both", "Ações",
);
/** Categoria criada pelo usuário: sem autoridade técnica, cai em `other`. */
const CATEGORY_CUSTOM = "cat-category-personalizada";
/**
 * Categoria do grupo **histórico**.
 *
 * Continua aceita pelo backend: todo ativo e todo pendente aberto antes da
 * unificação aponta para um identificador deste grupo, e recusá-lo obrigaria
 * a recategorizar um lançamento só para corrigir a data dele.
 */
const CATEGORY_LEGACY = investmentCatalogSeedDocumentId(
  "investment_type", "both", "Renda fixa",
);
/*
 * Categorias do mesmo grupo `category` e de outros subtipos. Existem no
 * cadastro, o usuário as vê em Configurações, e nenhuma delas serve como
 * categoria de investimento.
 */
const CATEGORY_RECEITA = "cat-category-receita";
const CATEGORY_DESPESA = "cat-category-despesa";
const CATEGORY_PARCELADO = "cat-category-parcelado";
/** Categoria de investimento sem subtipo gravado: documento incoerente. */
const CATEGORY_SEM_SUBTIPO = "cat-category-sem-subtipo";
/** Categoria de investimento inativada depois de existir. */
const CATEGORY_INATIVA = "cat-category-inativa";
const INSTITUTION_B = "cat-institution-workspace-b";

const db = (): admin.firestore.Firestore => {
  if (!admin.apps.length) admin.initializeApp({projectId: PROJECT});
  return admin.firestore();
};

const auth = (
  workspaceId = WS_A,
  uid = OWNER_A,
  role: "owner" | "admin" | "member" = "owner",
): WorkspaceAuthorizationContext => ({workspaceId, uid, role});

const at = (iso: string) => Timestamp.fromDate(new Date(iso));

const catalogItem = async (
  workspaceId: string,
  id: string,
  group: string,
  name: string,
  status = "active",
  transactionSubtype?: string,
) => {
  const normalizedName = normalizeCatalogName(name);
  await db().doc(`workspaces/${workspaceId}/settings_catalog/${id}`).set({
    workspaceId, group, name,
    normalizedName,
    dedupeKey: [
      group, transactionSubtype ?? "all", "both", normalizedName,
    ].join("::"),
    workspaceScope: "both", sortOrder: 10, status,
    ...(transactionSubtype ? {transactionSubtype} : {}),
    createdBy: "seed", updatedBy: "seed",
    createdAt: at("2026-08-01T00:00:00.000Z"),
    updatedAt: at("2026-08-01T00:00:00.000Z"),
  });
};

/** Item de `category`, que é o único grupo que carrega subtipo. */
const categoryItem = (
  workspaceId: string,
  id: string,
  name: string,
  transactionSubtype = "investimento",
  status = "active",
) => catalogItem(workspaceId, id, "category", name, status, transactionSubtype);

const seed = async (): Promise<void> => {
  await Promise.all([
    db().recursiveDelete(db().doc(`workspaces/${WS_A}`)),
    db().recursiveDelete(db().doc(`workspaces/${WS_B}`)),
  ]);
  await db().doc(`workspaces/${WS_A}`).set({
    ownerId: OWNER_A, type: "PF", currency: "BRL", name: WS_A,
  });
  await db().doc(`workspaces/${WS_B}`).set({
    ownerId: OWNER_B, type: "PF", currency: "BRL", name: WS_B,
  });
  await Promise.all([
    db().doc(`workspaces/${WS_A}/members/${OWNER_A}`).set({
      uid: OWNER_A, role: "owner", status: "active",
    }),
    db().doc(`workspaces/${WS_A}/members/${MEMBER_A}`).set({
      uid: MEMBER_A, role: "member", status: "active",
    }),
    db().doc(`workspaces/${WS_B}/members/${OWNER_B}`).set({
      uid: OWNER_B, role: "owner", status: "active",
    }),
    db().doc(`workspaces/${WS_A}/goals/${GOAL}`).set({
      id: GOAL, workspaceId: WS_A, name: "Meta simples",
      progressBasis: "net_contributions",
      investmentNetContributionCents: 0,
      investmentCurrentValueCents: 0,
      investmentProgressCents: 0,
      investmentProjectionVersion: 0,
    }),
    catalogItem(WS_A, INSTITUTION, "investment_institution", "BTG"),
    catalogItem(WS_A, INSTITUTION_2, "investment_institution", "Banco do Brasil"),
    catalogItem(WS_A, PORTFOLIO, "investment_class", "Aposentadoria"),
    categoryItem(WS_A, CATEGORY, "Tesouro Direto"),
    categoryItem(WS_A, CATEGORY_STOCK, "Ações"),
    categoryItem(WS_A, CATEGORY_CUSTOM, "CDB"),
    categoryItem(WS_A, CATEGORY_INATIVA, "Previdência", "investimento", "inactive"),
    categoryItem(WS_A, CATEGORY_RECEITA, "Salário", "receita"),
    categoryItem(WS_A, CATEGORY_DESPESA, "Alimentação", "despesa"),
    categoryItem(WS_A, CATEGORY_PARCELADO, "Eletrônicos", "parcelado"),
    catalogItem(WS_A, CATEGORY_SEM_SUBTIPO, "category", "Sem subtipo"),
    // Grupo histórico: preservado e ainda aceito.
    catalogItem(WS_A, CATEGORY_LEGACY, "investment_type", "Renda fixa"),
    catalogItem(WS_B, INSTITUTION_B, "investment_institution", "XP"),
  ]);
};

interface NovoInvestimento {
  chave: string;
  descricao?: string;
  valorCents?: number;
  liquidado?: boolean;
  metaId?: string;
  instituicaoId?: string;
  categoriaId?: string;
  quando?: string;
  contexto?: WorkspaceAuthorizationContext;
  /** Aporte pendente que este lançamento substitui (correção do §11). */
  substitui?: string;
}

const novoInvestimento = (opcoes: NovoInvestimento) =>
  executeCreateSimpleInvestment(opcoes.contexto ?? auth(), {
    workspaceId: (opcoes.contexto ?? auth()).workspaceId,
    idempotencyKey: opcoes.chave,
    correlationId: `corr-${opcoes.chave}`,
    institutionId: opcoes.instituicaoId ?? INSTITUTION,
    classId: PORTFOLIO,
    typeId: opcoes.categoriaId ?? CATEGORY,
    description: opcoes.descricao ?? "Tesouro Selic 2029",
    valueCents: opcoes.valorCents ?? 100_000,
    settled: opcoes.liquidado ?? true,
    occurredAt: opcoes.quando ?? "2026-08-10T12:00:00.000Z",
    ...(opcoes.metaId ? {goalId: opcoes.metaId} : {}),
    ...(opcoes.substitui ? {replacesMovementId: opcoes.substitui} : {}),
    walletId: "wallet-a",
  });

const posicao = async (workspaceId: string, positionId: string) =>
  (await db().doc(
    `workspaces/${workspaceId}/investment_positions/${positionId}`,
  ).get()).data();

const movimento = async (workspaceId: string, movementId: string) =>
  (await db().doc(
    `workspaces/${workspaceId}/investment_movements/${movementId}`,
  ).get()).data();

const espelho = async (workspaceId: string, transactionId: string) =>
  (await db().doc(
    `workspaces/${workspaceId}/transactions/${transactionId}`,
  ).get()).data();

const meta = async () =>
  (await db().doc(`workspaces/${WS_A}/goals/${GOAL}`).get()).data();

const periodoCaixa = async (chave: string) =>
  (await db().doc(
    `workspaces/${WS_A}/cash_report_periods/${chave}`,
  ).get()).data();

/** Entrega do gatilho de transações, exatamente como `onTransactionWrite`. */
const entregarGatilho = async (
  eventId: string,
  transactionId: string,
  before: admin.firestore.DocumentData | undefined,
  after: admin.firestore.DocumentData | undefined,
) => db().runTransaction((tx) =>
  applyCashPeriodWriteOnce(
    tx, WS_A, cashPeriodEventKey(eventId), before, after,
    {transactionId, action: !before ? "CREATE" : !after ? "DELETE" : "UPDATE"},
  ));

const erro = async (executar: () => Promise<unknown>): Promise<string> => {
  try {
    await executar();
  } catch (falha) {
    return String((falha as Error).message);
  }
  throw new Error("A operação deveria ter falhado.");
};

// ---------------------------------------------------------------------------
// A. Instituições
// ---------------------------------------------------------------------------

test("a conta técnica é amarrada ao ID da instituição, não ao nome", async () => {
  await seed();

  const primeiro = await novoInvestimento({chave: "inst-key-0000000001"});
  const contaId = String(primeiro.accountId);
  const conta = (await db().doc(
    `workspaces/${WS_A}/investment_accounts/${contaId}`,
  ).get()).data();
  assert.equal(conta?.institutionId, INSTITUTION);
  assert.equal(conta?.institutionName, "BTG");

  // Renomear no cadastro não pode criar conta nova nem apagar histórico.
  await catalogItem(WS_A, INSTITUTION, "investment_institution", "BTG Pactual");
  const segundo = await novoInvestimento({
    chave: "inst-key-0000000002", descricao: "CDB pós-fixado",
  });

  assert.equal(segundo.accountId, contaId, "a instituição mudou de conta");
  const contas = await db()
    .collection(`workspaces/${WS_A}/investment_accounts`).get();
  assert.equal(contas.size, 1, "renomear duplicou a conta da instituição");

  const contaDepois = (await db().doc(
    `workspaces/${WS_A}/investment_accounts/${contaId}`,
  ).get()).data();
  assert.equal(contaDepois?.institutionName, "BTG Pactual");
  assert.equal(contaDepois?.institutionId, INSTITUTION);

  // O histórico guarda o rótulo do instante em que foi escrito.
  const antigo = await movimento(WS_A, String(primeiro.movementId));
  assert.equal(antigo?.institutionName, "BTG");
  const novo = await movimento(WS_A, String(segundo.movementId));
  assert.equal(novo?.institutionName, "BTG Pactual");
  assert.equal(antigo?.institutionId, novo?.institutionId);
});

test("instituição inativa e de outro workspace são recusadas", async () => {
  await seed();

  await catalogItem(
    WS_A, INSTITUTION_2, "investment_institution", "Banco do Brasil",
    "inactive",
  );
  assert.match(
    await erro(() => novoInvestimento({
      chave: "inst-key-0000000003", instituicaoId: INSTITUTION_2,
    })),
    /inativa/i,
  );

  // Isolamento: o item existe, mas em outro tenant.
  assert.match(
    await erro(() => novoInvestimento({
      chave: "inst-key-0000000004", instituicaoId: INSTITUTION_B,
    })),
    /não encontrada/i,
  );

  // E o grupo é conferido: uma carteira não pode passar por instituição.
  assert.match(
    await erro(() => novoInvestimento({
      chave: "inst-key-0000000005", instituicaoId: PORTFOLIO,
    })),
    /não é uma instituição/i,
  );
});

// ---------------------------------------------------------------------------
// B. Identidade do investimento e idempotência
// ---------------------------------------------------------------------------

test("cada novo investimento tem identidade própria; retry não duplica", async () => {
  await seed();

  const um = await novoInvestimento({
    chave: "ident-key-000000001", descricao: "Reserva",
  });
  const dois = await novoInvestimento({
    chave: "ident-key-000000002", descricao: "Reserva",
  });

  assert.notEqual(
    um.assetId, dois.assetId,
    "descrição igual não pode fundir dois investimentos distintos",
  );
  assert.notEqual(um.positionId, dois.positionId);
  assert.equal(um.accountId, dois.accountId, "a conta é por instituição");

  // Retry/duplo clique: mesma chave devolve o mesmo resultado sem escrever.
  const replay = await novoInvestimento({
    chave: "ident-key-000000001", descricao: "Reserva",
  });
  assert.equal(replay.movementId, um.movementId);
  assert.equal(replay.assetId, um.assetId);

  const ativos = await db()
    .collection(`workspaces/${WS_A}/investment_assets`).get();
  assert.equal(ativos.size, 2, "o replay criou um ativo a mais");
  const movimentos = await db()
    .collection(`workspaces/${WS_A}/investment_movements`).get();
  assert.equal(movimentos.size, 2, "o replay criou um movimento a mais");
});

test("o ativo criado guarda carteira, categoria e regime por valor", async () => {
  await seed();
  const criado = await novoInvestimento({chave: "asset-key-000000001"});
  const ativo = (await db().doc(
    `workspaces/${WS_A}/investment_assets/${criado.assetId}`,
  ).get()).data();

  assert.equal(ativo?.classId, PORTFOLIO);
  assert.equal(ativo?.className, "Aposentadoria");
  assert.equal(ativo?.typeId, CATEGORY);
  assert.equal(ativo?.typeName, "Tesouro Direto");
  assert.equal(ativo?.trackingMode, "value");
  // O enum técnico vem do identificador da categoria semeada, nunca do
  // rótulo, e nunca é pedido ao usuário.
  assert.equal(ativo?.assetType, "fixed_income");
  assert.equal(ativo?.allocationPurpose, "unassigned");
});

// ---------------------------------------------------------------------------
// C. Aporte liquidado
// ---------------------------------------------------------------------------

test("aporte liquidado aumenta posição, reduz caixa e move a meta uma vez", async () => {
  await seed();

  const criado = await novoInvestimento({
    chave: "settled-key-00000001", valorCents: 150_000, metaId: GOAL,
  });

  const estado = await posicao(WS_A, String(criado.positionId));
  assert.equal(estado?.principalCents, 150_000);
  assert.equal(estado?.currentValueCents, 150_000);
  assert.equal(
    estado?.quantityMicros, 150_000 * VALUE_MODE_MICROS_PER_CENT,
  );
  assert.equal(estado?.goalId, GOAL);

  const progresso = await meta();
  assert.equal(progresso?.investmentNetContributionCents, 150_000);
  assert.equal(progresso?.investmentProgressCents, 150_000);

  const mov = await movimento(WS_A, String(criado.movementId));
  assert.equal(mov?.status, "settled");
  assert.equal(mov?.cashDeltaCents, -150_000);
  assert.equal(mov?.goalNetContributionDeltaCents, 150_000);

  // Espelho de caixa: saída de investimento, nunca despesa.
  const projecao = await espelho(WS_A, String(criado.transactionId));
  assert.equal(projecao?.type, "investimento");
  assert.equal(projecao?.isPaid, true);
  assert.equal(projecao?.investmentMetadata?.cashImpact, "outflow");
  assert.equal(projecao?.investmentMetadata?.status, "settled");

  // O gatilho de caixa aplica a saída uma vez e não toca a meta.
  await entregarGatilho(
    "evt-settled-1", String(criado.transactionId), undefined, projecao,
  );
  assert.equal((await periodoCaixa("2026-08"))?.investmentOutflowCents, 150_000);
  assert.equal((await meta())?.investmentNetContributionCents, 150_000);

  // Reentrega do mesmo evento não soma de novo.
  await entregarGatilho(
    "evt-settled-1", String(criado.transactionId), undefined, projecao,
  );
  assert.equal((await periodoCaixa("2026-08"))?.investmentOutflowCents, 150_000);
});

// ---------------------------------------------------------------------------
// D. Aporte pendente
// ---------------------------------------------------------------------------

test("aporte pendente não move caixa, posição nem meta", async () => {
  await seed();

  const criado = await novoInvestimento({
    chave: "pending-key-00000001", valorCents: 90_000, metaId: GOAL,
    liquidado: false,
  });

  assert.equal(criado.status, "pending");
  assert.equal(
    (await posicao(WS_A, String(criado.positionId))), undefined,
    "aporte pendente criou posição",
  );
  const progresso = await meta();
  assert.equal(progresso?.investmentNetContributionCents, 0);
  assert.equal(progresso?.investmentProgressCents, 0);

  const mov = await movimento(WS_A, String(criado.movementId));
  assert.equal(mov?.status, "pending");
  for (const campo of [
    "cashDeltaCents", "principalDeltaCents", "realizedGainDeltaCents",
    "feesDeltaCents", "taxDeltaCents", "quantityDeltaMicros",
    "goalNetContributionDeltaCents", "goalCurrentValueDeltaCents",
    "currentValueDeltaCents",
  ]) {
    assert.equal(mov?.[campo], 0, `${campo} deveria ser zero no pendente`);
  }
  assert.equal(mov?.settledAt, undefined);
  // A intenção de meta é preservada para a liquidação, sem efeito nenhum.
  assert.equal(mov?.goalId, GOAL);

  const projecao = await espelho(WS_A, String(criado.transactionId));
  assert.equal(projecao?.isPaid, false);
  assert.equal(projecao?.investmentMetadata?.cashImpact, "none");
  assert.equal(projecao?.investmentMetadata?.status, "pending");

  await entregarGatilho(
    "evt-pending-1", String(criado.transactionId), undefined, projecao,
  );
  assert.equal(await periodoCaixa("2026-08"), undefined);

  // Resumo patrimonial não conhece o pendente.
  const resumo = (await db().doc(
    `workspaces/${WS_A}/investment_summaries/current`,
  ).get()).data();
  assert.equal(resumo, undefined);
});

test("liquidar o aporte pendente aplica os efeitos exatamente uma vez", async () => {
  await seed();

  const criado = await novoInvestimento({
    chave: "settle-key-000000001", valorCents: 90_000, metaId: GOAL,
    liquidado: false,
  });

  const liquidar = () => executeSettleInvestmentContribution(auth(), {
    workspaceId: WS_A,
    idempotencyKey: "settle-key-000000002",
    correlationId: "corr-settle-000000002",
    movementId: String(criado.movementId),
    settledAt: "2026-08-15T12:00:00.000Z",
  });

  const resultado = await liquidar();
  assert.equal(resultado.status, "settled");

  const estado = await posicao(WS_A, String(criado.positionId));
  assert.equal(estado?.principalCents, 90_000);
  assert.equal(estado?.quantityMicros, 90_000 * VALUE_MODE_MICROS_PER_CENT);
  assert.equal((await meta())?.investmentNetContributionCents, 90_000);

  const mov = await movimento(WS_A, String(criado.movementId));
  assert.equal(mov?.status, "settled");
  assert.equal(mov?.cashDeltaCents, -90_000);
  // `occurredAt` é o registro; `settlementAt` é o efeito de caixa.
  assert.equal(
    (mov?.occurredAt as Timestamp).toDate().toISOString(),
    "2026-08-10T12:00:00.000Z",
  );
  assert.equal(
    (mov?.settlementAt as Timestamp).toDate().toISOString(),
    "2026-08-15T12:00:00.000Z",
  );

  // Replay da mesma intenção: devolve o resultado, sem somar de novo.
  const replay = await liquidar();
  assert.equal(replay.status, "settled");
  assert.equal(
    (await posicao(WS_A, String(criado.positionId)))?.principalCents, 90_000,
  );
  assert.equal((await meta())?.investmentNetContributionCents, 90_000);

  // Segunda liquidação com intenção nova é recusada.
  assert.match(
    await erro(() => executeSettleInvestmentContribution(auth(), {
      workspaceId: WS_A,
      idempotencyKey: "settle-key-000000003",
      correlationId: "corr-settle-000000003",
      movementId: String(criado.movementId),
      settledAt: "2026-08-16T12:00:00.000Z",
    })),
    /somente um aporte pendente pode ser liquidado/i,
  );
});

test("aporte pendente é cancelável e o documento é preservado", async () => {
  await seed();

  const criado = await novoInvestimento({
    chave: "cancel-key-000000001", metaId: GOAL, liquidado: false,
  });

  await executeCancelInvestmentMovement(auth(), {
    workspaceId: WS_A,
    idempotencyKey: "cancel-key-000000002",
    correlationId: "corr-cancel-000000002",
    movementId: String(criado.movementId),
    occurredAt: "2026-08-11T12:00:00.000Z",
    reason: "Depósito não aconteceu.",
  });

  const mov = await movimento(WS_A, String(criado.movementId));
  assert.ok(mov, "cancelamento apagou o movimento");
  assert.equal(mov?.status, "cancelled");
  assert.equal(mov?.cashDeltaCents, 0);
  assert.equal((await meta())?.investmentNetContributionCents, 0);
  assert.equal(await posicao(WS_A, String(criado.positionId)), undefined);

  /*
   * O ativo técnico do investimento cancelado **permanece**: ele é referenciado
   * pelo movimento preservado, e apagá-lo seria hard delete de histórico. A
   * listagem futura distingue pelo que já existe — sem posição, o investimento
   * não aparece entre os ativos patrimoniais.
   */
  const ativo = await db().doc(
    `workspaces/${WS_A}/investment_assets/${criado.assetId}`,
  ).get();
  assert.equal(ativo.exists, true, "cancelar apagou o cadastro do ativo");
  assert.equal(ativo.data()?.status, "active");

  // Um cancelado não pode ser liquidado depois.
  assert.match(
    await erro(() => executeSettleInvestmentContribution(auth(), {
      workspaceId: WS_A,
      idempotencyKey: "cancel-key-000000003",
      correlationId: "corr-cancel-000000003",
      movementId: String(criado.movementId),
      settledAt: "2026-08-12T12:00:00.000Z",
    })),
    /somente um aporte pendente pode ser liquidado/i,
  );
});

// ---------------------------------------------------------------------------
// E/F. Retirada
// ---------------------------------------------------------------------------

test("retirada pendente não produz efeito patrimonial nem de caixa", async () => {
  await seed();

  const criado = await novoInvestimento({
    chave: "wpend-key-000000001", valorCents: 200_000, metaId: GOAL,
  });

  const retirada = await executeWithdrawSimpleInvestment(auth(), {
    workspaceId: WS_A,
    idempotencyKey: "wpend-key-000000002",
    correlationId: "corr-wpend-000000002",
    positionId: String(criado.positionId),
    valueCents: 50_000,
    received: false,
    occurredAt: "2026-08-20T12:00:00.000Z",
  });

  assert.equal(retirada.status, "pending");
  const estado = await posicao(WS_A, String(criado.positionId));
  assert.equal(estado?.principalCents, 200_000);
  assert.equal((await meta())?.investmentNetContributionCents, 200_000);

  const mov = await movimento(WS_A, String(retirada.movementId));
  assert.equal(mov?.operation, "redemption");
  assert.equal(mov?.status, "pending");
  assert.equal(mov?.cashDeltaCents, 0);
  assert.equal(mov?.goalNetContributionDeltaCents, 0);

  const projecao = await espelho(WS_A, String(retirada.transactionId));
  assert.equal(projecao?.isPaid, false);
  assert.equal(projecao?.investmentMetadata?.cashImpact, "none");
  assert.equal(projecao?.type, "investimento", "retirada virou receita");
});

test("retirada recebida reduz investimento, devolve caixa e reduz a meta", async () => {
  await seed();

  const criado = await novoInvestimento({
    chave: "wsett-key-000000001", valorCents: 200_000, metaId: GOAL,
  });

  const retirar = () => executeWithdrawSimpleInvestment(auth(), {
    workspaceId: WS_A,
    idempotencyKey: "wsett-key-000000002",
    correlationId: "corr-wsett-000000002",
    positionId: String(criado.positionId),
    valueCents: 50_000,
    received: true,
    occurredAt: "2026-08-20T12:00:00.000Z",
    walletId: "wallet-a",
  });

  const retirada = await retirar();
  assert.equal(retirada.status, "settled");
  assert.equal(retirada.cashDeltaCents, 50_000);

  const estado = await posicao(WS_A, String(criado.positionId));
  assert.equal(estado?.principalCents, 150_000);
  assert.equal(estado?.quantityMicros, 150_000 * VALUE_MODE_MICROS_PER_CENT);
  assert.equal(estado?.realizedGainCents, 0, "ganho foi inventado");
  assert.equal(estado?.realizedLossCents, 0, "perda foi inventada");
  assert.equal((await meta())?.investmentNetContributionCents, 150_000);

  const mov = await movimento(WS_A, String(retirada.movementId));
  assert.equal(mov?.gainCents, 0);
  assert.equal(mov?.lossCents, 0);
  assert.equal(mov?.feesCents, 0);
  assert.equal(mov?.taxCents, 0);
  assert.equal(mov?.goalNetContributionDeltaCents, -50_000);

  // Entrada de caixa que não é receita.
  const projecao = await espelho(WS_A, String(retirada.transactionId));
  assert.equal(projecao?.type, "investimento");
  assert.equal(projecao?.investmentMetadata?.cashImpact, "inflow");
  await entregarGatilho(
    "evt-withdraw-1", String(retirada.transactionId), undefined, projecao,
  );
  const periodo = await periodoCaixa("2026-08");
  assert.equal(periodo?.incomeCents ?? 0, 0, "principal virou receita");

  // Retry não duplica.
  await retirar();
  assert.equal(
    (await posicao(WS_A, String(criado.positionId)))?.principalCents, 150_000,
  );
  assert.equal((await meta())?.investmentNetContributionCents, 150_000);
});

test("a retirada recusa valor acima do capital investido", async () => {
  await seed();
  const criado = await novoInvestimento({
    chave: "wover-key-000000001", valorCents: 100_000,
  });

  assert.match(
    await erro(() => executeWithdrawSimpleInvestment(auth(), {
      workspaceId: WS_A,
      idempotencyKey: "wover-key-000000002",
      correlationId: "corr-wover-000000002",
      positionId: String(criado.positionId),
      valueCents: 100_001,
      received: true,
      occurredAt: "2026-08-20T12:00:00.000Z",
    })),
    /supera o capital investido/i,
  );
  assert.equal(
    (await posicao(WS_A, String(criado.positionId)))?.principalCents, 100_000,
  );
});

// ---------------------------------------------------------------------------
// G. Histórico e correção
// ---------------------------------------------------------------------------

test("corrigir um aporte liquidado usa estorno e preserva o original", async () => {
  await seed();
  const criado = await novoInvestimento({
    chave: "rev-key-00000000001", valorCents: 100_000, metaId: GOAL,
  });

  const estorno = await executeReverseInvestmentMovement(auth(), {
    workspaceId: WS_A,
    idempotencyKey: "rev-key-00000000002",
    correlationId: "corr-rev-00000000002",
    movementId: String(criado.movementId),
    reversedAt: "2026-08-12T12:00:00.000Z",
    reason: "Valor lançado errado.",
  });

  const original = await movimento(WS_A, String(criado.movementId));
  assert.ok(original, "estorno apagou o movimento original");
  assert.equal(original?.status, "settled");
  assert.equal(original?.reversedByMovementId, estorno.reversalMovementId);

  const compensatorio = await movimento(
    WS_A, String(estorno.reversalMovementId),
  );
  assert.equal(compensatorio?.operation, "reversal");
  // O estorno herda a fotografia de apresentação do movimento estornado.
  assert.equal(compensatorio?.institutionName, "BTG");
  assert.equal(compensatorio?.className, "Aposentadoria");

  assert.equal(
    (await posicao(WS_A, String(criado.positionId)))?.principalCents, 0,
  );
  assert.equal((await meta())?.investmentNetContributionCents, 0);
});

// ---------------------------------------------------------------------------
// H. Regime por valor
// ---------------------------------------------------------------------------

test(
  "a quantidade permanece proporcional ao custo em aportes e retiradas",
  async () => {
    await seed();

    const criado = await novoInvestimento({
      chave: "value-key-00000001", valorCents: 100_000,
    });
    const positionId = String(criado.positionId);

    // Aporte adicional pelo identificador do investimento, sem quantidade.
    await executeCreateInvestmentContribution(auth(), {
      workspaceId: WS_A,
      idempotencyKey: "value-key-00000002",
      correlationId: "corr-value-00000002",
      positionId,
      description: "Aporte mensal",
      principalCents: 50_000,
      feesCents: 0,
      taxCents: 0,
      occurredAt: "2026-08-12T12:00:00.000Z",
    });
    let estado = await posicao(WS_A, positionId);
    assert.equal(estado?.principalCents, 150_000);
    assert.equal(
      estado?.quantityMicros, 150_000 * VALUE_MODE_MICROS_PER_CENT,
    );

    await executeWithdrawSimpleInvestment(auth(), {
      workspaceId: WS_A,
      idempotencyKey: "value-key-00000003",
      correlationId: "corr-value-00000003",
      positionId,
      valueCents: 30_000,
      received: true,
      occurredAt: "2026-08-14T12:00:00.000Z",
    });
    estado = await posicao(WS_A, positionId);
    assert.equal(estado?.principalCents, 120_000);
    assert.equal(
      estado?.quantityMicros, 120_000 * VALUE_MODE_MICROS_PER_CENT,
    );

    // Encerramento: custo e quantidade zeram no mesmo movimento.
    await executeWithdrawSimpleInvestment(auth(), {
      workspaceId: WS_A,
      idempotencyKey: "value-key-00000004",
      correlationId: "corr-value-00000004",
      positionId,
      valueCents: 120_000,
      received: true,
      occurredAt: "2026-08-16T12:00:00.000Z",
    });
    estado = await posicao(WS_A, positionId);
    assert.equal(estado?.principalCents, 0);
    assert.equal(estado?.quantityMicros, 0);
    assert.equal(estado?.currentValueCents, 0);
  },
);

test("operação quantitativa incompatível é recusada no ativo simples", async () => {
  await seed();
  const criado = await novoInvestimento({chave: "guard-key-00000001"});

  // Valoração a mercado reinterpretaria a cota sintética.
  assert.match(
    await erro(() => executeRecordInvestmentValuation(auth(), {
      workspaceId: WS_A,
      idempotencyKey: "guard-key-00000002",
      correlationId: "corr-guard-00000002",
      accountId: String(criado.accountId),
      assetId: String(criado.assetId),
      unitPriceMicros: 1_100_000,
      source: "manual",
      effectiveAt: "2026-08-12T12:00:00.000Z",
      reason: "Marcação a mercado",
    })),
    /controlado por valor/i,
  );

  // Aporte com quantidade explícita quebraria a proporção.
  assert.match(
    await erro(() => executeCreateInvestmentContribution(auth(), {
      workspaceId: WS_A,
      idempotencyKey: "guard-key-00000003",
      correlationId: "corr-guard-00000003",
      positionId: String(criado.positionId),
      description: "Aporte com quantidade",
      principalCents: 10_000,
      quantityMicros: 7,
      feesCents: 0,
      taxCents: 0,
      occurredAt: "2026-08-12T12:00:00.000Z",
    })),
    /não aceita quantidade/i,
  );

  assert.equal(
    (await posicao(WS_A, String(criado.positionId)))?.quantityMicros,
    100_000 * VALUE_MODE_MICROS_PER_CENT,
  );
});

test("o investimento quantitativo existente não é afetado", async () => {
  await seed();
  const now = at("2026-08-01T00:00:00.000Z");
  await db().doc(`workspaces/${WS_A}/investment_accounts/legacy-account`).set({
    id: "legacy-account", workspaceId: WS_A, profileType: "PF",
    name: "Corretora antiga", institutionName: "Corretora antiga",
    currency: "BRL", status: "active",
    createdBy: "seed", updatedBy: "seed", createdAt: now, updatedAt: now,
  });
  await db().doc(`workspaces/${WS_A}/investment_assets/legacy-asset`).set({
    id: "legacy-asset", workspaceId: WS_A, profileType: "PF",
    name: "Ativo com cotas", assetType: "fund",
    allocationPurpose: "unassigned",
    currency: "BRL", status: "active",
    createdBy: "seed", updatedBy: "seed", createdAt: now, updatedAt: now,
  });

  // Sem `trackingMode`, o ativo continua quantitativo: exige quantidade.
  const aporte = await executeCreateInvestmentContribution(auth(), {
    workspaceId: WS_A,
    idempotencyKey: "legacy-key-0000001",
    correlationId: "corr-legacy-0000001",
    accountId: "legacy-account", assetId: "legacy-asset",
    description: "Aporte com cotas",
    principalCents: 100_000, quantityMicros: 250_000,
    feesCents: 0, taxCents: 0,
    occurredAt: "2026-08-10T12:00:00.000Z",
  });
  const estado = await posicao(WS_A, String(aporte.positionId));
  assert.equal(estado?.quantityMicros, 250_000);

  // Valoração continua permitida e altera só o valor de mercado.
  await executeRecordInvestmentValuation(auth(), {
    workspaceId: WS_A,
    idempotencyKey: "legacy-key-0000002",
    correlationId: "corr-legacy-0000002",
    accountId: "legacy-account", assetId: "legacy-asset",
    unitPriceMicros: 500_000_000,
    source: "manual",
    effectiveAt: "2026-08-12T12:00:00.000Z",
    reason: "Marcação a mercado",
  });
  // 0,25 unidade a R$ 500,00 = R$ 125,00. O custo não se move.
  const valorado = await posicao(WS_A, String(aporte.positionId));
  assert.equal(valorado?.principalCents, 100_000);
  assert.equal(valorado?.currentValueCents, 12_500);

  // E a retirada simples recusa esse ativo em vez de inventar quantidade.
  assert.match(
    await erro(() => executeWithdrawSimpleInvestment(auth(), {
      workspaceId: WS_A,
      idempotencyKey: "legacy-key-0000003",
      correlationId: "corr-legacy-0000003",
      positionId: String(aporte.positionId),
      valueCents: 10_000,
      received: true,
      occurredAt: "2026-08-14T12:00:00.000Z",
    })),
    /controlado por quantidade/i,
  );
});

// ---------------------------------------------------------------------------
// I. Multi-tenant e RBAC
// ---------------------------------------------------------------------------

test("isolamento entre workspaces e matriz de papéis preservada", async () => {
  await seed();

  // Membro registra e retira: são operações do dia a dia.
  const contexto = auth(WS_A, MEMBER_A, "member");
  const criado = await novoInvestimento({
    chave: "rbac-key-000000001", contexto, metaId: GOAL,
  });
  assert.equal(criado.status, "settled");

  await executeWithdrawSimpleInvestment(contexto, {
    workspaceId: WS_A,
    idempotencyKey: "rbac-key-000000002",
    correlationId: "corr-rbac-000000002",
    positionId: String(criado.positionId),
    valueCents: 10_000,
    received: true,
    occurredAt: "2026-08-20T12:00:00.000Z",
  });
  assert.equal(
    (await posicao(WS_A, String(criado.positionId)))?.principalCents, 90_000,
  );

  // Estorno de fato liquidado continua restrito a owner/admin.
  assert.match(
    await erro(() => executeReverseInvestmentMovement(contexto, {
      workspaceId: WS_A,
      idempotencyKey: "rbac-key-000000003",
      correlationId: "corr-rbac-000000003",
      movementId: String(criado.movementId),
      reversedAt: "2026-08-21T12:00:00.000Z",
      reason: "Tentativa de correção por membro.",
    })),
    /papel|role|permiss/i,
  );

  // O dono do workspace B não alcança a posição do workspace A.
  assert.match(
    await erro(() => executeWithdrawSimpleInvestment(auth(WS_B, OWNER_B), {
      workspaceId: WS_B,
      idempotencyKey: "rbac-key-000000004",
      correlationId: "corr-rbac-000000004",
      positionId: String(criado.positionId),
      valueCents: 10_000,
      received: true,
      occurredAt: "2026-08-20T12:00:00.000Z",
    })),
    /investimento/i,
  );
  assert.equal(
    (await posicao(WS_A, String(criado.positionId)))?.principalCents, 90_000,
  );
});

test(
  "aporte pendente em investimento existente só entra na liquidação",
  async () => {
    await seed();

    const criado = await novoInvestimento({
      chave: "extra-key-000000001", valorCents: 100_000, metaId: GOAL,
    });
    const positionId = String(criado.positionId);

    const pendente = await executeCreateInvestmentContribution(auth(), {
      workspaceId: WS_A,
      idempotencyKey: "extra-key-000000002",
      correlationId: "corr-extra-000000002",
      positionId,
      description: "Aporte agendado",
      principalCents: 40_000,
      feesCents: 0,
      taxCents: 0,
      settled: false,
      occurredAt: "2026-08-25T12:00:00.000Z",
    });
    assert.equal(pendente.status, "pending");

    // Nada mudou: nem posição, nem meta, nem quantidade.
    let estado = await posicao(WS_A, positionId);
    assert.equal(estado?.principalCents, 100_000);
    assert.equal(estado?.quantityMicros, 100_000 * VALUE_MODE_MICROS_PER_CENT);
    assert.equal((await meta())?.investmentNetContributionCents, 100_000);

    await executeSettleInvestmentContribution(auth(), {
      workspaceId: WS_A,
      idempotencyKey: "extra-key-000000003",
      correlationId: "corr-extra-000000003",
      movementId: String(pendente.movementId),
      settledAt: "2026-08-28T12:00:00.000Z",
    });

    estado = await posicao(WS_A, positionId);
    assert.equal(estado?.principalCents, 140_000);
    assert.equal(estado?.quantityMicros, 140_000 * VALUE_MODE_MICROS_PER_CENT);
    assert.equal((await meta())?.investmentNetContributionCents, 140_000);

    // O espelho de caixa migrou de pendente para liquidado no mesmo documento.
    const projecao = await espelho(WS_A, String(pendente.transactionId));
    assert.equal(projecao?.isPaid, true);
    assert.equal(projecao?.investmentMetadata?.cashImpact, "outflow");
    assert.equal(projecao?.date, "2026-08-28");
  },
);

test(
  "a liquidação reavalia a meta da posição no instante em que aplica",
  async () => {
    await seed();
    await db().doc(`workspaces/${WS_A}/goals/outra-meta`).set({
      id: "outra-meta", workspaceId: WS_A, name: "Outra meta",
      progressBasis: "net_contributions",
      investmentNetContributionCents: 0,
      investmentCurrentValueCents: 0,
      investmentProgressCents: 0,
      investmentProjectionVersion: 0,
    });

    // Investimento registrado como pendente, com a intenção de vincular a GOAL.
    const criado = await novoInvestimento({
      chave: "goalrace-key-0000001", valorCents: 50_000, metaId: GOAL,
      liquidado: false,
    });

    /*
     * Antes da liquidação, a posição nasce por outro aporte, ligada a outra
     * meta. Liquidar aplicaria o progresso na meta errada.
     *
     * O alvo aqui é o par conta/ativo, e não `positionId`: um investimento
     * ainda pendente **não tem posição**, e é justamente essa a corrida que o
     * teste reproduz.
     */
    await executeCreateInvestmentContribution(auth(), {
      workspaceId: WS_A,
      idempotencyKey: "goalrace-key-0000002",
      correlationId: "corr-goalrace-0000002",
      accountId: String(criado.accountId),
      assetId: String(criado.assetId),
      goalId: "outra-meta",
      description: "Aporte que cria a posição",
      principalCents: 10_000,
      feesCents: 0,
      taxCents: 0,
      occurredAt: "2026-08-11T12:00:00.000Z",
    });

    assert.match(
      await erro(() => executeSettleInvestmentContribution(auth(), {
        workspaceId: WS_A,
        idempotencyKey: "goalrace-key-0000003",
        correlationId: "corr-goalrace-0000003",
        movementId: String(criado.movementId),
        settledAt: "2026-08-15T12:00:00.000Z",
      })),
      /já está vinculada a outra meta/i,
    );

    // Nenhuma das duas metas foi tocada pela tentativa recusada.
    assert.equal((await meta())?.investmentNetContributionCents, 0);
    const outra = (await db().doc(
      `workspaces/${WS_A}/goals/outra-meta`,
    ).get()).data();
    assert.equal(outra?.investmentNetContributionCents, 10_000);
  },
);

// ---------------------------------------------------------------------------
// Hardening — retirada com rendimento
// ---------------------------------------------------------------------------

const retirar = (
  positionId: string,
  chave: string,
  valorCents: number,
  extras: {
    rendimentoCents?: number;
    recebido?: boolean;
    quando?: string;
    contexto?: WorkspaceAuthorizationContext;
  } = {},
) =>
  executeWithdrawSimpleInvestment(extras.contexto ?? auth(), {
    workspaceId: (extras.contexto ?? auth()).workspaceId,
    idempotencyKey: chave,
    correlationId: `corr-${chave}`,
    positionId,
    valueCents: valorCents,
    ...(extras.rendimentoCents === undefined ?
      {} :
      {gainCents: extras.rendimentoCents}),
    received: extras.recebido ?? true,
    occurredAt: extras.quando ?? "2026-08-20T12:00:00.000Z",
    walletId: "wallet-a",
  });

test("retirada de capital sem rendimento não infla receita operacional", async () => {
  await seed();
  const criado = await novoInvestimento({
    chave: "gain0-key-000000001", valorCents: 1_000_000, metaId: GOAL,
  });

  const retirada = await retirar(
    String(criado.positionId), "gain0-key-000000002", 1_000_000,
  );
  assert.equal(retirada.principalCents, 1_000_000);
  assert.equal(retirada.gainCents, 0);
  assert.equal(retirada.cashDeltaCents, 1_000_000);

  const estado = await posicao(WS_A, String(criado.positionId));
  assert.equal(estado?.principalCents, 0);
  assert.equal(estado?.quantityMicros, 0);
  assert.equal(estado?.realizedGainCents, 0);
  assert.equal((await meta())?.investmentNetContributionCents, 0);

  const projecao = await espelho(WS_A, String(retirada.transactionId));
  assert.equal(projecao?.type, "investimento");
  assert.equal(projecao?.investmentMetadata?.cashImpact, "inflow");
  await entregarGatilho(
    "evt-gain0", String(retirada.transactionId), undefined, projecao,
  );
  /*
   * A projeção de caixa não tem balde de "entrada de investimento": um resgate
   * liquidado soma em `netCents` e é deliberadamente mantido fora de
   * `incomeCents`, que é a receita operacional. É essa assimetria que impede o
   * principal resgatado de inflar receita.
   */
  const periodo = await periodoCaixa("2026-08");
  assert.equal(periodo?.incomeCents ?? 0, 0, "principal virou receita");
  assert.equal(periodo?.expenseCents ?? 0, 0);
  assert.equal(periodo?.investmentOutflowCents ?? 0, 0);
  assert.equal(periodo?.netCents, 1_000_000);
});

test(
  "retirada de 11.000 com 1.000 de rendimento separa capital e ganho",
  async () => {
    await seed();
    const criado = await novoInvestimento({
      chave: "gain1-key-000000001", valorCents: 1_000_000, metaId: GOAL,
    });

    const retirada = await retirar(
      String(criado.positionId), "gain1-key-000000002", 1_100_000,
      {rendimentoCents: 100_000},
    );
    assert.equal(retirada.principalCents, 1_000_000);
    assert.equal(retirada.gainCents, 100_000);
    assert.equal(retirada.cashDeltaCents, 1_100_000);

    // Posição: só o capital sai; o rendimento vira ganho realizado.
    const estado = await posicao(WS_A, String(criado.positionId));
    assert.equal(estado?.principalCents, 0);
    assert.equal(estado?.quantityMicros, 0);
    assert.equal(estado?.realizedGainCents, 100_000);
    assert.equal(estado?.realizedLossCents, 0);

    // Meta mede capital aportado: rendimento retirado nunca foi aporte.
    assert.equal((await meta())?.investmentNetContributionCents, 0);

    const mov = await movimento(WS_A, String(retirada.movementId));
    assert.equal(mov?.principalCents, 1_000_000);
    assert.equal(mov?.gainCents, 100_000);
    assert.equal(mov?.lossCents, 0);
    assert.equal(mov?.feesCents, 0);
    assert.equal(mov?.taxCents, 0);
    assert.equal(mov?.cashDeltaCents, 1_100_000);
    assert.equal(mov?.principalDeltaCents, -1_000_000);
    assert.equal(mov?.realizedGainDeltaCents, 100_000);
    assert.equal(mov?.goalNetContributionDeltaCents, -1_000_000);

    // Relatório: capital e ganho em campos próprios.
    const periodo = (await db().doc(
      `workspaces/${WS_A}/investment_report_periods/2026-08`,
    ).get()).data();
    assert.equal(periodo?.redemptionPrincipalCents, 1_000_000);
    assert.equal(periodo?.realizedGainCents, 100_000);
    assert.equal(periodo?.realizedLossCents ?? 0, 0);
    assert.equal(periodo?.contributionCents, 1_000_000);

    const resumo = (await db().doc(
      `workspaces/${WS_A}/investment_summaries/current`,
    ).get()).data();
    assert.equal(resumo?.principalCents, 0);
    assert.equal(resumo?.realizedGainCents, 100_000);

    // Caixa recebe o total, e nada disso é receita operacional.
    const projecao = await espelho(WS_A, String(retirada.transactionId));
    assert.equal(projecao?.valueCents, 1_100_000);
    await entregarGatilho(
      "evt-gain1", String(retirada.transactionId), undefined, projecao,
    );
    const caixa = await periodoCaixa("2026-08");
    assert.equal(caixa?.incomeCents ?? 0, 0, "o total recebido virou receita");
    assert.equal(caixa?.expenseCents ?? 0, 0);
    assert.equal(caixa?.netCents, 1_100_000);
  },
);

test("retirada acima do capital sem informar rendimento é recusada", async () => {
  await seed();
  const criado = await novoInvestimento({
    chave: "gain2-key-000000001", valorCents: 1_000_000,
  });

  const mensagem = await erro(() => retirar(
    String(criado.positionId), "gain2-key-000000002", 1_100_000,
  ));
  assert.match(mensagem, /supera o capital investido/i);
  assert.match(mensagem, /informe quanto/i);

  // Nada foi alterado pela tentativa recusada.
  assert.equal(
    (await posicao(WS_A, String(criado.positionId)))?.principalCents,
    1_000_000,
  );
  // E o rendimento informado não pode superar o próprio total retirado.
  assert.match(
    await erro(() => retirar(
      String(criado.positionId), "gain2-key-000000003", 50_000,
      {rendimentoCents: 60_000},
    )),
    /não pode superar o valor total retirado/i,
  );
});

test("retirada parcial com rendimento reduz só o capital informado", async () => {
  await seed();
  const criado = await novoInvestimento({
    chave: "gain3-key-000000001", valorCents: 1_000_000, metaId: GOAL,
  });

  const retirada = await retirar(
    String(criado.positionId), "gain3-key-000000002", 500_000,
    {rendimentoCents: 50_000},
  );
  assert.equal(retirada.principalCents, 450_000);
  assert.equal(retirada.gainCents, 50_000);
  assert.equal(retirada.cashDeltaCents, 500_000);

  const estado = await posicao(WS_A, String(criado.positionId));
  assert.equal(estado?.principalCents, 550_000);
  assert.equal(
    estado?.quantityMicros, 550_000 * VALUE_MODE_MICROS_PER_CENT,
    "a cota sintética deixou de ser proporcional ao capital",
  );
  assert.equal(estado?.realizedGainCents, 50_000);
  // Valor de mercado sem valoração é o próprio custo.
  assert.equal(estado?.currentValueCents, 550_000);
  assert.equal((await meta())?.investmentNetContributionCents, 550_000);

  const periodo = (await db().doc(
    `workspaces/${WS_A}/investment_report_periods/2026-08`,
  ).get()).data();
  assert.equal(periodo?.redemptionPrincipalCents, 450_000);
  assert.equal(periodo?.realizedGainCents, 50_000);
  assert.equal(periodo?.cashDeltaCents, 500_000 - 1_000_000);
});

test("retirada pendente com rendimento não move nada até a liquidação", async () => {
  await seed();
  const criado = await novoInvestimento({
    chave: "gain4-key-000000001", valorCents: 1_000_000, metaId: GOAL,
  });

  const pedido = await retirar(
    String(criado.positionId), "gain4-key-000000002", 1_100_000,
    {rendimentoCents: 100_000, recebido: false},
  );
  assert.equal(pedido.status, "pending");

  const mov = await movimento(WS_A, String(pedido.movementId));
  assert.equal(mov?.principalCents, 1_000_000);
  assert.equal(mov?.gainCents, 100_000);
  for (const campo of [
    "cashDeltaCents", "principalDeltaCents", "realizedGainDeltaCents",
    "quantityDeltaMicros", "goalNetContributionDeltaCents",
    "goalCurrentValueDeltaCents", "currentValueDeltaCents",
  ]) {
    assert.equal(mov?.[campo], 0, `${campo} deveria ser zero no pendente`);
  }

  let estado = await posicao(WS_A, String(criado.positionId));
  assert.equal(estado?.principalCents, 1_000_000);
  assert.equal(estado?.realizedGainCents, 0);
  assert.equal((await meta())?.investmentNetContributionCents, 1_000_000);

  // O espelho anuncia o total pedido, sem impacto de caixa.
  const pendenteEspelho = await espelho(WS_A, String(pedido.transactionId));
  assert.equal(pendenteEspelho?.isPaid, false);
  assert.equal(pendenteEspelho?.investmentMetadata?.cashImpact, "none");
  assert.equal(pendenteEspelho?.valueCents, 1_100_000);
  await entregarGatilho(
    "evt-gain4-pend", String(pedido.transactionId), undefined, pendenteEspelho,
  );
  assert.equal(await periodoCaixa("2026-08"), undefined);

  const periodoPatrimonial = (await db().doc(
    `workspaces/${WS_A}/investment_report_periods/2026-08`,
  ).get()).data();
  assert.equal(periodoPatrimonial?.redemptionPrincipalCents ?? 0, 0);
  assert.equal(periodoPatrimonial?.realizedGainCents ?? 0, 0);

  // --- liquidação ---------------------------------------------------------
  const liquidar = () => executeSettleSimpleWithdrawal(auth(), {
    workspaceId: WS_A,
    idempotencyKey: "gain4-key-000000003",
    correlationId: "corr-gain4-000000003",
    movementId: String(pedido.movementId),
    settledAt: "2026-08-25T12:00:00.000Z",
  });

  const liquidada = await liquidar();
  assert.equal(liquidada.principalCents, 1_000_000);
  assert.equal(liquidada.gainCents, 100_000);
  assert.equal(liquidada.cashDeltaCents, 1_100_000);

  estado = await posicao(WS_A, String(criado.positionId));
  assert.equal(estado?.principalCents, 0);
  assert.equal(estado?.quantityMicros, 0);
  assert.equal(estado?.realizedGainCents, 100_000);
  assert.equal((await meta())?.investmentNetContributionCents, 0);

  const liquidado = await movimento(WS_A, String(pedido.movementId));
  assert.equal(liquidado?.status, "settled");
  assert.equal(
    (liquidado?.occurredAt as Timestamp).toDate().toISOString(),
    "2026-08-20T12:00:00.000Z",
  );
  assert.equal(
    (liquidado?.settlementAt as Timestamp).toDate().toISOString(),
    "2026-08-25T12:00:00.000Z",
  );

  // --- retry ---------------------------------------------------------------
  const replay = await liquidar();
  assert.equal(replay.cashDeltaCents, 1_100_000);
  estado = await posicao(WS_A, String(criado.positionId));
  assert.equal(estado?.principalCents, 0);
  assert.equal(estado?.realizedGainCents, 100_000, "ganho duplicado no retry");
  assert.equal((await meta())?.investmentNetContributionCents, 0);

  const periodoFinal = (await db().doc(
    `workspaces/${WS_A}/investment_report_periods/2026-08`,
  ).get()).data();
  assert.equal(periodoFinal?.redemptionPrincipalCents, 1_000_000);
  assert.equal(periodoFinal?.realizedGainCents, 100_000);

  // Segunda liquidação com intenção nova é recusada.
  assert.match(
    await erro(() => executeSettleSimpleWithdrawal(auth(), {
      workspaceId: WS_A,
      idempotencyKey: "gain4-key-000000004",
      correlationId: "corr-gain4-000000004",
      movementId: String(pedido.movementId),
      settledAt: "2026-08-26T12:00:00.000Z",
    })),
    /somente uma retirada pendente pode ser liquidada/i,
  );
});

test("a liquidação da retirada revalida o capital contra a posição", async () => {
  await seed();
  const criado = await novoInvestimento({
    chave: "gain5-key-000000001", valorCents: 1_000_000,
  });
  const positionId = String(criado.positionId);

  const pedido = await retirar(positionId, "gain5-key-000000002", 800_000, {
    recebido: false,
  });

  // Outra retirada liquidada consome o capital antes do recebimento.
  await retirar(positionId, "gain5-key-000000003", 600_000, {
    quando: "2026-08-21T12:00:00.000Z",
  });
  assert.equal((await posicao(WS_A, positionId))?.principalCents, 400_000);

  assert.match(
    await erro(() => executeSettleSimpleWithdrawal(auth(), {
      workspaceId: WS_A,
      idempotencyKey: "gain5-key-000000004",
      correlationId: "corr-gain5-000000004",
      movementId: String(pedido.movementId),
      settledAt: "2026-08-25T12:00:00.000Z",
    })),
    /supera o capital investido/i,
  );
  assert.equal((await posicao(WS_A, positionId))?.principalCents, 400_000);
});

// ---------------------------------------------------------------------------
// Hardening — assetType não depende de rótulo
// ---------------------------------------------------------------------------

test("a classificação técnica vem do identificador, não do rótulo", async () => {
  await seed();

  // 1. Categoria padrão "Ações" resolve como stock.
  const acoes = await novoInvestimento({
    chave: "type-key-0000000001", categoriaId: CATEGORY_STOCK,
    descricao: "Carteira de ações",
  });
  const ativoAcoes = (await db().doc(
    `workspaces/${WS_A}/investment_assets/${acoes.assetId}`,
  ).get()).data();
  assert.equal(ativoAcoes?.assetType, "stock");
  assert.equal(ativoAcoes?.typeName, "Ações");

  // 2. Renomear a categoria não reclassifica nada.
  await categoryItem(WS_A, CATEGORY_STOCK, "Bolsa brasileira");
  const depois = await novoInvestimento({
    chave: "type-key-0000000002", categoriaId: CATEGORY_STOCK,
    descricao: "Segunda carteira",
  });
  const ativoDepois = (await db().doc(
    `workspaces/${WS_A}/investment_assets/${depois.assetId}`,
  ).get()).data();
  assert.equal(ativoDepois?.assetType, "stock", "o rótulo reclassificou");
  assert.equal(ativoDepois?.typeName, "Bolsa brasileira");
  // O ativo já gravado também não muda.
  assert.equal(
    (await db().doc(
      `workspaces/${WS_A}/investment_assets/${acoes.assetId}`,
    ).get()).data()?.assetType,
    "stock",
  );

  // 3 e 5. Categoria personalizada chamada "CDB" não ganha classificação
  // específica só pelo texto.
  const custom = await novoInvestimento({
    chave: "type-key-0000000003", categoriaId: CATEGORY_CUSTOM,
    descricao: "CDB do banco X",
  });
  const ativoCustom = (await db().doc(
    `workspaces/${WS_A}/investment_assets/${custom.assetId}`,
  ).get()).data();
  assert.equal(ativoCustom?.typeName, "CDB");
  assert.equal(
    ativoCustom?.assetType, "other",
    "o rótulo concedeu classificação técnica",
  );
});

test("rótulos iguais em workspaces distintos não compartilham autoridade", async () => {
  await seed();
  // O workspace B recebe uma categoria **personalizada** com o mesmo rótulo da
  // semente do workspace A, e um vínculo de instituição próprio.
  await Promise.all([
    categoryItem(WS_B, "cat-type-acoes-custom", "Ações"),
    catalogItem(WS_B, PORTFOLIO, "investment_class", "Aposentadoria"),
  ]);
  await db().doc(`workspaces/${WS_B}/goals/ignorada`).set({id: "ignorada"});

  const contextoB = auth(WS_B, OWNER_B);
  const criadoB = await executeCreateSimpleInvestment(contextoB, {
    workspaceId: WS_B,
    idempotencyKey: "tenant-key-00000001",
    correlationId: "corr-tenant-00000001",
    institutionId: INSTITUTION_B,
    classId: PORTFOLIO,
    typeId: "cat-type-acoes-custom",
    description: "Ações do workspace B",
    valueCents: 100_000,
    settled: true,
    occurredAt: "2026-08-10T12:00:00.000Z",
  });
  const ativoB = (await db().doc(
    `workspaces/${WS_B}/investment_assets/${criadoB.assetId}`,
  ).get()).data();
  assert.equal(ativoB?.typeName, "Ações");
  assert.equal(ativoB?.assetType, "other", "rótulo igual herdou autoridade");

  // E o identificador semeado do workspace A não é alcançável a partir de B.
  assert.match(
    await erro(() => executeCreateSimpleInvestment(contextoB, {
      workspaceId: WS_B,
      idempotencyKey: "tenant-key-00000002",
      correlationId: "corr-tenant-00000002",
      institutionId: INSTITUTION_B,
      classId: PORTFOLIO,
      typeId: CATEGORY_STOCK,
      description: "Tentativa cruzada",
      valueCents: 100_000,
      settled: true,
      occurredAt: "2026-08-10T12:00:00.000Z",
    })),
    /não encontrada/i,
  );
});

// ---------------------------------------------------------------------------
// Hardening — conversão de regime
// ---------------------------------------------------------------------------

test("o regime não pode ser convertido enquanto existir posição", async () => {
  await seed();
  const criado = await novoInvestimento({
    chave: "mode-key-0000000001", valorCents: 100_000,
  });

  assert.match(
    await erro(() => executeSaveInvestmentAsset(auth(), {
      workspaceId: WS_A,
      idempotencyKey: "mode-key-0000000002",
      correlationId: "corr-mode-0000000002",
      assetId: String(criado.assetId),
      name: "Tesouro Selic 2029",
      assetType: "fixed_income",
      trackingMode: "quantity",
    })),
    /regime de acompanhamento não pode mudar/i,
  );
  assert.equal(
    (await db().doc(
      `workspaces/${WS_A}/investment_assets/${criado.assetId}`,
    ).get()).data()?.trackingMode,
    "value",
  );

  // Sem posição, é só cadastro: a conversão é permitida.
  const semPosicao = await executeSaveInvestmentAsset(auth(), {
    workspaceId: WS_A,
    idempotencyKey: "mode-key-0000000003",
    correlationId: "corr-mode-0000000003",
    name: "Ativo sem posição",
    assetType: "fund",
    trackingMode: "value",
  });
  await executeSaveInvestmentAsset(auth(), {
    workspaceId: WS_A,
    idempotencyKey: "mode-key-0000000004",
    correlationId: "corr-mode-0000000004",
    assetId: String(semPosicao.entityId),
    name: "Ativo sem posição",
    assetType: "fund",
    trackingMode: "quantity",
  });
  assert.equal(
    (await db().doc(
      `workspaces/${WS_A}/investment_assets/${semPosicao.entityId}`,
    ).get()).data()?.trackingMode,
    "quantity",
  );
});

test(
  "a categoria semeada pelo onboarding resolve a classificação esperada",
  async () => {
    await seed();

    /*
     * Prova de ponta a ponta de que as duas derivações do identificador
     * concordam: o onboarding grava o item, e a resolução técnica encontra a
     * classificação a partir do ID daquele documento. Se a semente e o mapa
     * divergirem, `assetType` cai em `other` e este teste falha — que é
     * exatamente o sinal que se quer.
     */
    await executeOnboardInvestmentWorkspace(auth(), {
      workspaceId: WS_A,
      idempotencyKey: "onboarding-key-000001",
      correlationId: "corr-onboarding-000001",
    });

    const semeadas = await db()
      .collection(`workspaces/${WS_A}/settings_catalog`)
      .where("group", "==", "investment_type")
      .get();
    const porNome = new Map(
      semeadas.docs.map((entrada) => [String(entrada.data().name), entrada.id]),
    );

    const esperado: Array<[string, string]> = [
      ["Ações", "stock"],
      ["Renda fixa", "fixed_income"],
      ["Fundos", "fund"],
      ["ETF", "etf"],
      ["Criptoativos", "crypto"],
      ["Outros", "other"],
    ];

    for (const [nome, assetType] of esperado) {
      const itemId = porNome.get(nome);
      assert.ok(itemId, `o onboarding não semeou a categoria "${nome}"`);
      const criado = await novoInvestimento({
        chave: `seedmap-key-${nome.length}${assetType.length}0000001`,
        categoriaId: itemId,
        descricao: `Investimento ${nome}`,
      });
      const ativo = (await db().doc(
        `workspaces/${WS_A}/investment_assets/${criado.assetId}`,
      ).get()).data();
      assert.equal(
        ativo?.assetType, assetType,
        `a categoria semeada "${nome}" resolveu ${ativo?.assetType}`,
      );
      assert.equal(ativo?.typeId, itemId);
    }
  },
);


// ---------------------------------------------------------------------------
// Fonte única da categoria — `category` com subtipo `investimento`
// ---------------------------------------------------------------------------

/**
 * A categoria do investimento passou a ser cadastrada onde já se cadastram as
 * de receita e despesa. O grupo é genérico, e é justamente por isso que o
 * subtipo precisa ser conferido: sem essa checagem, o identificador de uma
 * categoria de despesa — que o usuário vê, conhece e pode copiar — passaria
 * como categoria de investimento.
 */
test(
  "categoria de outro subtipo é recusada, ainda que exista no cadastro",
  async () => {
    await seed();

    const recusadas: Array<[string, string]> = [
      ["receita", CATEGORY_RECEITA],
      ["despesa", CATEGORY_DESPESA],
      ["parcelado", CATEGORY_PARCELADO],
      ["sem subtipo", CATEGORY_SEM_SUBTIPO],
    ];

    let indice = 1;
    for (const [subtipo, categoriaId] of recusadas) {
      assert.match(
        await erro(() => novoInvestimento({
          chave: `subtype-key-000000${indice++}`, categoriaId,
        })),
        /não é do tipo investimento/i,
        `a categoria de ${subtipo} foi aceita`,
      );
    }

    // Recusa é recusa: nada foi gravado por nenhuma das tentativas.
    const ativos = await db()
      .collection(`workspaces/${WS_A}/investment_assets`).get();
    assert.equal(ativos.size, 0);
    const movimentos = await db()
      .collection(`workspaces/${WS_A}/investment_movements`).get();
    assert.equal(movimentos.size, 0);
  },
);

test("categoria de investimento inativa não serve a lançamento novo", async () => {
  await seed();
  assert.match(
    await erro(() => novoInvestimento({
      chave: "inactive-key-0000001", categoriaId: CATEGORY_INATIVA,
    })),
    /inativa/i,
  );
});

/**
 * Compatibilidade do grupo histórico.
 *
 * Um pendente aberto antes da unificação carrega um `typeId` de
 * `investment_type`. Corrigir a data desse pendente reenvia o mesmo
 * identificador, e recusá-lo obrigaria a recategorizar um lançamento por causa
 * de uma mudança de cadastro que o usuário não pediu.
 */
test("categoria do grupo histórico continua aceita e classificada", async () => {
  await seed();
  const criado = await novoInvestimento({
    chave: "legacy-key-00000001", categoriaId: CATEGORY_LEGACY,
    descricao: "Pendente antigo corrigido",
  });
  const ativo = (await db().doc(
    `workspaces/${WS_A}/investment_assets/${criado.assetId}`,
  ).get()).data();
  assert.equal(ativo?.typeId, CATEGORY_LEGACY);
  assert.equal(ativo?.typeName, "Renda fixa");
  assert.equal(
    ativo?.assetType, "fixed_income",
    "o identificador histórico perdeu a classificação técnica",
  );
  // E o efeito financeiro é o mesmo de qualquer aporte liquidado.
  assert.equal(criado.cashDeltaCents, -100_000);
});

/**
 * Prova de ponta a ponta de que as duas derivações do identificador concordam,
 * agora do lado do catálogo genérico: `seedLegacySettingsCatalog` grava o item
 * e a resolução técnica encontra a classificação a partir do ID daquele
 * documento. Se a lista de sementes e o mapa divergirem — um nome trocado, um
 * item novo — o documento esperado não existe e o teste falha, em vez de a
 * classificação virar `other` silenciosamente em produção.
 *
 * Roda no workspace B porque o A já tem categorias gravadas com os mesmos
 * identificadores determinísticos, e a semeadura cria documentos.
 */
test(
  "as categorias semeadas em Categorias › Investimentos classificam por ID",
  async () => {
    await seed();
    await catalogItem(WS_B, PORTFOLIO, "investment_class", "Aposentadoria");

    const contextoB = auth(WS_B, OWNER_B);
    await executeSeedLegacySettingsCatalog(contextoB, {
      workspaceId: WS_B,
      idempotencyKey: "legacy-catalog-seed-b-0001",
    });

    const esperado: Array<[string, string]> = [
      ["Ações", "stock"],
      ["Fundos Imobiliários", "fund"],
      ["Tesouro Direto", "fixed_income"],
      ["CDB", "fixed_income"],
      ["Poupança", "fixed_income"],
    ];

    let indice = 1;
    for (const [nome, assetType] of esperado) {
      const itemId = legacyCatalogSeedDocumentId(
        "category", "investimento", "both", nome,
      );
      const item = await db()
        .doc(`workspaces/${WS_B}/settings_catalog/${itemId}`).get();
      assert.ok(
        item.exists,
        `o seed não gravou "${nome}" no identificador determinístico`,
      );
      assert.equal(item.data()?.name, nome);
      assert.equal(item.data()?.group, "category");
      assert.equal(item.data()?.transactionSubtype, "investimento");

      const criado = await executeCreateSimpleInvestment(contextoB, {
        workspaceId: WS_B,
        idempotencyKey: `catseed-key-b-000000${indice++}`,
        correlationId: `corr-catseed-b-000000${indice}`,
        institutionId: INSTITUTION_B,
        classId: PORTFOLIO,
        typeId: itemId,
        description: `Investimento ${nome}`,
        valueCents: 100_000,
        settled: true,
        occurredAt: "2026-08-10T12:00:00.000Z",
      });
      const ativo = (await db().doc(
        `workspaces/${WS_B}/investment_assets/${criado.assetId}`,
      ).get()).data();
      assert.equal(
        ativo?.assetType, assetType,
        `a categoria semeada "${nome}" resolveu ${ativo?.assetType}`,
      );
      assert.equal(ativo?.typeId, itemId);
      assert.equal(ativo?.typeName, nome);
    }
  },
);


// ---------------------------------------------------------------------------
// Hardening — a meta do movimento liquidado é a do instante da liquidação
// ---------------------------------------------------------------------------

/**
 * O vínculo de meta pode mudar entre o pedido de retirada e o recebimento.
 *
 * Os deltas financeiros sempre foram apurados contra a meta da posição no
 * instante da liquidação — isso nunca esteve errado. O que ficava errado era o
 * **documento**: o `goalId` gravado na abertura do pendente permanecia, e como
 * `listGoalInvestmentMovements` filtra exatamente por esse campo, a retirada
 * aparecia no histórico de uma meta que não sofreu efeito nenhum. Progresso e
 * histórico da mesma meta passavam a contar histórias diferentes.
 */

const GOAL_B = "simple-mode-goal-b";

const segundaMeta = async (): Promise<void> => {
  await db().doc(`workspaces/${WS_A}/goals/${GOAL_B}`).set({
    id: GOAL_B, workspaceId: WS_A, name: "Segunda meta",
    progressBasis: "net_contributions",
    investmentNetContributionCents: 0,
    investmentCurrentValueCents: 0,
    investmentProgressCents: 0,
    investmentProjectionVersion: 0,
  });
};

const metaB = async () =>
  (await db().doc(`workspaces/${WS_A}/goals/${GOAL_B}`).get()).data();

/** Evento de auditoria de uma correlação. É onde a trilha do pedido vive. */
const evento = async (correlationId: string) => {
  const encontrados = await db()
    .collection(`workspaces/${WS_A}/investment_event_logs`)
    .where("correlationId", "==", correlationId)
    .get();
  assert.equal(encontrados.size, 1, "a liquidação não deixou trilha única");
  return encontrados.docs[0].data();
};

test(
  "retirada liquidada após o desvínculo não fica na meta antiga",
  async () => {
    await seed();

    const criado = await novoInvestimento({
      chave: "gunlink-key-00000001", valorCents: 200_000, metaId: GOAL,
    });
    const positionId = String(criado.positionId);

    const pedido = await retirar(positionId, "gunlink-key-00000002", 50_000, {
      recebido: false,
    });
    // O pendente nasce declarando a meta do instante do pedido.
    assert.equal(
      (await movimento(WS_A, String(pedido.movementId)))?.goalId, GOAL,
    );

    await executeUnlinkInvestmentFromGoal(auth(), {
      workspaceId: WS_A,
      idempotencyKey: "gunlink-key-00000003",
      correlationId: "corr-gunlink-00000003",
      accountId: String(criado.accountId),
      assetId: String(criado.assetId),
      goalId: GOAL,
      occurredAt: "2026-08-21T12:00:00.000Z",
      reason: "O investimento deixou de pertencer a esta meta.",
    });
    const aposDesvinculo = await meta();
    assert.equal(aposDesvinculo?.investmentNetContributionCents, 0);

    const liquidar = () => executeSettleSimpleWithdrawal(auth(), {
      workspaceId: WS_A,
      idempotencyKey: "gunlink-key-00000004",
      correlationId: "corr-gunlink-00000004",
      movementId: String(pedido.movementId),
      settledAt: "2026-08-25T12:00:00.000Z",
    });

    const liquidado = await liquidar();
    assert.equal(liquidado.status, "settled");

    const mov = await movimento(WS_A, String(pedido.movementId));
    assert.equal(mov?.status, "settled");
    assert.equal(
      mov?.goalId, undefined, "a retirada continuou apontando a meta antiga",
    );
    assert.equal(mov?.goalNetContributionDeltaCents, 0);
    assert.equal(mov?.goalCurrentValueDeltaCents, 0);

    // A posição realmente perdeu o capital; a meta antiga, não.
    assert.equal((await posicao(WS_A, positionId))?.principalCents, 150_000);
    const depois = await meta();
    assert.equal(depois?.investmentNetContributionCents, 0);
    assert.equal(
      depois?.investmentProjectionVersion,
      aposDesvinculo?.investmentProjectionVersion,
      "a meta antiga foi tocada por uma retirada que não é dela",
    );

    // O espelho de caixa é derivado do movimento e segue a mesma regra.
    const projecao = await espelho(WS_A, String(pedido.transactionId));
    assert.equal(projecao?.isPaid, true);
    assert.equal(projecao?.goalId, undefined);

    // A trilha preserva o vínculo que existia quando o pedido foi feito.
    const trilha = await evento("corr-gunlink-00000004");
    assert.equal(
      (trilha.details as Record<string, unknown>).requestedGoalId, GOAL,
    );
    assert.equal(
      (trilha.details as Record<string, unknown>).settledGoalId, null,
    );

    // Retry da mesma intenção é replay: nada é aplicado duas vezes.
    const replay = await liquidar();
    assert.deepEqual(replay, liquidado);
    assert.equal((await posicao(WS_A, positionId))?.principalCents, 150_000);
    assert.equal((await meta())?.investmentNetContributionCents, 0);
  },
);

test(
  "retirada liquidada após troca de meta afeta apenas a meta atual",
  async () => {
    await seed();
    await segundaMeta();

    const criado = await novoInvestimento({
      chave: "gmove-key-000000001", valorCents: 200_000, metaId: GOAL,
    });
    const positionId = String(criado.positionId);

    const pedido = await retirar(positionId, "gmove-key-000000002", 50_000, {
      recebido: false,
    });

    await executeChangeInvestmentGoal(auth(), {
      workspaceId: WS_A,
      idempotencyKey: "gmove-key-000000003",
      correlationId: "corr-gmove-000000003",
      accountId: String(criado.accountId),
      assetId: String(criado.assetId),
      previousGoalId: GOAL,
      goalId: GOAL_B,
      occurredAt: "2026-08-21T12:00:00.000Z",
      reason: "O investimento passou a servir a outra meta.",
    });
    const antigaAposTroca = await meta();
    assert.equal(antigaAposTroca?.investmentNetContributionCents, 0);
    assert.equal((await metaB())?.investmentNetContributionCents, 200_000);

    const liquidado = await executeSettleSimpleWithdrawal(auth(), {
      workspaceId: WS_A,
      idempotencyKey: "gmove-key-000000004",
      correlationId: "corr-gmove-000000004",
      movementId: String(pedido.movementId),
      settledAt: "2026-08-25T12:00:00.000Z",
    });
    assert.equal(liquidado.status, "settled");

    const mov = await movimento(WS_A, String(pedido.movementId));
    assert.equal(mov?.goalId, GOAL_B, "a retirada ficou na meta de origem");
    assert.equal(mov?.goalNetContributionDeltaCents, -50_000);

    // Só a meta atual sofre o efeito, e ela sofre uma vez só.
    assert.equal((await metaB())?.investmentNetContributionCents, 150_000);
    const antiga = await meta();
    assert.equal(antiga?.investmentNetContributionCents, 0);
    assert.equal(
      antiga?.investmentProjectionVersion,
      antigaAposTroca?.investmentProjectionVersion,
      "a meta de origem foi tocada por uma retirada que não é mais dela",
    );

    assert.equal(
      (await espelho(WS_A, String(pedido.transactionId)))?.goalId, GOAL_B,
    );

    const trilha = await evento("corr-gmove-000000004");
    assert.equal(
      (trilha.details as Record<string, unknown>).requestedGoalId, GOAL,
    );
    assert.equal(
      (trilha.details as Record<string, unknown>).settledGoalId, GOAL_B,
    );
  },
);

// ---------------------------------------------------------------------------
// Hardening — política temporal das operações simples
// ---------------------------------------------------------------------------

/*
 * As liquidações sempre recusaram data futura (`assertNotFuture`) e data
 * anterior ao fato de origem (`assertNotBefore`). A criação não recusava
 * nada, e a combinação produzia um beco sem saída: uma retirada pendente
 * nascida com `occurredAt` no futuro exigia, para liquidar, um `settledAt`
 * que fosse ao mesmo tempo **posterior ao pedido** e **não futuro** — o que
 * não existe enquanto o pedido não vira passado. O documento pendente ficava
 * permanentemente inliquidável, e o mês futuro passava a ter período de caixa
 * e série patrimonial abertos por um fato que ainda não aconteceu.
 *
 * A política é uma só, com a tolerância de relógio que o domínio já define
 * (`FUTURE_DATE_TOLERANCE_MS`): nenhum fato financeiro nasce no futuro.
 */

/** Instante além da tolerância de relógio — futuro para o domínio. */
const noFuturo = (): string =>
  new Date(Date.now() + FUTURE_DATE_TOLERANCE_MS + 60_000).toISOString();

test("investimento novo com data futura é recusado", async () => {
  await seed();

  const falha = await erro(() =>
    novoInvestimento({chave: "futuro-key-00000001", quando: noFuturo()}),
  );
  assert.match(falha, /occurredAt/);
  assert.match(falha, /futuro/i);

  // Nada foi gravado: nem movimento, nem posição, nem espelho de caixa.
  const movimentos = await db()
    .collection(`workspaces/${WS_A}/investment_movements`)
    .get();
  assert.equal(movimentos.size, 0);
  const posicoes = await db()
    .collection(`workspaces/${WS_A}/investment_positions`)
    .get();
  assert.equal(posicoes.size, 0);
  const espelhos = await db()
    .collection(`workspaces/${WS_A}/transactions`)
    .get();
  assert.equal(espelhos.size, 0);
});

test("aporte com data futura é recusado", async () => {
  await seed();
  const criado = await novoInvestimento({chave: "futuro-key-00000002"});

  const falha = await erro(() =>
    executeCreateInvestmentContribution(auth(), {
      workspaceId: WS_A,
      idempotencyKey: "futuro-key-00000003",
      correlationId: "corr-futuro-00000003",
      positionId: String(criado.positionId),
      description: "Aporte agendado",
      principalCents: 50_000,
      feesCents: 0,
      taxCents: 0,
      occurredAt: noFuturo(),
    }),
  );
  assert.match(falha, /occurredAt/);
  assert.match(falha, /futuro/i);

  // O capital aplicado continua sendo só o do investimento inicial.
  const posicaoApos = await posicao(WS_A, String(criado.positionId));
  assert.equal(posicaoApos?.principalCents, 100_000);
});

test("retirada pendente com data futura é recusada", async () => {
  await seed();
  const criado = await novoInvestimento({
    chave: "futuro-key-00000004", valorCents: 500_000,
  });

  const falha = await erro(() =>
    retirar(String(criado.positionId), "futuro-key-00000005", 100_000, {
      recebido: false,
      quando: noFuturo(),
    }),
  );
  assert.match(falha, /occurredAt/);
  assert.match(falha, /futuro/i);

  // A recusa acontece antes de existir qualquer pendente inliquidável.
  const pendentes = await db()
    .collection(`workspaces/${WS_A}/investment_movements`)
    .where("status", "==", "pending")
    .get();
  assert.equal(pendentes.size, 0);
  assert.equal(
    (await posicao(WS_A, String(criado.positionId)))?.principalCents,
    500_000,
  );
});

test("data de hoje e data passada continuam aceitas", async () => {
  await seed();

  // Agora: o caminho normal da interface, que envia o instante corrente
  // quando o meio-dia do dia escolhido ainda não chegou.
  const agora = await novoInvestimento({
    chave: "futuro-key-00000006",
    quando: new Date().toISOString(),
    valorCents: 300_000,
  });
  assert.equal(agora.status, "settled");
  assert.equal(
    (await posicao(WS_A, String(agora.positionId)))?.principalCents,
    300_000,
  );

  // Dentro da tolerância de relógio: o navegador adiantado não é recusado.
  const adiantado = await novoInvestimento({
    chave: "futuro-key-00000007",
    descricao: "CDB adiantado",
    quando: new Date(
      Date.now() + FUTURE_DATE_TOLERANCE_MS - 30_000,
    ).toISOString(),
  });
  assert.equal(adiantado.status, "settled");

  // Histórico: uma data antiga continua sendo um lançamento legítimo.
  const antigo = await novoInvestimento({
    chave: "futuro-key-00000008",
    descricao: "Tesouro histórico",
    quando: "2026-07-05T12:00:00.000Z",
    valorCents: 200_000,
  });
  assert.equal(antigo.status, "settled");
  const movimentoAntigo = await movimento(WS_A, String(antigo.movementId));
  assert.equal(
    (movimentoAntigo?.occurredAt as Timestamp).toDate().toISOString(),
    "2026-07-05T12:00:00.000Z",
    "a data histórica informada é preservada",
  );
});

test(
  "liquidação preserva settledAt >= occurredAt e settledAt não futuro",
  async () => {
    await seed();
    const criado = await novoInvestimento({
      chave: "futuro-key-00000009", valorCents: 400_000,
    });
    const pedido = await retirar(
      String(criado.positionId), "futuro-key-00000010", 100_000,
      {recebido: false, quando: "2026-08-20T12:00:00.000Z"},
    );
    assert.equal(pedido.status, "pending");

    // Anterior ao pedido: recusada.
    assert.match(
      await erro(() =>
        executeSettleSimpleWithdrawal(auth(), {
          workspaceId: WS_A,
          idempotencyKey: "futuro-key-00000011",
          correlationId: "corr-futuro-00000011",
          movementId: String(pedido.movementId),
          settledAt: "2026-08-19T12:00:00.000Z",
        }),
      ),
      /anterior/i,
    );

    // Futura: recusada.
    assert.match(
      await erro(() =>
        executeSettleSimpleWithdrawal(auth(), {
          workspaceId: WS_A,
          idempotencyKey: "futuro-key-00000012",
          correlationId: "corr-futuro-00000012",
          movementId: String(pedido.movementId),
          settledAt: noFuturo(),
        }),
      ),
      /futuro/i,
    );

    // Entre o pedido e agora: liquida, e o pendente não ficou preso.
    const liquidado = await executeSettleSimpleWithdrawal(auth(), {
      workspaceId: WS_A,
      idempotencyKey: "futuro-key-00000013",
      correlationId: "corr-futuro-00000013",
      movementId: String(pedido.movementId),
      settledAt: "2026-08-22T12:00:00.000Z",
    });
    assert.equal(liquidado.status, "settled");
    assert.equal(
      (await posicao(WS_A, String(criado.positionId)))?.principalCents,
      300_000,
    );
  },
);

// ---------------------------------------------------------------------------
// Hardening — pré-empção do espelho de caixa
// ---------------------------------------------------------------------------

/*
 * O ID do espelho é determinístico e derivado de `(operação, uid,
 * idempotencyKey)` — nenhum segredo de servidor entra na conta, e a chave de
 * idempotência é escolhida pelo próprio cliente. As Rules deixam um membro
 * criar `transactions/{docId}` com o ID que quiser e autorizam um conjunto de
 * chaves de transação comum; a baixa lógica (`voidedAt`) é um segundo passo
 * permitido enquanto o documento ainda não é do domínio patrimonial.
 *
 * Os campos abaixo são exatamente os que essa superfície permite e que o
 * payload do espelho **não** escreve. Com `merge` todos sobreviviam à
 * gravação do backend, e dois deles causavam dano financeiro real:
 *
 * - `voidedAt` — `cashPeriodDeltaFor` zera o efeito de caixa antes de olhar o
 *   `type`, e a reconstrução de períodos repete o mesmo zero: o aporte sumia
 *   do caixa sem erro e sem caminho de reconciliação;
 * - `cardId` / `source` / `creditCardCompatibility` — as projeções de
 *   compatibilidade de cartão classificam por esses campos sem checar `type`.
 *
 * O estado inicial é montado pelo SDK administrativo por conveniência; cada
 * chave individualmente é gravável pelo cliente na sequência create + baixa.
 */
const CAMPOS_RESIDUAIS = [
  "cardId", "installments", "currentInstallment", "creditCardInvoiceId",
  "creditCardInvoicePaymentId", "source", "creditCardCompatibility",
  "supplier", "costCenter", "paymentMethod", "expenseType", "loanId",
  "displaySnapshots", "voidedAt", "voidedBy", "voidReason",
] as const;

const ocuparEspelho = async (transactionId: string): Promise<void> => {
  await db().doc(`workspaces/${WS_A}/transactions/${transactionId}`).set({
    type: "despesa",
    description: "Compra no cartão",
    category: "Outros",
    value: 999,
    date: "2026-08-05",
    transactionDate: at("2026-08-05T12:00:00.000Z"),
    isPaid: true,
    workspaceId: WS_A,
    userId: OWNER_A,
    profileId: WS_A,
    cardId: "card-forjado",
    installments: 12,
    currentInstallment: 3,
    creditCardInvoiceId: "fatura-forjada",
    creditCardInvoicePaymentId: "pagamento-forjado",
    source: "credit_card_invoice_payment",
    creditCardCompatibility: {source: "credit_card_invoice"},
    supplier: "Fornecedor forjado",
    costCenter: "CC-1",
    paymentMethod: "credito",
    expenseType: "fixa",
    loanId: "emprestimo-forjado",
    displaySnapshots: {any: "coisa"},
    createdAt: at("2026-08-05T12:00:00.000Z"),
    updatedAt: at("2026-08-05T12:00:00.000Z"),
    // Baixa lógica obtida enquanto o documento ainda era transação comum.
    voidedAt: at("2026-08-05T13:00:00.000Z"),
    voidedBy: OWNER_A,
    voidReason: "sumir do caixa",
  });
};

const assertEspelhoAutoritativo = (
  projecao: admin.firestore.DocumentData | undefined,
): void => {
  assert.equal(projecao?.type, "investimento");
  assert.equal(projecao?.category, "Investimentos");
  for (const residual of CAMPOS_RESIDUAIS) {
    assert.equal(
      projecao?.[residual], undefined, `${residual} sobreviveu ao espelho`,
    );
  }
};

test(
  "espelho pré-ocupado pelo cliente não conserva campo algum do cliente",
  async () => {
    await seed();
    const chave = "preempt-key-00000001";
    const espelhoId = `investment_${deterministicDocumentId(
      "createSimpleInvestment", OWNER_A, chave,
    )}`;
    await ocuparEspelho(espelhoId);
    const ocupado = await espelho(WS_A, espelhoId);
    assert.equal(ocupado?.cardId, "card-forjado", "cenário não foi montado");

    const criado = await novoInvestimento({
      chave, valorCents: 150_000, metaId: GOAL,
    });
    assert.equal(
      String(criado.transactionId), espelhoId,
      "o ID do espelho não é o previsto pelo cliente",
    );

    // O documento final tem a forma do domínio, e só ela.
    const projecao = await espelho(WS_A, espelhoId);
    assertEspelhoAutoritativo(projecao);
    assert.equal(projecao?.valueCents, 150_000);
    assert.equal(projecao?.value, 1_500);
    assert.equal(projecao?.isPaid, true);
    assert.equal(projecao?.goalId, GOAL);
    assert.equal(projecao?.investmentMetadata?.cashImpact, "outflow");
    assert.equal(projecao?.investmentMetadata?.status, "settled");

    // O caixa recebe a saída de investimento uma vez, e nada de despesa.
    await entregarGatilho("evt-preempt-1", espelhoId, undefined, ocupado);
    await entregarGatilho("evt-preempt-2", espelhoId, ocupado, projecao);
    const periodo = await periodoCaixa("2026-08");
    assert.equal(periodo?.investmentOutflowCents, 150_000);
    assert.equal(periodo?.expenseCents ?? 0, 0, "a despesa forjada contou");
    assert.equal(periodo?.incomeCents ?? 0, 0);
    assert.equal(periodo?.transactionCount, 1);

    // Reentrega do mesmo evento não soma de novo.
    await entregarGatilho("evt-preempt-2", espelhoId, ocupado, projecao);
    assert.equal(
      (await periodoCaixa("2026-08"))?.investmentOutflowCents, 150_000,
    );

    // A meta continua vindo do domínio, nunca do espelho.
    assert.equal((await meta())?.investmentNetContributionCents, 150_000);
  },
);

test(
  "espelho pré-ocupado continua limpo do pedido pendente à liquidação",
  async () => {
    await seed();
    const criado = await novoInvestimento({
      chave: "preempt-key-00000002", valorCents: 500_000,
    });

    const chave = "preempt-key-00000003";
    const espelhoId = `investment_${deterministicDocumentId(
      "withdrawSimpleInvestment", OWNER_A, chave,
    )}`;
    await ocuparEspelho(espelhoId);

    // Pedido pendente: o espelho já nasce autoritativo, e sem efeito de caixa.
    const pedido = await retirar(
      String(criado.positionId), chave, 100_000,
      {recebido: false, quando: "2026-08-20T12:00:00.000Z"},
    );
    assert.equal(pedido.status, "pending");
    assert.equal(String(pedido.transactionId), espelhoId);
    const pendente = await espelho(WS_A, espelhoId);
    assertEspelhoAutoritativo(pendente);
    assert.equal(pendente?.isPaid, false);
    assert.equal(pendente?.investmentMetadata?.status, "pending");
    assert.equal(pendente?.investmentMetadata?.cashImpact, "none");

    // Liquidação: mesmo documento, sem duplicata, e ainda sem resíduo.
    const liquidado = await executeSettleSimpleWithdrawal(auth(), {
      workspaceId: WS_A,
      idempotencyKey: "preempt-key-00000004",
      correlationId: "corr-preempt-00000004",
      movementId: String(pedido.movementId),
      settledAt: "2026-08-22T12:00:00.000Z",
    });
    assert.equal(liquidado.status, "settled");
    assert.equal(String(liquidado.transactionId), espelhoId);

    const espelhos = await db()
      .collection(`workspaces/${WS_A}/transactions`)
      .get();
    assert.equal(espelhos.size, 2, "o lifecycle duplicou documento");

    const final = await espelho(WS_A, espelhoId);
    assertEspelhoAutoritativo(final);
    assert.equal(final?.isPaid, true);
    assert.equal(final?.investmentMetadata?.status, "settled");
    assert.equal(final?.investmentMetadata?.cashImpact, "inflow");

    // O caixa aplica a entrada uma vez só, na liquidação.
    await entregarGatilho("evt-preempt-3", espelhoId, pendente, final);
    const periodo = await periodoCaixa("2026-08");
    assert.equal(periodo?.expenseCents ?? 0, 0);
    assert.equal(periodo?.netCents, 100_000);
  },
);

// ---------------------------------------------------------------------------
// L. Correção de aporte pendente (substituição atômica)
// ---------------------------------------------------------------------------

/**
 * Editar um pendente é cancelar a intenção anterior e abrir outra. O que estes
 * testes fixam é que as duas metades acontecem **no mesmo commit**.
 *
 * O caminho anterior encadeava duas callables: cancelar e depois criar. Entre
 * uma e outra havia um estado alcançável em que o pendente já estava cancelado
 * e o substituto não existia — bastava a criação ser recusada, e o caso real
 * era banal: a categoria do lançamento tinha sido inativada no cadastro depois
 * dele. O usuário perdia um pendente por ter tentado corrigir a descrição.
 * Inverter a ordem trocaria o defeito por outro pior: dois pendentes vivos
 * para o mesmo dinheiro.
 *
 * A regra de produto é a única aceitável: **edição que falha devolve o
 * pendente original intacto**.
 */

/** Todos os deltas de um pendente ou cancelado são zero, por contrato. */
const DELTAS = [
  "cashDeltaCents", "principalDeltaCents", "realizedGainDeltaCents",
  "feesDeltaCents", "taxDeltaCents", "quantityDeltaMicros",
  "goalNetContributionDeltaCents", "goalCurrentValueDeltaCents",
  "currentValueDeltaCents",
] as const;

const assertSemEfeito = (
  documento: admin.firestore.DocumentData | undefined,
  rotulo: string,
): void => {
  for (const campo of DELTAS) {
    assert.equal(documento?.[campo], 0, `${rotulo}: ${campo} não é zero`);
  }
};

const movimentosDe = async (workspaceId = WS_A) =>
  (await db()
    .collection(`workspaces/${workspaceId}/investment_movements`)
    .get()).docs.map((doc) => doc.data());

test("corrigir um pendente cancela e cria no mesmo commit", async () => {
  await seed();
  const original = await novoInvestimento({
    chave: "replace-key-00000001", descricao: "CDB com valor errado",
    valorCents: 10_000, liquidado: false, metaId: GOAL,
  });

  const corrigido = await novoInvestimento({
    chave: "replace-key-00000002", descricao: "CDB corrigido",
    valorCents: 250_000, liquidado: false, metaId: GOAL,
    substitui: String(original.movementId),
  });

  assert.equal(corrigido.status, "pending");
  assert.equal(corrigido.replacedMovementId, String(original.movementId));

  // O anterior é preservado como cancelado — nunca apagado.
  const antigo = await movimento(WS_A, String(original.movementId));
  assert.ok(antigo, "a correção apagou o pendente anterior");
  assert.equal(antigo?.status, "cancelled");
  assert.equal(antigo?.cancelledBy, OWNER_A);
  assert.ok(antigo?.cancelledAt, "o cancelamento não registrou instante");
  const motivo = String(antigo?.cancellationReason);
  assert.match(motivo, /Substituído pela correção do lançamento pendente/);
  assert.ok(
    motivo.includes(String(corrigido.movementId)),
    "o cancelado não aponta para o substituto",
  );
  assertSemEfeito(antigo, "cancelado");

  const novo = await movimento(WS_A, String(corrigido.movementId));
  assert.equal(novo?.status, "pending");
  assert.equal(novo?.description, "CDB corrigido");
  assert.equal(novo?.principalCents, 250_000);
  assert.equal(novo?.goalId, GOAL);
  assertSemEfeito(novo, "substituto");

  // Dois documentos, um pendente só. Nunca dois pendentes visíveis.
  const movimentos = await movimentosDe();
  assert.equal(movimentos.length, 2);
  assert.deepEqual(
    movimentos.map((mov) => mov.status).sort(), ["cancelled", "pending"],
  );

  // O espelho do cancelado é reescrito como cancelado, sem efeito de caixa.
  const espelhoAntigo = await espelho(WS_A, String(original.transactionId));
  assert.equal(espelhoAntigo?.isPaid, false);
  assert.equal(espelhoAntigo?.investmentMetadata?.status, "cancelled");
  assert.equal(espelhoAntigo?.investmentMetadata?.cashImpact, "none");
  assert.equal(espelhoAntigo?.investmentMetadata?.investmentImpact, "none");
  // E o do substituto nasce pendente, sem duplicar documento.
  const espelhoNovo = await espelho(WS_A, String(corrigido.transactionId));
  assert.equal(espelhoNovo?.isPaid, false);
  assert.equal(espelhoNovo?.investmentMetadata?.status, "pending");
  assert.equal(espelhoNovo?.valueCents, 250_000);
  const espelhos = await db()
    .collection(`workspaces/${WS_A}/transactions`).get();
  assert.equal(espelhos.size, 2, "a correção duplicou espelho de caixa");
});

test("corrigir um pendente não move caixa, posição nem meta", async () => {
  await seed();
  const original = await novoInvestimento({
    chave: "replace-key-00000003", valorCents: 90_000, liquidado: false,
    metaId: GOAL,
  });
  const espelhoPendente = await espelho(WS_A, String(original.transactionId));

  const corrigido = await novoInvestimento({
    chave: "replace-key-00000004", valorCents: 120_000, liquidado: false,
    metaId: GOAL, substitui: String(original.movementId),
  });

  // Nenhuma posição nasce de intenção pendente, nem antes nem depois.
  const posicoes = await db()
    .collection(`workspaces/${WS_A}/investment_positions`).get();
  assert.equal(posicoes.size, 0, "a correção criou posição");
  const progresso = await meta();
  assert.equal(progresso?.investmentNetContributionCents, 0);
  assert.equal(progresso?.investmentCurrentValueCents, 0);
  assert.equal(progresso?.investmentProgressCents, 0);
  assert.equal(
    (await db().doc(`workspaces/${WS_A}/investment_summaries/current`).get())
      .data(), undefined,
    "a correção publicou resumo patrimonial",
  );

  // O caixa não recebe nada: nem despesa, nem receita, nem saída.
  const espelhoCancelado = await espelho(WS_A, String(original.transactionId));
  const espelhoNovo = await espelho(WS_A, String(corrigido.transactionId));
  await entregarGatilho(
    "evt-replace-1", String(original.transactionId),
    undefined, espelhoPendente,
  );
  await entregarGatilho(
    "evt-replace-2", String(original.transactionId),
    espelhoPendente, espelhoCancelado,
  );
  await entregarGatilho(
    "evt-replace-3", String(corrigido.transactionId), undefined, espelhoNovo,
  );
  assert.equal(
    await periodoCaixa("2026-08"), undefined,
    "a correção de um pendente moveu o caixa",
  );
});

test("edição recusada devolve o pendente original intacto", async () => {
  await seed();
  const original = await novoInvestimento({
    chave: "replace-key-00000005", descricao: "CDB a preservar",
    valorCents: 70_000, liquidado: false, metaId: GOAL,
  });

  /*
   * Três recusas em pontos diferentes da transação: catálogo (categoria de
   * outro subtipo), catálogo inexistente no workspace e leitura posterior à
   * resolução (meta inexistente). Em todas, o commit inteiro é abortado.
   */
  const recusas: Array<[string, NovoInvestimento, RegExp]> = [
    ["categoria de despesa", {
      chave: "replace-key-00000006", categoriaId: CATEGORY_DESPESA,
    }, /não é do tipo investimento/i],
    ["instituição de outro workspace", {
      chave: "replace-key-00000007", instituicaoId: INSTITUTION_B,
    }, /não encontrada no cadastro deste workspace/i],
    ["meta inexistente", {
      chave: "replace-key-00000008", metaId: "meta-que-nao-existe",
    }, /não encontrado/i],
  ];

  for (const [rotulo, opcoes, esperado] of recusas) {
    assert.match(
      await erro(() => novoInvestimento({
        ...opcoes, descricao: "CDB corrigido", liquidado: false,
        substitui: String(original.movementId),
      })),
      esperado,
      `a recusa por ${rotulo} não veio como erro de domínio`,
    );

    // O pendente anterior continua pendente e com os mesmos efeitos zero.
    const antigo = await movimento(WS_A, String(original.movementId));
    assert.equal(antigo?.status, "pending", `${rotulo}: o pendente sumiu`);
    assert.equal(antigo?.cancelledAt, undefined);
    assert.equal(antigo?.principalCents, 70_000);
    assertSemEfeito(antigo, rotulo);
    // E nada foi criado pela tentativa.
    assert.equal((await movimentosDe()).length, 1, `${rotulo}: sobrou lixo`);
    assert.equal(
      (await db().collection(`workspaces/${WS_A}/investment_assets`).get())
        .size, 1, `${rotulo}: o ativo do substituto foi criado`,
    );
  }

  // E o pendente preservado continua operacionalmente utilizável.
  const liquidado = await executeSettleInvestmentContribution(auth(), {
    workspaceId: WS_A,
    idempotencyKey: "replace-key-00000009",
    correlationId: "corr-replace-00000009",
    movementId: String(original.movementId),
    settledAt: "2026-08-15T12:00:00.000Z",
  });
  assert.equal(liquidado.status, "settled");
  assert.equal((await meta())?.investmentNetContributionCents, 70_000);
});

test("categoria inativada depois não bloqueia a correção", async () => {
  await seed();
  const original = await novoInvestimento({
    chave: "replace-key-00000010", descricao: "Tesouro com nome errado",
    valorCents: 50_000, liquidado: false, categoriaId: CATEGORY,
  });
  // O cadastro é aposentado **depois** de o lançamento existir.
  await categoryItem(
    WS_A, CATEGORY, "Tesouro Direto", "investimento", "inactive",
  );

  // A regra normal não afrouxa: lançamento novo com ela continua recusado.
  assert.match(
    await erro(() => novoInvestimento({
      chave: "replace-key-00000011", categoriaId: CATEGORY,
    })),
    /inativa/i,
    "a exceção vazou para um lançamento novo",
  );

  // C. Só a descrição muda; a categoria histórica é preservada.
  const descricaoCorrigida = await novoInvestimento({
    chave: "replace-key-00000012", descricao: "Tesouro Selic 2029",
    valorCents: 50_000, liquidado: false, categoriaId: CATEGORY,
    substitui: String(original.movementId),
  });
  assert.equal(descricaoCorrigida.status, "pending");
  const apos = await movimento(WS_A, String(descricaoCorrigida.movementId));
  assert.equal(apos?.description, "Tesouro Selic 2029");
  assert.equal(apos?.typeId, CATEGORY);
  assert.equal(apos?.typeName, "Tesouro Direto");
  assert.equal(
    (await movimento(WS_A, String(original.movementId)))?.status, "cancelled",
  );

  // D. E o valor também, preservando a mesma categoria inativa.
  const valorCorrigido = await novoInvestimento({
    chave: "replace-key-00000013", descricao: "Tesouro Selic 2029",
    valorCents: 65_000, liquidado: false, categoriaId: CATEGORY,
    substitui: String(descricaoCorrigida.movementId),
  });
  assert.equal(valorCorrigido.status, "pending");
  assert.equal(
    (await movimento(WS_A, String(valorCorrigido.movementId)))
      ?.principalCents, 65_000,
  );
  const estados = (await movimentosDe()).map((mov) => mov.status).sort();
  assert.deepEqual(estados, ["cancelled", "cancelled", "pending"]);
});

test("a exceção de categoria inativa não alcança outra categoria", async () => {
  await seed();
  const original = await novoInvestimento({
    chave: "replace-key-00000014", valorCents: 40_000, liquidado: false,
    categoriaId: CATEGORY,
  });
  await categoryItem(
    WS_A, CATEGORY, "Tesouro Direto", "investimento", "inactive",
  );

  // Trocar por **outra** categoria inativa é recategorização, não preservação.
  assert.match(
    await erro(() => novoInvestimento({
      chave: "replace-key-00000015", liquidado: false,
      categoriaId: CATEGORY_INATIVA, substitui: String(original.movementId),
    })),
    /inativa/i,
  );
  assert.equal(
    (await movimento(WS_A, String(original.movementId)))?.status, "pending",
    "a recusa consumiu o pendente original",
  );
  assert.equal((await movimentosDe()).length, 1);

  // Trocar por uma categoria **ativa** continua funcionando normalmente.
  const recategorizado = await novoInvestimento({
    chave: "replace-key-00000016", liquidado: false,
    categoriaId: CATEGORY_STOCK, substitui: String(original.movementId),
  });
  const novo = await movimento(WS_A, String(recategorizado.movementId));
  assert.equal(novo?.typeId, CATEGORY_STOCK);
  assert.equal(novo?.typeName, "Ações");
});

test("pendente do grupo histórico corrige preservando typeId", async () => {
  await seed();
  const original = await novoInvestimento({
    chave: "replace-key-00000017", descricao: "Pendente antigo",
    valorCents: 30_000, liquidado: false, categoriaId: CATEGORY_LEGACY,
  });
  assert.equal(
    (await movimento(WS_A, String(original.movementId)))?.typeId,
    CATEGORY_LEGACY,
  );
  // O item histórico também pode ter sido inativado desde então.
  await catalogItem(
    WS_A, CATEGORY_LEGACY, "investment_type", "Renda fixa", "inactive",
  );

  const corrigido = await novoInvestimento({
    chave: "replace-key-00000018", descricao: "Pendente antigo corrigido",
    valorCents: 30_000, liquidado: false, categoriaId: CATEGORY_LEGACY,
    substitui: String(original.movementId),
  });
  assert.equal(corrigido.status, "pending");
  const novo = await movimento(WS_A, String(corrigido.movementId));
  assert.equal(novo?.typeId, CATEGORY_LEGACY);
  assert.equal(novo?.typeName, "Renda fixa");
  // A classificação técnica continua vindo do identificador.
  const ativo = (await db().doc(
    `workspaces/${WS_A}/investment_assets/${corrigido.assetId}`,
  ).get()).data();
  assert.equal(ativo?.assetType, "fixed_income");
  assert.equal(
    (await movimento(WS_A, String(original.movementId)))?.status, "cancelled",
  );
});

test("retry da correção devolve o mesmo resultado e não duplica", async () => {
  await seed();
  const original = await novoInvestimento({
    chave: "replace-key-00000019", valorCents: 80_000, liquidado: false,
    metaId: GOAL,
  });
  const corrigir = () => novoInvestimento({
    chave: "replace-key-00000020", descricao: "Corrigido uma vez",
    valorCents: 95_000, liquidado: false, metaId: GOAL,
    substitui: String(original.movementId),
  });

  const primeiro = await corrigir();
  const replay = await corrigir();
  assert.deepEqual(replay, primeiro, "o retry não foi replay da idempotência");

  const movimentos = await movimentosDe();
  assert.equal(movimentos.length, 2, "o retry duplicou movimento");
  assert.deepEqual(
    movimentos.map((mov) => mov.status).sort(), ["cancelled", "pending"],
  );
  assert.equal(
    (await db().collection(`workspaces/${WS_A}/investment_assets`).get()).size,
    2, "o retry duplicou ativo",
  );
  assert.equal(
    (await db().collection(`workspaces/${WS_A}/transactions`).get()).size, 2,
    "o retry duplicou espelho",
  );
  assert.equal((await meta())?.investmentNetContributionCents, 0);
});

test("duas correções concorrentes não deixam dois pendentes", async () => {
  await seed();
  const original = await novoInvestimento({
    chave: "replace-key-00000021", valorCents: 60_000, liquidado: false,
  });

  // Intenções distintas — duas abas, não duplo clique — sobre o mesmo alvo.
  const disputa = await Promise.allSettled([
    novoInvestimento({
      chave: "replace-key-00000022", descricao: "Correção da aba A",
      valorCents: 61_000, liquidado: false,
      substitui: String(original.movementId),
    }),
    novoInvestimento({
      chave: "replace-key-00000023", descricao: "Correção da aba B",
      valorCents: 62_000, liquidado: false,
      substitui: String(original.movementId),
    }),
  ]);

  const vencedoras = disputa.filter((r) => r.status === "fulfilled");
  assert.equal(vencedoras.length, 1, "as duas correções passaram");

  const movimentos = await movimentosDe();
  const pendentes = movimentos.filter((mov) => mov.status === "pending");
  assert.equal(pendentes.length, 1, "sobraram dois pendentes vivos");
  assert.equal(movimentos.length, 2);
  assert.equal(
    (await movimento(WS_A, String(original.movementId)))?.status, "cancelled",
  );

  // A perdedora é recusada por precondição de domínio, não por escrita parcial.
  const perdedora = disputa.find((r) => r.status === "rejected");
  assert.match(
    String((perdedora as PromiseRejectedResult).reason?.message),
    /já foi cancelado|pendente pode ser corrigido/i,
  );
});

test("substituição recusa alvo liquidado, cancelado ou alheio", async () => {
  await seed();
  const liquidado = await novoInvestimento({
    chave: "replace-key-00000024", valorCents: 20_000,
  });
  const cancelado = await novoInvestimento({
    chave: "replace-key-00000025", valorCents: 20_000, liquidado: false,
  });
  await executeCancelInvestmentMovement(auth(), {
    workspaceId: WS_A,
    idempotencyKey: "replace-key-00000026",
    correlationId: "corr-replace-00000026",
    movementId: String(cancelado.movementId),
    occurredAt: "2026-08-11T12:00:00.000Z",
    reason: "Depósito não aconteceu.",
  });

  // Um lançamento já depositado exige estorno, nunca substituição silenciosa.
  assert.match(
    await erro(() => novoInvestimento({
      chave: "replace-key-00000027", liquidado: false,
      substitui: String(liquidado.movementId),
    })),
    /estorno compensatório/i,
  );
  assert.equal(
    (await movimento(WS_A, String(liquidado.movementId)))?.status, "settled",
    "a tentativa alterou um movimento liquidado",
  );

  assert.match(
    await erro(() => novoInvestimento({
      chave: "replace-key-00000028", liquidado: false,
      substitui: String(cancelado.movementId),
    })),
    /já foi cancelado/i,
  );

  // Isolamento: o identificador de outro tenant simplesmente não existe aqui.
  await catalogItem(WS_B, PORTFOLIO, "investment_class", "Aposentadoria");
  await categoryItem(WS_B, CATEGORY, "Tesouro Direto");
  const pendenteB = await novoInvestimento({
    chave: "replace-key-00000029", liquidado: false,
    instituicaoId: INSTITUTION_B, contexto: auth(WS_B, OWNER_B),
  });
  assert.match(
    await erro(() => novoInvestimento({
      chave: "replace-key-00000030", liquidado: false,
      substitui: String(pendenteB.movementId),
    })),
    /não encontrado/i,
  );
  assert.equal(
    (await movimento(WS_B, String(pendenteB.movementId)))?.status, "pending",
    "o pendente do outro workspace foi tocado",
  );
});
