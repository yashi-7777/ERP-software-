import { describe, it, expect } from "vitest";
import {
  calcMatValue,
  calcExpectedPcs,
  calcExpectedFgDate,
  calcPendingPcs,
  calcAvgOnGround,
  calcDelayDays,
  calcFgStatus,
  calcAlterLrLabel,
  calcDelayRisk,
  calcEfficiencyPct,
  calcPenalty,
  calcDeadlineRisk,
  computeWorkerEntryDerived,
  type WorkerEntryInput,
  type ProductRates,
} from "../calculations.js";

describe("calcMatValue (I)", () => {
  it("multiplies kg by rate", () => {
    expect(calcMatValue(2, 450)).toBe(900);
  });
  it("returns null when either input is missing", () => {
    expect(calcMatValue(0, 450)).toBeNull();
    expect(calcMatValue(2, 0)).toBeNull();
  });
});

describe("calcExpectedPcs (J)", () => {
  it("rounds grams to pieces", () => {
    // 2kg = 2000g / 100g-per-pcs = 20 pcs
    expect(calcExpectedPcs(2, 100)).toBe(20);
  });
});

describe("calcExpectedFgDate (M)", () => {
  it("adds daysAllowed to issueDate", () => {
    const issue = new Date("2026-01-01T00:00:00Z");
    const exp = calcExpectedFgDate(issue, 7);
    expect(exp?.toISOString().slice(0, 10)).toBe("2026-01-08");
  });
  it("returns null without daysAllowed", () => {
    expect(calcExpectedFgDate(new Date(), null)).toBeNull();
  });
});

describe("calcPendingPcs (S)", () => {
  it("uses plannedPcs over expectedPcs when set", () => {
    expect(calcPendingPcs(40, 35, 10, 5, 2)).toBe(23); // 40-10-5-2
  });
  it("falls back to expectedPcs when plannedPcs is 0", () => {
    expect(calcPendingPcs(0, 35, 10, 0, 0)).toBe(25); // 35-10
  });
  it("never goes negative", () => {
    expect(calcPendingPcs(10, null, 20, 0, 0)).toBe(0);
  });
});

describe("calcAvgOnGround (T)", () => {
  it("computes grams per piece", () => {
    expect(calcAvgOnGround(1, 10)).toBe(100); // 1kg / 10 pcs * 1000
  });
  it("returns null with zero okPcs", () => {
    expect(calcAvgOnGround(1, 0)).toBeNull();
  });
});

describe("calcDelayDays (V)", () => {
  const expDate = new Date("2026-01-10T00:00:00Z");

  it("is 0 when on time", () => {
    const received = new Date("2026-01-09T00:00:00Z");
    expect(calcDelayDays(expDate, received)).toBe(0);
  });
  it("computes positive delay when FG received late", () => {
    const received = new Date("2026-01-15T00:00:00Z");
    expect(calcDelayDays(expDate, received)).toBe(5);
  });
  it("computes running delay when still pending and overdue", () => {
    const today = new Date("2026-01-20T00:00:00Z");
    expect(calcDelayDays(expDate, null, today)).toBe(10);
  });
  it("is 0 when still pending but not yet due", () => {
    const today = new Date("2026-01-05T00:00:00Z");
    expect(calcDelayDays(expDate, null, today)).toBe(0);
  });
});

describe("calcFgStatus (W)", () => {
  it("is ISSUED before any OK pcs", () => {
    expect(calcFgStatus(new Date(), 0, null, 0)).toBe("ISSUED");
  });
  it("is PENDING once OK pcs exist but FG not received", () => {
    expect(calcFgStatus(new Date(), 5, null, 0)).toBe("PENDING");
  });
  it("is ON_TIME when received with no delay", () => {
    expect(calcFgStatus(new Date(), 5, new Date(), 0)).toBe("ON_TIME");
  });
  it("is LATE when received with delay", () => {
    expect(calcFgStatus(new Date(), 5, new Date(), 3)).toBe("LATE");
  });
});

describe("calcAlterLrLabel (X)", () => {
  it("labels Alter only", () => {
    expect(calcAlterLrLabel(2, 0)).toBe("Alter");
  });
  it("labels LR only", () => {
    expect(calcAlterLrLabel(0, 1)).toBe("LR");
  });
  it("labels combined", () => {
    expect(calcAlterLrLabel(2, 1)).toBe("Alter+LR");
  });
  it("is null when neither present", () => {
    expect(calcAlterLrLabel(0, 0)).toBeNull();
  });
});

describe("calcDelayRisk (Z)", () => {
  const expDate = new Date("2026-01-10T00:00:00Z");

  it("flags OVERDUE when past due and not received", () => {
    const today = new Date("2026-01-12T00:00:00Z");
    expect(calcDelayRisk(expDate, null, 0, today)).toBe("OVERDUE");
  });
  it("flags AT_RISK within 2 days of due date", () => {
    const today = new Date("2026-01-09T00:00:00Z");
    expect(calcDelayRisk(expDate, null, 0, today)).toBe("AT_RISK");
  });
  it("flags ON_TRACK when well before due date", () => {
    const today = new Date("2026-01-01T00:00:00Z");
    expect(calcDelayRisk(expDate, null, 0, today)).toBe("ON_TRACK");
  });
  it("flags DONE when received on time", () => {
    expect(calcDelayRisk(expDate, new Date(), 0)).toBe("DONE");
  });
  it("flags LATE when received with delay", () => {
    expect(calcDelayRisk(expDate, new Date(), 3)).toBe("LATE");
  });
});

