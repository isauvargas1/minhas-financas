import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  BILLING_CALLABLES,
  createBillingCallables,
  type BillingCallableName,
} from '../../src/modules/billing/callables.ts';
import {
  displayEntitlement,
  hasManageableSubscription,
  isPaidEntitlementActive,
} from '../../src/modules/billing/entitlement.ts';
import type {
  BillingAccount,
  SubscriptionStatus,
} from '../../src/modules/billing/types.ts';

/**
 * Contrato cliente do billing canônico (P2A).
 *
 * Amarra o cliente ao backend sem subir o Firebase: nomes das callables,
 * chaves dos schemas estritos e payload real de cada wrapper. Também cobre as
 * regras de exibição do entitlement e guardas estáticas contra o retorno do
 * plano legado (constantes de preço no cliente, plano lido do perfil).
 */
const backendCallables = readFileSync(
  new URL('../../functions/src/billing/callables.ts', import.meta.url),
  'utf8',
);
const backendContracts = readFileSync(
  new URL('../../functions/src/billing/contracts.ts', import.meta.url),
  'utf8',
);

const schemaKeys = (callable: BillingCallableName): string[] => {
  const match = new RegExp(
    `export const ${callable}PayloadSchema = z\\.object\\(\\{([\\s\\S]*?)\\}\\)\\.strict\\(\\);`,
  ).exec(backendContracts);
  assert.ok(match, `schema de ${callable} não encontrado`);
  return [...match[1].matchAll(/^\s{2}(\w+):/gm)].map((entry) => entry[1]).sort();
};

const recorder = () => {
  const calls: Array<{ name: BillingCallableName; payload: Record<string, unknown> }> = [];
  const callables = createBillingCallables(async <T,>(
    name: BillingCallableName,
    payload: Record<string, unknown>,
  ) => {
    calls.push({ name, payload });
    return {} as T;
  });
  return { calls, callables };
};

test('toda callable de billing exportada pelo backend tem wrapper, e só elas', () => {
  const exported = [...backendCallables.matchAll(/export const (\w+) = defineCallable\(/g)]
    .map((entry) => entry[1])
    .sort();
  assert.deepEqual([...BILLING_CALLABLES].sort(), exported);
  const { callables } = recorder();
  assert.deepEqual(Object.keys(callables).sort(), exported);
});

test('cada wrapper envia exatamente as chaves do schema estrito do backend', async () => {
  const { calls, callables } = recorder();
  await callables.getBillingCatalog();
  await callables.createCheckoutSession({ planId: 'pro', returnUrl: 'https://app.test' });
  await callables.createBillingPortalSession({ returnUrl: 'https://app.test' });

  assert.deepEqual(calls.map((call) => call.name), [...BILLING_CALLABLES]);
  for (const { name, payload } of calls) {
    assert.deepEqual(Object.keys(payload).sort(), schemaKeys(name), name);
    assert.ok(Object.values(payload).every((value) => value !== undefined), name);
  }
});

test('checkout envia planId, returnUrl e idempotencyKey, nunca priceId, com chave nova a cada chamada', async () => {
  const { calls, callables } = recorder();
  await callables.createCheckoutSession({ planId: 'business', returnUrl: 'https://app.test' });
  await callables.createCheckoutSession({ planId: 'business', returnUrl: 'https://app.test' });

  for (const { payload } of calls) {
    assert.deepEqual(Object.keys(payload).sort(), ['idempotencyKey', 'planId', 'returnUrl']);
    assert.equal(payload.planId, 'business');
    assert.equal('priceId' in payload, false);
    assert.equal(typeof payload.idempotencyKey, 'string');
  }
  assert.notEqual(calls[0].payload.idempotencyKey, calls[1].payload.idempotencyKey);
});

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);
const at = (offsetMs: number) => new Date(NOW + offsetMs);

