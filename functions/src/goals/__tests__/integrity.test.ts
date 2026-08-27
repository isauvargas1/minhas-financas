import assert from "node:assert/strict";
import test from "node:test";

import {toMinorUnits} from "../operations";

test("valores monetários de meta usam centavos exatos", () => {
  assert.equal(toMinorUnits(0.01), 1);
  assert.equal(toMinorUnits(1234.56), 123456);
  assert.throws(() => toMinorUnits(10.001), /duas casas decimais/);
});
