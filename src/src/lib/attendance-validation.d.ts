export type ManualLateArrivalValidation =
  | { ok: false; error: string }
  | { ok: true; plannedAt: Date; arrivedAt: Date; delayMinutes: number; amount: number };

export function validateManualLateArrival(
  plannedTime: string,
  arrivalTime: string,
  amountInput: string | number,
  now?: Date
): ManualLateArrivalValidation;
