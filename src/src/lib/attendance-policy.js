const ATTENDANCE_POLICY = Object.freeze({
  student: Object.freeze({ nominalTime: "09:00", toleranceMinutes: 15, cutoffTime: "09:15" }),
  staff: Object.freeze({ nominalTime: "08:30", toleranceMinutes: 0, cutoffTime: "08:30" }),
});

function classifyArrival(personType, arrivalTime, now = new Date()) {
  const type = String(personType ?? "").toLowerCase();
  const category = ["student", "apprenant", "learner"].includes(type)
    ? "student"
    : ["staff", "personnel", "secretary", "secretariat", "secretaire", "director", "directeur"].includes(type)
      ? "staff"
      : null;

  if (!category) {
    return { ok: false, error: "Catégorie de personne inconnue." };
  }
  let effectiveArrivalTime = arrivalTime;
  if (!effectiveArrivalTime) {
    effectiveArrivalTime = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Porto-Novo",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(now);
  }
  if (typeof effectiveArrivalTime !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(effectiveArrivalTime)) {
    return { ok: false, error: "Saisissez une heure d’arrivée valide au format HH:mm." };
  }

  const policy = ATTENDANCE_POLICY[category];
  const toMinutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const arrivalMinutes = toMinutes(effectiveArrivalTime);
  const nominalMinutes = toMinutes(policy.nominalTime);
  const cutoffMinutes = toMinutes(policy.cutoffTime);
  const late = arrivalMinutes > cutoffMinutes;

  return {
    ok: true,
    category,
    nominalTime: policy.nominalTime,
    toleranceMinutes: policy.toleranceMinutes,
    cutoffTime: policy.cutoffTime,
    arrivalTime,
    late,
    minutesAfterNominal: Math.max(0, arrivalMinutes - nominalMinutes),
    minutesAfterCutoff: Math.max(0, arrivalMinutes - cutoffMinutes),
  };
}

module.exports = { ATTENDANCE_POLICY, classifyArrival };
