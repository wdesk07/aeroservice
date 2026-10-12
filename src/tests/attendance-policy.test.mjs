import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { classifyArrival, ATTENDANCE_POLICY } = require("../src/lib/attendance-policy.js");

test("personnel, secrétariat et direction : 08:30 inclus, 08:31 en retard", () => {
  for (const type of ["staff", "personnel", "secretary", "director"]) {
    assert.equal(classifyArrival(type, "08:30").late, false, type);
    assert.equal(classifyArrival(type, "08:31").late, true, type);
  }
  assert.equal(ATTENDANCE_POLICY.staff.toleranceMinutes, 0);
});

test("apprenants : 09:00 et 09:15 inclus, 09:16 en retard", () => {
  assert.equal(classifyArrival("student", "09:00").late, false);
  assert.equal(classifyArrival("student", "09:15").late, false);
  assert.equal(classifyArrival("student", "09:16").late, true);
  assert.equal(ATTENDANCE_POLICY.student.toleranceMinutes, 15);
});

test("refuse les catégories et heures invalides", () => {
  assert.equal(classifyArrival("unknown", "09:00").ok, false);
  for (const time of ["9:00", "24:00", "12:60", "n'importe quoi"]) {
    assert.equal(classifyArrival("student", time).ok, false, time);
  }
});

test("retourne les minutes après l'heure nominale et après la limite tolérée", () => {
  const result = classifyArrival("student", "09:20");
  assert.equal(result.late, true);
  assert.equal(result.minutesAfterNominal, 20);
  assert.equal(result.minutesAfterCutoff, 5);
});
