import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { validateManualLateArrival } = require("../src/src/lib/attendance-validation.js");

const NOW = new Date("2026-10-12T09:00:00.000Z"); // 10:00 au Bénin

test("calcule correctement un retard de cinq minutes", () => {
  const result = validateManualLateArrival("08:00", "08:05", "1500", NOW);
  assert.equal(result.ok, true);
  assert.equal(result.delayMinutes, 5);
  assert.equal(result.amount, 1500);
  assert.equal(result.plannedAt.toISOString(), "2026-10-12T07:00:00.000Z");
  assert.equal(result.arrivedAt.toISOString(), "2026-10-12T07:05:00.000Z");
});

test("utilise l'heure du Bénin lorsque l'heure constatée est vide", () => {
  const result = validateManualLateArrival("09:00", "", "2000", NOW);
  assert.equal(result.ok, true);
  assert.equal(result.delayMinutes, 60);
});

test("refuse les heures mal formées", () => {
  for (const time of ["8:05", "24:00", "12:60", "abc"]) {
    assert.equal(validateManualLateArrival("08:00", time, "1500", NOW).ok, false, time);
  }
});

test("refuse un montant vide, décimal, nul, négatif ou trop grand", () => {
  for (const amount of ["", "1500.5", "0", "-1", "9007199254740992"]) {
    assert.equal(validateManualLateArrival("08:00", "08:05", amount, NOW).ok, false, amount);
  }
});

test("refuse une arrivée égale ou antérieure à l'heure prévue", () => {
  assert.equal(validateManualLateArrival("08:00", "08:00", "1500", NOW).ok, false);
  assert.equal(validateManualLateArrival("08:00", "07:59", "1500", NOW).ok, false);
});
