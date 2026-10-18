import assert from "node:assert/strict";
import {readFileSync, readdirSync, statSync} from "node:fs";
import path from "node:path";
import test from "node:test";

import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {
  syncReceivableOverdueWork,
  type ReceivableOverdueShape,
} from "../producers/receivableQueue";

/**
 * P5-D2.1 — tabela de decisão do enfileiramento, sem Emulator: a função
 * recebe a transação da operação de domínio e só enfileira escritas (nenhuma
 * leitura). Aqui a transação é um gravador das chamadas.
 */
if (!admin.apps.length) {
  admin.initializeApp({projectId: "minhas-financas-local"});
}

type Call = {
  op: "set" | "delete";
  path: string;
  data?: Record<string, unknown>;
};

const recorder = () => {
  const calls: Call[] = [];
  const transaction = {
    set: (ref: admin.firestore.DocumentReference,
      data: Record<string, unknown>) => {
      calls.push({op: "set", path: ref.path, data});
      return transaction;
    },
    delete: (ref: admin.firestore.DocumentReference) => {
      calls.push({op: "delete", path: ref.path});
      return transaction;
    },
    get: () => {
      throw new Error("o enfileiramento não pode ler");
    },
    update: () => {
      throw new Error("o enfileiramento não usa update");
    },
    create: () => {
      throw new Error("o enfileiramento não usa create");
    },
  };
  return {calls, transaction: transaction as unknown as
    admin.firestore.Transaction};
};

const WS = "ws-queue-unit";
const RC = "rcv-unit";
/** Dia civil da operação de domínio nos casos abaixo. */
const TODAY = "2030-06-15";
const PATH = `workspaces/${WS}/receivable_overdue_queue/${RC}`;
const open = (dueDate: string, balanceCents = 10_000): ReceivableOverdueShape =>
  ({status: "open", balanceCents, dueDate});

const sync = (
  before: ReceivableOverdueShape | null,
  after: ReceivableOverdueShape,
  today = TODAY,
) => {
  const {calls, transaction} = recorder();
  syncReceivableOverdueWork(transaction, {
    workspaceId: WS, receivableId: RC, before, after, today,
  });
  return calls;
};

const expectEnqueued = (
  calls: Call[],
  dueDate: string,
  runAfterDay: string,
) => {
  assert.equal(calls.length, 1);
  assert.equal(calls[0].op, "set");
  assert.equal(calls[0].path, PATH);
  assert.deepEqual(Object.keys(calls[0].data ?? {}).sort(), [
    "attempts", "dueDate", "lastAttemptAt", "lastErrorCode", "receivableId",
    "runAfterDay", "schemaVersion", "updatedAt", "workspaceId",
  ], "só identificadores, datas e estado de tentativa: nenhum valor ou PII");
  const data = calls[0].data ?? {};
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.workspaceId, WS);
  assert.equal(data.receivableId, RC);
  assert.equal(data.dueDate, dueDate);
  assert.equal(data.runAfterDay, runAfterDay);
  assert.equal(data.attempts, 0, "novo episódio zera as tentativas");
  assert.equal(data.lastErrorCode, null);
  assert.equal(data.lastAttemptAt, null);
  assert.ok((data.updatedAt as FieldValue).isEqual(
    FieldValue.serverTimestamp()));
};

test("criação aberta com saldo enfileira para o dia em que fica devido: " +
  "o seguinte ao vencimento, ou o próprio dia se o vencimento já passou " +
  "(semanas, meses ou anos atrás)", () => {
  expectEnqueued(sync(null, open("2030-06-20")), "2030-06-20", "2030-06-21");
  expectEnqueued(sync(null, open("2030-06-15")), "2030-06-15", "2030-06-16");
  expectEnqueued(sync(null, open("2030-06-14")), "2030-06-14", "2030-06-15");
  expectEnqueued(sync(null, open("2030-05-01")), "2030-05-01", "2030-06-15");
  expectEnqueued(sync(null, open("2027-01-31")), "2027-01-31", "2030-06-15");
  expectEnqueued(sync(null, open("2000-01-01")), "2000-01-01", "2030-06-15",
  );
  // Virada de ano e 29 de fevereiro pelo calendário civil.
  expectEnqueued(sync(null, open("2030-12-31")), "2030-12-31", "2031-01-01");
  expectEnqueued(sync(null, open("2032-02-28")), "2032-02-28", "2032-02-29");
});

