import assert from "node:assert/strict";
import test from "node:test";

import {CASH_ENTRY_MAX_CENTS} from "../../cash/contracts";
import {
  decimalAmountToCents,
  EXTRACTION_FIELDS,
  EXTRACTION_RESPONSE_SCHEMA,
  EXTRACTION_SYSTEM_INSTRUCTION,
  ExtractionResponseError,
  extractionModelOutputSchema,
  parseExtractionResponse,
  sanitizeExtractedText,
  type ExtractionResult,
} from "../extraction";

const TODAY = "2026-10-12";

const parse = (value: unknown): ExtractionResult =>
  parseExtractionResponse(JSON.stringify(value), TODAY);

const complete = {
  outcome: "extracted",
  operation: "expense",
  description: "Almoço com cliente",
  amount: "1234.56",
  date: "2026-10-10",
  categoryHint: "Alimentação",
  supplier: "Restaurante Bom Sabor",
  costCenterHint: "Comercial",
  installments: 1,
};

const assertResponseError = (fn: () => unknown, code: string) => {
  assert.throws(fn, (error: unknown) =>
    error instanceof ExtractionResponseError && error.code === code);
};

test("JSON válido e completo gera status complete com valores exatos", () => {
  const result = parse(complete);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.status, "complete");
  assert.deepEqual(result.fields.operation, {
    state: "identified", value: "expense",
  });
  assert.deepEqual(result.fields.amountCents, {
    state: "identified", value: 123456,
  });
  assert.deepEqual(result.fields.date, {
    state: "identified", value: "2026-10-10",
  });
  assert.deepEqual(result.fields.description, {
    state: "identified", value: "Almoço com cliente",
  });
  assert.deepEqual(result.fields.installments, {
    state: "identified", value: 1,
  });
});

test("resposta fora do contrato de transporte é rejeitada", () => {
  assertResponseError(() => parseExtractionResponse("{não é json", TODAY),
    "not_json");
  assertResponseError(() => parseExtractionResponse("", TODAY), "not_json");
  assertResponseError(() => parseExtractionResponse("[]", TODAY),
    "not_object");
  assertResponseError(
    () => parseExtractionResponse("[{\"outcome\":\"extracted\"}]", TODAY),
    "not_object");
  assertResponseError(() => parseExtractionResponse("null", TODAY),
    "not_object");
  assertResponseError(() => parseExtractionResponse("\"texto\"", TODAY),
    "not_object");
  assertResponseError(() => parseExtractionResponse("42", TODAY),
    "not_object");
});

test("chave desconhecida invalida a resposta inteira", () => {
  assertResponseError(() => parse({...complete, workspaceId: "outro"}),
    "schema");
  assertResponseError(() => parse({...complete, __proto_extra: true}),
    "schema");
});

test("tipos inesperados são rejeitados como schema", () => {
  assertResponseError(() => parse({...complete, amount: 1234.56}), "schema");
  assertResponseError(() => parse({...complete, installments: "12"}),
    "schema");
  assertResponseError(() => parse({...complete, installments: 1.5}),
    "schema");
  assertResponseError(() => parse({...complete, operation: "parcelado"}),
    "schema");
  assertResponseError(() => parse({...complete, operation: "investimento"}),
    "schema");
  assertResponseError(() => parse({...complete, outcome: "talvez"}),
    "schema");
  assertResponseError(() => parse({operation: "expense"}), "schema");
  assertResponseError(() => parse({
    ...complete, ambiguousFields: ["workspaceId"],
  }), "schema");
});

test("texto acima de rawTextMax é rejeitado", () => {
  assertResponseError(
    () => parseExtractionResponse(" ".repeat(20_001), TODAY), "schema");
});