const account = (overrides: Partial<BillingAccount> = {}): BillingAccount => ({
  planId: 'pro',
  entitlementStatus: 'active',
  subscriptionStatus: 'active',
  graceUntil: null,
  currentPeriodEnd: at(10 * DAY),
  cancelAtPeriodEnd: false,
  cancelAt: null,
  hasCustomer: true,
  ...overrides,
});

test('displayEntitlement: sem conta é gratuito', () => {
  assert.deepEqual(displayEntitlement(null, NOW), { planId: 'free', status: 'free' });
});

test('displayEntitlement: assinatura ativa mantém plano e status', () => {
  assert.deepEqual(displayEntitlement(account(), NOW), { planId: 'pro', status: 'active' });
});

test('displayEntitlement: carência vale até graceUntil e restringe depois', () => {
  const grace = { entitlementStatus: 'grace' as const, subscriptionStatus: 'past_due' as const };
  assert.deepEqual(
    displayEntitlement(account({ ...grace, graceUntil: at(DAY) }), NOW),
    { planId: 'pro', status: 'grace' },
  );
  assert.deepEqual(
    displayEntitlement(account({ ...grace, graceUntil: at(-DAY) }), NOW),
    { planId: 'free', status: 'restricted' },
  );
  assert.deepEqual(
    displayEntitlement(account({ ...grace, graceUntil: at(0) }), NOW),
    { planId: 'free', status: 'restricted' },
  );
  assert.deepEqual(
    displayEntitlement(account({ ...grace, graceUntil: null }), NOW),
    { planId: 'free', status: 'restricted' },
  );
});

test('displayEntitlement: cancelamento no fim do período só encerra o acesso após o fim', () => {
  assert.deepEqual(
    displayEntitlement(account({ cancelAtPeriodEnd: true, currentPeriodEnd: at(DAY) }), NOW),
    { planId: 'pro', status: 'active' },
  );
  assert.deepEqual(
    displayEntitlement(account({ cancelAtPeriodEnd: true, currentPeriodEnd: at(-DAY) }), NOW),
    { planId: 'free', status: 'free' },
  );
  // Sem pedido de cancelamento, o fim do período não encerra o acesso na exibição.
  assert.deepEqual(
    displayEntitlement(account({ cancelAtPeriodEnd: false, currentPeriodEnd: at(-DAY) }), NOW),
    { planId: 'pro', status: 'active' },
  );
});

test('displayEntitlement: cancelAt tem precedência sobre o fim do período', () => {
  assert.deepEqual(
    displayEntitlement(
      account({ cancelAt: at(-DAY), cancelAtPeriodEnd: true, currentPeriodEnd: at(10 * DAY) }),
      NOW,
    ),
    { planId: 'free', status: 'free' },
  );
  assert.deepEqual(
    displayEntitlement(
      account({ cancelAt: at(DAY), cancelAtPeriodEnd: true, currentPeriodEnd: at(-DAY) }),
      NOW,
    ),
    { planId: 'pro', status: 'active' },
  );
});

test('displayEntitlement: restricted e pending seguem o servidor', () => {
  assert.deepEqual(
    displayEntitlement(account({ planId: 'free', entitlementStatus: 'restricted' }), NOW),
    { planId: 'free', status: 'restricted' },
  );
  assert.deepEqual(
    displayEntitlement(
      account({ planId: 'free', entitlementStatus: 'pending', subscriptionStatus: 'incomplete' }),
      NOW,
    ),
    { planId: 'free', status: 'pending' },
  );
});

test('isPaidEntitlementActive só vale para plano pago ativo', () => {
  assert.equal(isPaidEntitlementActive({ planId: 'pro', status: 'active' }), true);
  assert.equal(isPaidEntitlementActive({ planId: 'business', status: 'active' }), true);
  assert.equal(isPaidEntitlementActive({ planId: 'free', status: 'active' }), false);
  assert.equal(isPaidEntitlementActive({ planId: 'pro', status: 'grace' }), false);
  assert.equal(isPaidEntitlementActive({ planId: 'free', status: 'pending' }), false);
});

