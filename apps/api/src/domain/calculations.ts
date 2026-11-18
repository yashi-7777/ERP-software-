// ═══════════════════════════════════════════════════════════════
// CKNITZ ERP — production calculation engine
//
// This ports the Material Outward block formulas (worker sheet rows
// 9-29, columns J/S/T/U/V/W/X/Z/AA/AB/AC/AD) from the original Google
// Sheet into plain, testable TypeScript. Every function below has a
// 1:1 comment back to the original spreadsheet cell it replaces.
//
// IMPORTANT FIX CARRIED OVER FROM THE EXCEL PASS:
// The original AB (Penalty) formula used U (Std Avg — grams/pcs for
// the product) instead of V (Delay Days) as the "how late is this"
// input. That bug made every worker's penalty cap out at the ₹2000
// ceiling regardless of actual delay, and fed garbage into the
// Ledger (observed as -₹90,000+ "payable" on KISHOR/OFFICE).
// calcPenalty() below uses delayDays (the correct input) throughout.
// ═══════════════════════════════════════════════════════════════

export interface ProductRates {
  stdGramsPerPcs: number; // Master Control col E (worker-sheet U lookup)
  ratePerPcs: number; // Master Control col F
  graceDays: number; // Master Control col K
  penaltyRatePerDay: number; // Master Control col L
}

export interface WorkerEntryInput {
  issueDate: Date;
  matKg: number; // G
  ratePerKg: number; // H — manual
  plannedPcs: number; // K — manual
  daysAllowed: number | null; // L — manual; drives expFgDate chain
  fgReceivedDate: Date | null; // N
  fgWeightKg: number | null; // O
  okPcs: number; // P
  alterPcs: number; // Q
  lrPcs: number; // R — manual
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / DAY_MS);
}

/** I = Mat Value ₹ = G × H */
export function calcMatValue(matKg: number, ratePerKg: number): number | null {
  if (!matKg || !ratePerKg) return null;
  return round2(matKg * ratePerKg);
}

/** J = Exp PCS (auto) = ROUND(G × 1000 / stdGramsPerPcs, 0) */
export function calcExpectedPcs(matKg: number, stdGramsPerPcs: number): number | null {
  if (!matKg || !stdGramsPerPcs) return null;
  return Math.round((matKg * 1000) / stdGramsPerPcs);
}

/** M = Exp FG Date = issueDate + daysAllowed (only when daysAllowed is set) */
export function calcExpectedFgDate(issueDate: Date, daysAllowed: number | null): Date | null {
  if (!daysAllowed || daysAllowed <= 0) return null;
  return new Date(issueDate.getTime() + daysAllowed * DAY_MS);
}

/** S = Pending PCS = MAX(0, (plannedPcs || expPcs) - okPcs - alterPcs - lrPcs) */
export function calcPendingPcs(
  plannedPcs: number,
  expectedPcs: number | null,
  okPcs: number,
  alterPcs: number,
  lrPcs: number
): number {
  const base = plannedPcs > 0 ? plannedPcs : expectedPcs ?? 0;
  return Math.max(0, base - okPcs - alterPcs - lrPcs);
}

/** T = Avg On Ground (g/pcs) = ROUND(fgWeightKg / okPcs × 1000, 1) */
export function calcAvgOnGround(fgWeightKg: number | null, okPcs: number): number | null {
  if (!fgWeightKg || okPcs <= 0) return null;
  return Math.round(((fgWeightKg / okPcs) * 1000 + Number.EPSILON) * 10) / 10;
}

/** U = Std Avg — direct passthrough of the product's Master Control rate */
export function calcStdAvg(stdGramsPerPcs: number): number {
  return stdGramsPerPcs;
}

/**
 * V = Delay Days
 * - If FG received: MAX(0, fgReceivedDate - expFgDate)
 * - Else if overdue (today > expFgDate): today - expFgDate
 * - Else 0
 */
export function calcDelayDays(
  expFgDate: Date | null,
  fgReceivedDate: Date | null,
  today: Date = new Date()
): number {
  if (!expFgDate) return 0;
  if (fgReceivedDate) {
    return Math.max(0, daysBetween(fgReceivedDate, expFgDate));
  }
  if (expFgDate < today) {
    return daysBetween(today, expFgDate);
  }
  return 0;
}

export type FgStatus = "ISSUED" | "PENDING" | "ON_TIME" | "LATE";

/** W = FG Status */
export function calcFgStatus(
  issueDate: Date | null,
  okPcs: number,
  fgReceivedDate: Date | null,
  delayDays: number
): FgStatus | null {
  if (!issueDate) return null;
  if (okPcs > 0) {
    if (fgReceivedDate) {
      return delayDays > 0 ? "LATE" : "ON_TIME";
    }
    return "PENDING";
  }
  return "ISSUED";
}

/** X = Alter?/LR? label, derived from Q (alterPcs) / R (lrPcs) */
export function calcAlterLrLabel(alterPcs: number, lrPcs: number): "Alter+LR" | "Alter" | "LR" | null {
  const hasAlter = alterPcs > 0;
  const hasLr = lrPcs > 0;
  if (hasAlter && hasLr) return "Alter+LR";
  if (hasAlter) return "Alter";
  if (hasLr) return "LR";
  return null;
}

export type DelayRisk = "ON_TRACK" | "AT_RISK" | "OVERDUE" | "DONE" | "LATE";