test("a mensagem de ExtractionResponseError não contém o texto da resposta",
  () => {
    const inputs = [
      "SEGREDO-XYZ não é json",
      "[\"SEGREDO-XYZ\"]",
      JSON.stringify({outcome: "extracted", SEGREDO_XYZ: "SEGREDO-XYZ"}),
      JSON.stringify({outcome: "extracted", amount: 1, d: "SEGREDO-XYZ"}),
      `"${"SEGREDO-XYZ".repeat(3_000)}"`,
    ];
    for (const input of inputs) {
      try {
        parseExtractionResponse(input, TODAY);
        assert.fail("deveria ter lançado");
      } catch (error) {
        assert.ok(error instanceof ExtractionResponseError);
        assert.ok(!error.message.includes("SEGREDO"));
        assert.ok(!String(error.stack).includes("SEGREDO-XYZ"));
      }
    }
  });

test("valor ausente é missing e difere de zero", () => {
  assert.deepEqual(parse({outcome: "extracted"}).fields.amountCents,
    {state: "missing"});
  assert.deepEqual(
    parse({outcome: "extracted", amount: null}).fields.amountCents,
    {state: "missing"});
  assert.deepEqual(
    parse({outcome: "extracted", amount: "0"}).fields.amountCents,
    {state: "invalid", reason: "zero"});
  assert.deepEqual(
    parse({outcome: "extracted", amount: "0.00"}).fields.amountCents,
    {state: "invalid", reason: "zero"});
});

test("decimalAmountToCents converte sem ponto flutuante", () => {
  assert.deepEqual(decimalAmountToCents("1234.56"), {ok: true, cents: 123456});
  assert.deepEqual(decimalAmountToCents("10.5"), {ok: true, cents: 1050});
  assert.deepEqual(decimalAmountToCents("0.01"), {ok: true, cents: 1});
  assert.deepEqual(decimalAmountToCents("10"), {ok: true, cents: 1000});
  assert.deepEqual(decimalAmountToCents("0.29"), {ok: true, cents: 29});
  assert.deepEqual(decimalAmountToCents("1.15"), {ok: true, cents: 115});
  assert.deepEqual(decimalAmountToCents("19.99"), {ok: true, cents: 1999});
});

test("valor negativo e precisão acima de 2 casas são recusados", () => {
  assert.deepEqual(decimalAmountToCents("-10.00"),
    {ok: false, reason: "negative"});
  assert.deepEqual(decimalAmountToCents("-0"),
    {ok: false, reason: "negative"});
  assert.deepEqual(decimalAmountToCents("10.505"),
    {ok: false, reason: "precision"});
  assert.deepEqual(decimalAmountToCents("10.500"),
    {ok: false, reason: "precision"});
});

test("limite de valor: exatamente no teto passa, acima é too_large", () => {
  const atLimit = decimalAmountToCents(
    `${CASH_ENTRY_MAX_CENTS / 100}.00`);
  assert.deepEqual(atLimit, {ok: true, cents: CASH_ENTRY_MAX_CENTS});
  assert.deepEqual(decimalAmountToCents("1000000000.01"),
    {ok: false, reason: "too_large"});
  assert.deepEqual(decimalAmountToCents("9999999999999.99"),
    {ok: false, reason: "too_large"});
});

test("formatos inválidos de valor são format", () => {
  for (const value of [
    "NaN", "Infinity", "-Infinity", "1e3", "1E3", "1,234.56", "1.234,56",
    "10,50", "R$ 10", "R$10.00", " 10", "10 ", "", " ", ".5", "10.", "0x10",
    "1_000", "12345678901234",
  ]) {
    const expected = value === "-Infinity" ? "negative" : "format";
    assert.deepEqual(decimalAmountToCents(value),
      {ok: false, reason: expected}, `valor ${JSON.stringify(value)}`);
  }
});

test("datas: formato, inexistente e fora da faixa", () => {
  const dateOf = (date: string) =>
    parse({outcome: "extracted", date}).fields.date;
  assert.deepEqual(dateOf("2026-10-12"),
    {state: "identified", value: "2026-10-12"});
  assert.deepEqual(dateOf("12/10/2026"), {state: "invalid", reason: "format"});
  assert.deepEqual(dateOf("2026-2-3"), {state: "invalid", reason: "format"});
  assert.deepEqual(dateOf("2026-02-30"), {state: "invalid", reason: "format"});
  assert.deepEqual(dateOf("2026-10-12T10:00:00Z"),
    {state: "invalid", reason: "format"});
  assert.deepEqual(dateOf("1999-12-31"),
    {state: "invalid", reason: "out_of_range"});
  assert.deepEqual(dateOf("2000-01-01"),
    {state: "identified", value: "2000-01-01"});
  assert.deepEqual(dateOf("2028-01-01"),
    {state: "invalid", reason: "out_of_range"});
});