test('hasManageableSubscription depende do status da assinatura e do cliente', () => {
  const manageable: SubscriptionStatus[] = [
    'active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused',
  ];
  const notManageable: SubscriptionStatus[] = ['none', 'canceled', 'incomplete_expired'];
  for (const subscriptionStatus of manageable) {
    assert.equal(hasManageableSubscription(account({ subscriptionStatus })), true, subscriptionStatus);
    assert.equal(
      hasManageableSubscription(account({ subscriptionStatus, hasCustomer: false })),
      false,
      `${subscriptionStatus} sem cliente`,
    );
  }
  for (const subscriptionStatus of notManageable) {
    assert.equal(hasManageableSubscription(account({ subscriptionStatus })), false, subscriptionStatus);
  }
  assert.equal(hasManageableSubscription(null), false);
});

// --- Guardas estáticas -----------------------------------------------------

const srcRoot = fileURLToPath(new URL('../../src', import.meta.url));

const listFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });

const sourceFiles = listFiles(srcRoot).filter((path) => /\.(ts|tsx)$/.test(path));
const read = (path: string) => readFileSync(path, 'utf8');

test('o plano legado do cliente não existe mais', () => {
  assert.equal(existsSync(join(srcRoot, 'constants', 'plans.ts')), false);
  assert.equal(existsSync(join(srcRoot, 'hooks', 'usePlan.ts')), false);
  for (const path of sourceFiles) {
    const content = read(path);
    assert.equal(content.includes('constants/plans'), false, `${path}: constants/plans`);
    assert.equal(content.includes('usePlan'), false, `${path}: usePlan`);
    assert.equal(/\bisPro\b/.test(content), false, `${path}: isPro`);
  }
});

test('nenhum arquivo do cliente lê planId do perfil users', () => {
  for (const path of sourceFiles) {
    const content = read(path);
    if (!content.includes('planId')) continue;
    assert.equal(/doc\(\s*db\s*,\s*['"]users['"]/.test(content), false, `${path}: planId do perfil users`);
  }
});

test('o módulo de billing e a tabela de preços não têm preço nem priceId fixos', () => {
  const files = listFiles(join(srcRoot, 'modules', 'billing')).filter((path) => /\.(ts|tsx)$/.test(path));
  assert.ok(files.length > 0);
  const forbidden = ['price_', 'priceId', 'R$ 29', 'R$ 59', '29,90', '59,90', '2990', '5990'];
  for (const path of files) {
    const content = read(path);
    for (const token of forbidden) {
      assert.equal(content.includes(token), false, `${path}: ${token}`);
    }
  }
});

test('billing só começa depois do bootstrap: BillingProvider abaixo do WorkspaceProvider', () => {
  const app = read(join(srcRoot, 'App.tsx'));
  const order = ['<WorkspaceProvider>', '<BillingProvider>', '</BillingProvider>', '</WorkspaceProvider>']
    .map((tag) => app.indexOf(tag));
  assert.ok(order.every((index) => index >= 0), 'providers montados em App.tsx');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'BillingProvider dentro do WorkspaceProvider');
  assert.ok(app.indexOf('<BillingSuccessModal />') > order[1], 'modal de billing dentro do BillingProvider');

  // Catálogo e listener ficam desligados até a conta do usuário atual estar pronta.
  const provider = read(join(srcRoot, 'modules', 'billing', 'BillingContext.tsx'));
  assert.match(provider, /const \{ isAccountReady \} = useWorkspace\(\);/);
  assert.match(provider, /const uid = user && isAccountReady \? user\.uid : null;/);
  assert.match(provider, /enabled: uid !== null,/);
  const workspace = read(join(srcRoot, 'contexts', 'WorkspaceContext.tsx'));
  assert.match(workspace, /isAccountReady: user !== null && accountReadyUid === user\.uid,/);
});