test("vencimento retroativo não fura a fila: entra no dia do enfileiramento, " +
  "atrás de quem ficou devido antes", () => {
  const [early] = sync(null, open("2030-06-01"), "2030-06-02");
  const [retro] = sync(null, open("2000-01-01"), "2030-06-15");
  const [edit] = sync(open("2030-07-01"), open("1999-12-31"), "2030-06-20");
  assert.equal(early.data?.runAfterDay, "2030-06-02");
  assert.equal(retro.data?.runAfterDay, "2030-06-15");
  assert.equal(edit.data?.runAfterDay, "2030-06-20");
  assert.ok(String(early.data?.runAfterDay) < String(retro.data?.runAfterDay));
  assert.ok(String(retro.data?.runAfterDay) < String(edit.data?.runAfterDay));
});

test("criação fora da forma elegível não escreve nada", () => {
  assert.deepEqual(sync(null, open("2030-06-10", 0)), []);
  assert.deepEqual(sync(null, {status: "received", balanceCents: 0,
    dueDate: "2030-06-10"}), []);
  assert.deepEqual(sync(null, {status: "cancelled", balanceCents: 10_000,
    dueDate: "2030-06-10"}), []);
  assert.deepEqual(sync(null, open("10/06/2030")), [],
    "vencimento fora do contrato");
});

test("recebimento parcial (aberto → aberto, mesmo vencimento) não escreve: " +
  "nenhum segundo aviso do mesmo episódio", () => {
  assert.deepEqual(sync(open("2030-06-10", 10_000),
    open("2030-06-10", 4_000)), []);
});

test("quitação e cancelamento removem o trabalho pendente", () => {
  for (const after of [
    {status: "received", balanceCents: 0, dueDate: "2030-06-10"},
    {status: "cancelled", balanceCents: 10_000, dueDate: "2030-06-10"},
  ]) {
    assert.deepEqual(sync(open("2030-06-10"), after),
      [{op: "delete", path: PATH}]);
  }
});

test("estorno que reabre (recebido → aberto) devolve o mesmo episódio à " +
  "fila, devido no dia do estorno", () => {
  expectEnqueued(sync({status: "received", balanceCents: 0,
    dueDate: "2030-06-10"}, open("2030-06-10")), "2030-06-10", "2030-06-15");
  expectEnqueued(sync({status: "received", balanceCents: 0,
    dueDate: "2030-06-20"}, open("2030-06-20")), "2030-06-20", "2030-06-21");
});

test("mudança de vencimento reescreve o episódio; o mesmo não", () => {
  expectEnqueued(sync(open("2030-06-10"), open("2030-07-01")), "2030-07-01",
    "2030-07-02");
  expectEnqueued(sync(open("2030-07-01"), open("2029-03-01")), "2029-03-01",
    "2030-06-15");
  assert.deepEqual(sync(open("2030-06-10"), open("2030-06-10")), []);
  // Fechado continua fechado, mesmo com outro vencimento: nada a fazer.
  assert.deepEqual(sync({status: "cancelled", balanceCents: 10_000,
    dueDate: "2030-06-10"}, {status: "cancelled", balanceCents: 10_000,
    dueDate: "2030-07-10"}), []);
});

// ------------------------------------------------- escritores de recebíveis

/**
 * Guarda estática (L2 da revisão independente): toda escrita no recebível
 * enfileira ou retira o trabalho do aviso na mesma transação. Um escritor
 * novo de `receivables` (importação, reparo, eliminação) que pulasse a fila
 * recriaria o atraso nunca avisado sem nenhum teste de integração falhar.
 */
const SRC = path.resolve(__dirname, "..", "..", "..", "src");

const sourceFiles = (dir: string): string[] => readdirSync(dir).flatMap(
  (name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === "__tests__" || name === "testSupport" ?
        [] : sourceFiles(full);
    }
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [full] : [];
  });