test("data: hoje+366 é aceita e hoje+367 é recusada", () => {
  // 2026-10-12 + 366 dias = 2027-10-13 (2027 não é bissexto).
  assert.deepEqual(
    parse({outcome: "extracted", date: "2027-10-13"}).fields.date,
    {state: "identified", value: "2027-10-13"});
  assert.deepEqual(
    parse({outcome: "extracted", date: "2027-10-14"}).fields.date,
    {state: "invalid", reason: "out_of_range"});
});

test("parcelamento: faixa, income e expense", () => {
  const installmentsOf = (extra: Record<string, unknown>) =>
    parse({outcome: "extracted", ...extra}).fields.installments;
  assert.deepEqual(installmentsOf({installments: 0}),
    {state: "invalid", reason: "out_of_range"});
  assert.deepEqual(installmentsOf({installments: 61}),
    {state: "invalid", reason: "out_of_range"});
  assert.deepEqual(installmentsOf({installments: -3}),
    {state: "invalid", reason: "out_of_range"});
  assert.deepEqual(installmentsOf({installments: 60}),
    {state: "identified", value: 60});
  assert.deepEqual(installmentsOf({installments: 1}),
    {state: "identified", value: 1});
  assert.deepEqual(installmentsOf({operation: "income", installments: 12}),
    {state: "invalid", reason: "not_applicable"});
  assert.deepEqual(installmentsOf({operation: "income", installments: 1}),
    {state: "identified", value: 1});
  assert.deepEqual(installmentsOf({operation: "expense", installments: 12}),
    {state: "identified", value: 12});
  assert.deepEqual(installmentsOf({installments: 12}),
    {state: "identified", value: 12});
  assert.deepEqual(installmentsOf({installments: null}),
    {state: "missing"});
});

test("descrição: limite de 120 caracteres e sanitização", () => {
  const descriptionOf = (description: string | null) =>
    parse({outcome: "extracted", description}).fields.description;
  assert.deepEqual(descriptionOf("a".repeat(120)),
    {state: "identified", value: "a".repeat(120)});
  assert.deepEqual(descriptionOf("a".repeat(121)),
    {state: "invalid", reason: "too_long"});
  assert.deepEqual(
    descriptionOf("  Compra\n\nde   material\r\n\u0000de\u0007 obra\t "),
    {state: "identified", value: "Compra de material de obra"});
  assert.deepEqual(descriptionOf("   \n\t "), {state: "missing"});
  assert.deepEqual(descriptionOf(null), {state: "missing"});
});

test("dicas e fornecedor respeitam os próprios limites", () => {
  const result = parse({
    outcome: "extracted",
    categoryHint: "c".repeat(61),
    supplier: "s".repeat(80),
    costCenterHint: "k".repeat(61),
  });
  assert.deepEqual(result.fields.categoryHint,
    {state: "invalid", reason: "too_long"});
  assert.deepEqual(result.fields.supplier,
    {state: "identified", value: "s".repeat(80)});
  assert.deepEqual(result.fields.costCenterHint,
    {state: "invalid", reason: "too_long"});
  assert.equal(result.status, "partial");
});

test("sanitizeExtractedText remove controles e colapsa espaços", () => {
  assert.equal(sanitizeExtractedText("  a\nb\r\nc\u2028d  "), "a b c d");
  assert.equal(sanitizeExtractedText("x\u0000y\u001fz\u007f"), "xyz");
  assert.equal(sanitizeExtractedText("a  \t  b"), "a b");
  assert.equal(sanitizeExtractedText("\n\n"), "");
});