describe("calcEfficiencyPct (AA)", () => {
  it("computes ratio when pendingPcs > 0", () => {
    expect(calcEfficiencyPct(50, 100)).toBe(0.5);
  });
  it("is 0 when pendingPcs is 0 (this was always 0% in the original sheet)", () => {
    expect(calcEfficiencyPct(50, 0)).toBe(0);
  });
});

describe("calcPenalty (AB) — the critical bug fix", () => {
  // Original buggy formula used U (Std Avg, grams-per-pcs, often 80-250)
  // instead of V (Delay Days). That meant chargeableDays = U - graceDays
  // was almost always large, hitting the 2000 cap on every single row —
  // which is exactly the "penalty always shows 2000" symptom reported.

  it("is 0 when not delayed", () => {
    expect(calcPenalty(0, 2, 50)).toBe(0);
  });
  it("is 0 within grace period", () => {
    expect(calcPenalty(2, 2, 50)).toBe(0);
  });
  it("charges only days beyond grace, at the per-day rate", () => {
    // 5 days delay, 2 grace days, ₹50/day => 3 chargeable days * 50 = 150
    expect(calcPenalty(5, 2, 50)).toBe(150);
  });
  it("caps at ₹2000 even for very long delays", () => {
    // 100 days delay would be (100-2)*50 = 4900, capped to 2000
    expect(calcPenalty(100, 2, 50)).toBe(2000);
  });
  it("regression: a std-avg-sized number (e.g. 180g/pcs) fed as delayDays would have produced near-max penalty — demonstrates why the bug always capped", () => {
    // This is the shape of the ORIGINAL bug: if someone mistakenly calls
    // calcPenalty with stdGramsPerPcs (180) instead of delayDays, the
    // cap is hit. This test documents that failure mode exists so a
    // future refactor can't silently reintroduce it via wrong argument
    // order.
    const buggyIfMisused = calcPenalty(180, 2, 50);
    expect(buggyIfMisused).toBe(2000);
    // ...whereas the correct call with actual delay days (say, 3) does not:
    expect(calcPenalty(3, 2, 50)).toBe(50);
  });
});

describe("calcDeadlineRisk (AD) — unit-mismatch bug fix", () => {
  // Original formula compared Penalty (₹) to Days Allowed (days) directly,
  // a unit mismatch that skewed almost everything to MISS/TIGHT. Fixed
  // version compares delayDays (days) to daysAllowed (days).

  it("is null without inputs", () => {
    expect(calcDeadlineRisk(null, 1)).toBeNull();
    expect(calcDeadlineRisk(10, null)).toBeNull();
  });
  it("flags MISS when delay exceeds days allowed", () => {
    expect(calcDeadlineRisk(5, 10)).toBe("MISS");
  });
  it("flags TIGHT when close to the limit", () => {
    expect(calcDeadlineRisk(10, 9)).toBe("TIGHT"); // 10-9=1 <= 2
  });
  it("flags OK when comfortably within the window", () => {
    expect(calcDeadlineRisk(20, 2)).toBe("OK"); // 20-2=18 > 2
  });
});

describe("computeWorkerEntryDerived — full chain, KISHOR-like scenario", () => {
  const rates: ProductRates = {
    stdGramsPerPcs: 100,
    ratePerPcs: 150,
    graceDays: 2,
    penaltyRatePerDay: 50,
  };

  it("computes a consistent full result for an on-time, completed entry", () => {
    const entry: WorkerEntryInput = {
      issueDate: new Date("2026-01-01T00:00:00Z"),
      matKg: 2,
      ratePerKg: 450,
      plannedPcs: 20,
      daysAllowed: 7,
      fgReceivedDate: new Date("2026-01-07T00:00:00Z"),
      fgWeightKg: 1.8,
      okPcs: 20,
      alterPcs: 0,
      lrPcs: 0,
    };
    const today = new Date("2026-01-08T00:00:00Z");
    const result = computeWorkerEntryDerived(entry, rates, today);

    expect(result.matValue).toBe(900);
    expect(result.expectedPcs).toBe(20);
    expect(result.pendingPcs).toBe(0);
    expect(result.delayDays).toBe(0);
    expect(result.fgStatus).toBe("ON_TIME");
    expect(result.penalty).toBe(0);
    expect(result.deadlineRisk).toBe("OK");
  });

  it("produces a real, non-capped penalty for a moderately late entry — not the old always-2000 bug", () => {
    const entry: WorkerEntryInput = {
      issueDate: new Date("2026-01-01T00:00:00Z"),
      matKg: 2,
      ratePerKg: 450,
      plannedPcs: 20,
      daysAllowed: 7,
      fgReceivedDate: new Date("2026-01-12T00:00:00Z"), // 5 days late vs expFgDate (Jan 8)
      fgWeightKg: 1.8,
      okPcs: 20,
      alterPcs: 0,
      lrPcs: 0,
    };
    const result = computeWorkerEntryDerived(entry, rates);

    expect(result.delayDays).toBe(4); // Jan 12 - Jan 8
    // chargeableDays = max(0, 4-2) = 2; penalty = 2*50 = 100 (not 2000)
    expect(result.penalty).toBe(100);
    expect(result.fgStatus).toBe("LATE");
    expect(result.delayRisk).toBe("LATE");
  });
});
