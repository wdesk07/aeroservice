export type AttendanceCategory = "student" | "staff";
export type AttendancePolicy = {
  nominalTime: "09:00" | "08:30";
  toleranceMinutes: 15 | 0;
  cutoffTime: "09:15" | "08:30";
};
export type ArrivalClassification =
  | { ok: false; error: string }
  | {
      ok: true;
      category: AttendanceCategory;
      nominalTime: "09:00" | "08:30";
      toleranceMinutes: 15 | 0;
      cutoffTime: "09:15" | "08:30";
      arrivalTime: string;
      late: boolean;
      minutesAfterNominal: number;
      minutesAfterCutoff: number;
    };
export const ATTENDANCE_POLICY: Readonly<Record<AttendanceCategory, Readonly<AttendancePolicy>>>;
export function classifyArrival(
  personType: string,
  arrivalTime: string,
  now?: Date
): ArrivalClassification;