test("outcome not_financial é refused com todos os campos missing", () => {
  const result = parse({
    ...complete,
    outcome: "not_financial",
    ambiguousFields: ["amount"],
  });
  assert.equal(result.status, "refused");
  for (const field of Object.values(result.fields)) {
    assert.deepEqual(field, {state: "missing"});
  }
  const bare = parse({outcome: "not_financial"});
  assert.equal(bare.status, "refused");
});

test("campos ambíguos perdem o valor e rebaixam o status", () => {
  const result = parse({...complete, ambiguousFields: ["amount", "date"]});
  assert.deepEqual(result.fields.amountCents, {state: "ambiguous"});
  assert.deepEqual(result.fields.date, {state: "ambiguous"});
  assert.deepEqual(result.fields.operation, {
    state: "identified", value: "expense",
  });
  assert.equal(result.status, "partial");
  assert.ok(!JSON.stringify(result.fields.amountCents).includes("123456"));
});

test("campo ambíguo ausente permanece missing", () => {
  const result = parse({outcome: "extracted", ambiguousFields: ["supplier"]});
  assert.deepEqual(result.fields.supplier, {state: "missing"});
});

test("resposta parcial (só descrição) é partial", () => {
  const result = parse({outcome: "extracted", description: "Padaria"});
  assert.equal(result.status, "partial");
  assert.deepEqual(result.fields.description,
    {state: "identified", value: "Padaria"});
  assert.deepEqual(result.fields.operation, {state: "missing"});
  assert.deepEqual(result.fields.amountCents, {state: "missing"});
  assert.deepEqual(result.fields.date, {state: "missing"});
});

test("valor inválido impede o status complete", () => {
  const result = parse({...complete, amount: "10,50"});
  assert.equal(result.status, "partial");
  assert.deepEqual(result.fields.amountCents,
    {state: "invalid", reason: "format"});
});

test("o resultado só contém chaves do contrato", () => {
  const result = parse({...complete, ambiguousFields: ["supplier"]});
  assert.deepEqual(Object.keys(result).sort(),
    ["fields", "schemaVersion", "status"]);
  assert.deepEqual(Object.keys(result.fields).sort(), [
    "amountCents", "categoryHint", "costCenterHint", "date", "description",
    "installments", "operation", "supplier",
  ]);
  assert.ok(!("outcome" in result));
  assert.ok(!("ambiguousFields" in result));
});

test("EXTRACTION_RESPONSE_SCHEMA espelha o schema do modelo", () => {
  const properties = EXTRACTION_RESPONSE_SCHEMA.properties as
    Record<string, unknown>;
  const zodKeys = Object.keys(extractionModelOutputSchema.shape).sort();
  assert.deepEqual(Object.keys(properties).sort(), zodKeys);
  assert.deepEqual(EXTRACTION_RESPONSE_SCHEMA.required, ["outcome"]);
  assert.equal(EXTRACTION_RESPONSE_SCHEMA.type, "object");
  const ambiguous = properties.ambiguousFields as
    {items: {enum: string[]}; maxItems: number};
  assert.deepEqual(ambiguous.items.enum, [...EXTRACTION_FIELDS]);
  assert.equal(ambiguous.maxItems, 8);
  assert.equal(EXTRACTION_RESPONSE_SCHEMA.additionalProperties, false);
  // JSON Schema padrão: anulável por `anyOf` com `null`, nunca `nullable`.
  assert.doesNotMatch(JSON.stringify(EXTRACTION_RESPONSE_SCHEMA), /nullable/);
  assert.deepEqual(properties.amount,
    {anyOf: [{type: "string"}, {type: "null"}]});
});

test("a instrução de sistema trata o conteúdo como não confiável", () => {
  assert.match(EXTRACTION_SYSTEM_INSTRUCTION, /NÃO CONFIÁVEL/);
  assert.match(EXTRACTION_SYSTEM_INSTRUCTION, /not_financial/);
  assert.match(EXTRACTION_SYSTEM_INSTRUCTION, /ambiguousFields/);
  assert.match(EXTRACTION_SYSTEM_INSTRUCTION, /YYYY-MM-DD/);
});
