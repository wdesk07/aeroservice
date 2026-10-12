const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const BENIN_TIME_ZONE = "Africa/Porto-Novo";

function beninDateAndClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BENIN_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type) => parts.find((item) => item.type === type)?.value ?? "";
  const day = `${part("year")}-${part("month")}-${part("day")}`;
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: BENIN_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(now);
  return { day, clock };
}

function validateManualLateArrival(plannedTime, arrivalTime, amountInput, now = new Date()) {
  const { day, clock } = beninDateAndClock(now);
  const arrivedTime = arrivalTime || clock;
  if (typeof plannedTime !== "string" || typeof arrivedTime !== "string" ||
      !TIME_PATTERN.test(plannedTime) || !TIME_PATTERN.test(arrivedTime)) {
    return { ok: false, error: "Vérifiez l’heure prévue et l’heure d’arrivée." };
  }
  const amount = Number(amountInput);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, error: "Le montant du règlement doit être un nombre entier de FCFA supérieur à zéro." };
  }
  // Benin uses UTC+01:00. Explicit offset avoids dependence on the device timezone.
  const plannedAt = new Date(`${day}T${plannedTime}:00+01:00`);
  const arrivedAt = new Date(`${day}T${arrivedTime}:00+01:00`);
  const delayMinutes = Math.floor((arrivedAt.getTime() - plannedAt.getTime()) / 60000);
  if (!Number.isFinite(delayMinutes) || delayMinutes <= 0) {
    return { ok: false, error: "L’heure d’arrivée doit être postérieure à l’heure prévue pour enregistrer un retard." };
  }
  return { ok: true, plannedAt, arrivedAt, delayMinutes, amount };
}

module.exports = { validateManualLateArrival };
