import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { planLateArrivalSettlement } = require("../src/lib/penalty-settlement.js");

test("uses an existing automatic penalty only when the amount matches", () => {
  assert.deepEqual(planLateArrivalSettlement({ id: "p1", amount_fcfa: 1500 }, "1500"), {
    ok: true, needsPenalty: false, penaltyId: "p1", paymentAmount: 1500
  });
  assert.equal(planLateArrivalSettlement({ id: "p1", amount_fcfa: 1500 }, "2000").ok, false);
});

test("requires creating a penalty before any settlement payment when none exists", () => {
  const plan = planLateArrivalSettlement(null, "1500");
  assert.equal(plan.ok, true);
  assert.equal(plan.needsPenalty, true);
  assert.equal(plan.penaltyId, null);
  assert.equal(plan.paymentAmount, 1500);
});

test("rejects invalid settlement amounts or incomplete automatic penalties", () => {
  for (const amount of ["", "0", "-1", "1500.5", "9007199254740992"]) {
    assert.equal(planLateArrivalSettlement(null, amount).ok, false, amount);
  }
  assert.equal(planLateArrivalSettlement({ id: "", amount_fcfa: 1500 }, "1500").ok, false);
});