/** Z = Delay Risk */
export function calcDelayRisk(
  expFgDate: Date | null,
  fgReceivedDate: Date | null,
  delayDays: number,
  today: Date = new Date()
): DelayRisk | null {
  if (!expFgDate) return null;
  if (!fgReceivedDate && expFgDate < today) return "OVERDUE";
  if (fgReceivedDate) return delayDays > 0 ? "LATE" : "DONE";
  const daysLeft = daysBetween(expFgDate, today);
  return daysLeft <= 2 ? "AT_RISK" : "ON_TRACK";
}

/** AA = Efficiency % = avgOnGround / pendingPcs (only when pendingPcs > 0) */
export function calcEfficiencyPct(avgOnGround: number | null, pendingPcs: number): number {
  if (!avgOnGround || pendingPcs <= 0) return 0;
  return round2(avgOnGround / pendingPcs);
}

/**
 * AB = Penalty ₹  — FIXED VERSION
 * Original (buggy): MIN(MAX(0, U - graceDays) × penaltyRate, 2000)
 *   — used U (Std Avg / grams-per-pcs) instead of delay days, so the
 *     ₹2000 cap was hit almost every time regardless of actual lateness.
 * Fixed: MIN(MAX(0, delayDays - graceDays) × penaltyRate, 2000)
 */
export function calcPenalty(delayDays: number, graceDays: number, penaltyRatePerDay: number): number {
  const chargeableDays = Math.max(0, delayDays - graceDays);
  return Math.min(chargeableDays * penaltyRatePerDay, 2000);
}

/**
 * AC = Forecast completion date, based on current pace.
 * N + (plannedPcs - okPcs) / max(1, okPcs / max(1, today - issueDate))
 */
export function calcForecastDate(
  issueDate: Date,
  plannedPcs: number,
  okPcs: number,
  fgReceivedDate: Date | null,
  today: Date = new Date()
): Date | null {
  if (!(okPcs > 0 && plannedPcs > 0 && fgReceivedDate)) return null;
  const daysElapsed = Math.max(1, daysBetween(today, issueDate));
  const paceDaysPerPcs = Math.max(1, okPcs / daysElapsed);
  const remaining = plannedPcs - okPcs;
  const extraDays = remaining / paceDaysPerPcs;
  return new Date(fgReceivedDate.getTime() + extraDays * DAY_MS);
}

export type DeadlineRisk = "MISS" | "TIGHT" | "OK" | null;

/**
 * AD = Deadline Risk — SECOND BUG FOUND AND FIXED HERE.
 * Original: =IF(OR(L="",AB=""),"—",IF(AB>L,"MISS",IF(AB-L<=2,"TIGHT","OK")))
 * This compared AB (Penalty, in ₹) directly against L (Days Allowed, in
 * days) — a unit mismatch. Penalty in rupees routinely exceeds a small
 * days-allowed number even for a trivial delay, so it skewed heavily
 * toward MISS/TIGHT and "OK" almost never appeared.
 * Fixed: compare delayDays (days) against daysAllowed (days) — matching
 * units, same spirit as the original intent ("are we going to miss the
 * turnaround window").
 */
export function calcDeadlineRisk(
  daysAllowed: number | null,
  delayDays: number | null
): DeadlineRisk {
  if (daysAllowed == null || delayDays == null) return null;
  if (delayDays > daysAllowed) return "MISS";
  if (daysAllowed - delayDays <= 2) return "TIGHT";
  return "OK";
}

/**
 * Runs the full calculation chain for one worker entry, in the same
 * order the spreadsheet columns depended on each other. Call this
 * instead of re-deriving fields ad hoc so the dependency order never
 * drifts between callers (API route vs batch job vs tests).
 */
export function computeWorkerEntryDerived(entry: WorkerEntryInput, rates: ProductRates, today: Date = new Date()) {
  const matValue = calcMatValue(entry.matKg, entry.ratePerKg);
  const expectedPcs = calcExpectedPcs(entry.matKg, rates.stdGramsPerPcs);
  const expFgDate = calcExpectedFgDate(entry.issueDate, entry.daysAllowed);
  const pendingPcs = calcPendingPcs(entry.plannedPcs, expectedPcs, entry.okPcs, entry.alterPcs, entry.lrPcs);
  const avgOnGround = calcAvgOnGround(entry.fgWeightKg, entry.okPcs);
  const stdAvg = calcStdAvg(rates.stdGramsPerPcs);
  const delayDays = calcDelayDays(expFgDate, entry.fgReceivedDate, today);
  const fgStatus = calcFgStatus(entry.issueDate, entry.okPcs, entry.fgReceivedDate, delayDays);
  const alterLrLabel = calcAlterLrLabel(entry.alterPcs, entry.lrPcs);
  const delayRisk = calcDelayRisk(expFgDate, entry.fgReceivedDate, delayDays, today);
  const efficiencyPct = calcEfficiencyPct(avgOnGround, pendingPcs);
  const penalty = calcPenalty(delayDays, rates.graceDays, rates.penaltyRatePerDay);
  const forecastDate = calcForecastDate(entry.issueDate, entry.plannedPcs, entry.okPcs, entry.fgReceivedDate, today);
  const deadlineRisk = calcDeadlineRisk(entry.daysAllowed, delayDays);

  return {
    matValue,
    expectedPcs,
    expFgDate,
    pendingPcs,
    avgOnGround,
    stdAvg,
    delayDays,
    fgStatus,
    alterLrLabel,
    delayRisk,
    efficiencyPct,
    penalty,
    forecastDate,
    deadlineRisk,
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
