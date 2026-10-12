export type PenaltySettlementPlan =
  | { ok: false; error: string }
  | { ok: true; needsPenalty: boolean; penaltyId: string | null; paymentAmount: number };
export function planLateArrivalSettlement(
  automaticPenalty: { id?: string | null; amount_fcfa?: number | string | null; status?: string | null } | null,
  enteredAmount: number | string
): PenaltySettlementPlan;
