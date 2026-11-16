// Sonda F1 (revisão financeira P5-F.1-R3): paridade entre o que o gatilho soma em `incomeCents`
// (`cashPeriodDeltaFor`, backend compilado em functions/lib) e o que o cliente tira da estimativa
// (`normalizeTransactionData` + `classifyIncomeDocument`/`excludedItemOf`), em documentos sorteados.
// A prova da R3 só diz que o conteúdo lido é o que a projeção contém; o valor tirado vem desta
// classificação. Divergência com o backend aceitando o documento = prova verdadeira com valor errado.
// Uso: node --experimental-strip-types sonda-f1-paridade-classificacao.mjs <WT>
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const WT = process.argv[2];
const require = createRequire(`${WT}/functions/package.json`);
const periods = require(`${WT}/functions/lib/cash/periods.js`);
const { classifyIncomeDocument, excludedItemOf, isExcludableIncome } = await import(pathToFileURL(`${WT}/src/modules/work-time/incomeBasis.ts`).href);
const { normalizeTransactionData } = await import(pathToFileURL(`${WT}/src/modules/transactions/contract.ts`).href);

let seed = 20261109;
const random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = (items) => items[Math.floor(random() * items.length)];
const maybe = (p, value) => (random() < p ? value : undefined);

const ts = { seconds: 1760000000, nanoseconds: 0, toMillis() { return 1760000000000; } };
const receivable = () => pick([
  { domainVersion: 1, receivableId: 'rcv_1', receivableMovementId: 'rmv_x', clientId: 'c1', kind: 'receipt', reversal: false, principalCents: pick([0, 1000, 100000]), interestCents: pick([0, 500]), penaltyCents: pick([0, 100]), discountCents: pick([0, 50]), currency: 'BRL' },
  { domainVersion: 1, receivableId: 'rcv_1', receivableMovementId: 'rmv_y', clientId: 'c1', kind: 'receipt', reversal: true, reversalOf: 'rmv_x', principalCents: pick([0, 1000, 100000]), interestCents: pick([0, 500]), penaltyCents: 0, discountCents: 0, currency: 'BRL' },
  { domainVersion: 2, receivableId: 'rcv_1', receivableMovementId: 'rmv_x', clientId: 'c1', kind: 'receipt', reversal: false, principalCents: 1000, interestCents: 0, penaltyCents: 0, discountCents: 0, currency: 'BRL' },
  { domainVersion: 1, receivableId: 'rcv_1', receivableMovementId: 'rmv_x', clientId: 'c1', kind: 'receipt', reversal: false, principalCents: 1000, interestCents: 0, penaltyCents: 0, discountCents: 0, currency: 'USD' },
  { domainVersion: 1, receivableId: 'rcv_1', receivableMovementId: 'rmv_x', clientId: 'c1', kind: 'receipt', reversal: false, principalCents: 0, interestCents: 0, penaltyCents: 0, discountCents: 10, currency: 'BRL' },
  { domainVersion: 1, receivableId: 'rcv_1', receivableMovementId: 'rmv_x', clientId: 'c1', kind: 'receipt', reversal: true, principalCents: 1000, interestCents: 0, penaltyCents: 0, discountCents: 0, currency: 'BRL' },
  { principalCents: 1000, reversal: false },
  null,
  'x',
]);
const doc = () => {
  const data = {
    type: pick(['receita', 'despesa', 'investimento', 'parcelado', undefined]),
    valueCents: pick([0, 1, 1000, 100000, 100_000_000_000, 100_000_000_001, -1, 1.5, '100', undefined]),
    date: pick(['2026-10-05', '2026-02-30', '2026-10-5', undefined, 20261005]),
    isPaid: pick([true, false, undefined, null, 'false', 0]),
    cashEntry: pick([undefined, { status: 'pending' }, { status: 'settled' }, { status: 'scheduled' }, null, 'x', { status: 'voided' }]),
    voidedAt: pick([undefined, undefined, undefined, null, ts, false, 0]),
    receivableEntry: maybe(0.35, receivable()),
    loanEntry: maybe(0.08, pick([{}, null, { domainVersion: 1 }])),
    creditCardPaymentEntry: maybe(0.06, pick([{}, null])),
    splitEntry: maybe(0.06, pick([{}, null])),
    investmentEntry: maybe(0.08, pick([{ amountCents: 1000 }, null])),
  };
  for (const key of Object.keys(data)) if (data[key] === undefined) delete data[key];
  return data;
};

let accepted = 0;
let normalized = 0;
let compared = 0;
const divergences = [];
for (let i = 0; i < 200000; i += 1) {
  const data = doc();
  let backendIncome;
  try {
    backendIncome = periods.cashPeriodDeltaFor(data).incomeCents;
    // O mês também precisa existir para o gatilho somar: sem `date` válido, `cashWritePlanFor` lança.
    periods.cashPeriodKeyFor(data);
  } catch {
    continue; // o gatilho não aplica este conteúdo: a marca nunca terá esta impressão
  }
  accepted += 1;
  const id = data.receivableEntry ? 'recvcash_' + 'a'.repeat(40) : 'tx1';
  const client = normalizeTransactionData(id, data, 'ws');
  if (client === null) continue; // o cliente não encontra: a prova recusa (`content`) se a marca disser vivo
  normalized += 1;
  const classification = classifyIncomeDocument(client);
  const item = excludedItemOf(client, null);
  compared += 1;
  // O valor tirado da estimativa: só o que `applyIncomeExclusions` desconta.
  const subtracted = item.classification && isExcludableIncome(item.classification) ? item.classification.contributionCents : 0;
  const mirrored = classification.contributionCents;
  // Divergência que importa: o espelho do cliente difere do incomeCents oficial, com o backend aceitando.
  if (mirrored !== backendIncome) {
    if (divergences.length < 12) divergences.push({ data, backendIncome, mirrored, subtracted, kind: classification.kind });
  }
}
console.log(JSON.stringify({ accepted, normalized, compared, divergences: divergences.length }, null, 0));
for (const item of divergences) console.log(JSON.stringify(item));
