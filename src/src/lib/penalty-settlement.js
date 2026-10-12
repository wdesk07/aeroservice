function planLateArrivalSettlement(automaticPenalty, enteredAmount) {
  const amount = Number(enteredAmount);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, error: "Le montant du règlement doit être un entier positif en FCFA." };
  }
  if (automaticPenalty) {
    const penaltyId = typeof automaticPenalty.id === "string" ? automaticPenalty.id : "";
    const penaltyAmount = Number(automaticPenalty.amount_fcfa);
    if (!penaltyId || !Number.isSafeInteger(penaltyAmount) || penaltyAmount <= 0) {
      return { ok: false, error: "La pénalité automatique est incomplète; aucun paiement n'a été créé." };
    }
    if (penaltyAmount !== amount) {
      return { ok: false, error: "Le montant saisi ne correspond pas à la pénalité calculée (" + penaltyAmount + " FCFA)." };
    }
    return { ok: true, needsPenalty: false, penaltyId, paymentAmount: penaltyAmount };
  }
  return { ok: true, needsPenalty: true, penaltyId: null, paymentAmount: amount };
}
module.exports = { planLateArrivalSettlement };