/** Referências à coleção (imports de módulo não contam). */
const REFERENCES_RECEIVABLES = new RegExp([
  "receivablesRef\\(",
  "RECEIVABLES_COLLECTION",
  "collection(Group)?\\(\\s*[\"'`]receivables[\"'`]\\s*\\)",
  // `…/receivables/…`, `…/receivables` e o literal isolado em qualquer aspa
  "[\"'`/]receivables[\"'`/]",
].join("|"));
/** Escritas cujo alvo é uma referência de recebível, nas formas usuais. */
const WRITE_PATTERNS = [
  // transaction|batch.set/update/create/delete(…receivableRef, …), inclusive
  // receivablesRef(ws).doc(id) como alvo
  /\.(set|update|create|delete)\(\s*[^,()]*[rR]eceivables?Ref\b/g,
  // receivableRef.update(…)
  /[rR]eceivables?Ref\s*\.(set|update|create|delete)\(/g,
  // receivablesRef(ws).doc(id).update(…)
  /receivablesRef\([^)]*\)\s*\.doc\([^)]*\)\s*\.(set|update|create|delete)\(/g,
];
const SYNCS = /syncReceivableOverdueWork\(\s*transaction\s*,/g;

/**
 * Sem `import … from` e `export … from` (caminhos de módulo) e sem
 * comentários (que citam a coleção, mas não a acessam).
 */
const withoutImports = (text: string): string => text
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/^(import|export)\s[^;]*?\sfrom\s+["'][^"']+["'];?/gm, "")
  .replace(/require\(\s*["'][^"']+["']\s*\)/g, "");

const writesIn = (text: string) => WRITE_PATTERNS
  .flatMap((pattern) => [...text.matchAll(pattern)])
  .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

test("guarda: a detecção reconhece as formas de escrita e de " +
  "referência", () => {
  for (const sample of [
    "transaction.update(loaded.receivableRef, {})",
    "batch.set(receivableRef, data)",
    "loaded.receivableRef.update({status: \"x\"})",
    "receivablesRef(ws).doc(id).update({})",
    "transaction.delete(receivablesRef(ws).doc(id))",
    "transaction.set(\n      otherReceivableRef,\n      {})",
  ]) {
    assert.equal(writesIn(sample).length, 1, sample);
  }
  for (const sample of [
    "db.collectionGroup(\"receivables\")",
    "db.collection('receivables')",
    "`workspaces/${ws}/receivables/${id}`",
    "\"workspaces/\" + ws + \"/receivables/\" + id",
    "db.collection(`workspaces/${ws}/receivables`)",
    "const NAME = \"receivables\";",
    "receivablesRef(ws)",
  ]) {
    assert.ok(REFERENCES_RECEIVABLES.test(withoutImports(sample)), sample);
  }
  for (const sample of [
    "/** Recebível (`receivables`) e movimento. */",
    "  // grava em `receivables` só pela operação",
    "import {x} from \"../receivables/model\";",
    "export {receive} from\n  \"./receivables/callables\";",
  ]) {
    assert.ok(!REFERENCES_RECEIVABLES.test(withoutImports(sample)), sample);
  }
  for (const sample of [
    "transaction.getAll(queueRef, receivableRef)",
    "transaction.create(receivableMovementsRef(ws).doc(id), {})",
  ]) {
    assert.equal(writesIn(sample).length, 0, sample);
  }
});

test("guarda: só as operações de recebíveis escrevem em receivables, e " +
  "cada escrita sincroniza o trabalho do aviso na mesma transação", () => {
  const files = sourceFiles(SRC);
  const referencing = files.filter((file) => REFERENCES_RECEIVABLES.test(
    withoutImports(readFileSync(file, "utf8"))))
    .map((file) => path.relative(SRC, file)).sort();
  assert.deepEqual(referencing, [
    // Rótulo de classificação `"receivables"` de caixa e relatórios (não é a
    // coleção): referência só textual, sem escrita (conferido abaixo).
    "cash/periods.ts",
    "notifications/producers/receivables.ts",
    "receivables/clientOperations.ts",
    "receivables/model.ts",
    "receivables/operations.ts",
    "reports/categories.ts",
    "reports/contract.ts",
    "reports/debts.ts",
  ], "novo consumidor de receivables: se escrever, chame " +
    "syncReceivableOverdueWork na mesma transação e atualize esta lista");
  for (const file of files) {
    const relative = path.relative(SRC, file);
    const text = readFileSync(file, "utf8");
    const writes = writesIn(text);
    if (relative !== "receivables/operations.ts") {
      assert.deepEqual(writes.map((match) => match[0]), [],
        `${relative} não escreve no recebível`);
      continue;
    }
    const syncs = [...text.matchAll(SYNCS)].map((match) => match.index ?? 0);
    assert.equal(writes.length, 5,
      "criar, editar, receber, estornar e cancelar");
    assert.equal(syncs.length, writes.length);
    writes.forEach((write, index) => {
      const at = write.index ?? 0;
      const next = writes[index + 1]?.index ?? text.length;
      assert.ok(syncs.some((sync) => sync > at && sync < next),
        `escrita ${index + 1} sem sincronizar o trabalho do aviso`);
    });
  }
});
