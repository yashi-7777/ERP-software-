// ═══════════════════════════════════════════════════════════════
// CKNITZ ERP — Drizzle schema
// Modeled on the real Rousha Enterprises Google Sheets ERP:
// Master Control (rates) -> Register (lots) -> Worker Entries (outward)
// -> Ledger (payments). Column names kept close to the sheet so the
// mapping during data migration from e1.xlsx stays obvious.
// ═══════════════════════════════════════════════════════════════

import {
  pgTable,
  pgEnum,
  text,
  integer,
  numeric,
  timestamp,
  boolean,
  uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const roleEnum = pgEnum("role", ["ADMIN", "MANAGER", "OFFICE"]);
export const lotStatusEnum = pgEnum("lot_status", [
  "OPEN",
  "COMPLETED",
  "DELAYED",
  "ARCHIVED",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("OFFICE"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** ⚙️ MASTER CONTROL — product rate table (B6:F15 in the sheet) */
export const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(), // e.g. "Crochet Top"
  stdGramsPerPcs: numeric("std_grams_per_pcs", { precision: 10, scale: 2 })
    .notNull()
    .default("0"), // col E — "Std Avg" lookup source
  ratePerPcs: numeric("rate_per_pcs", { precision: 10, scale: 2 })
    .notNull()
    .default("0"), // col F
  minEfficiencyPct: numeric("min_efficiency_pct", { precision: 5, scale: 2 })
    .notNull()
    .default("0"), // col I — 0 across the board in the original sheet (flagged in audit)
  wastagePercent: numeric("wastage_percent", { precision: 5, scale: 2 })
    .notNull()
    .default("0"), // col G — 0 across the board in the original sheet (flagged in audit)
  graceDays: integer("grace_days").notNull().default(2), // col K — used in penalty calc
  penaltyRatePerDay: numeric("penalty_rate_per_day", {
    precision: 10,
    scale: 2,
  })
    .notNull()
    .default("50"), // col L — used in penalty calc
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** ⚙️ MASTER CONTROL — worker rate card (A20:C29) */
export const workers = pgTable("workers", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(), // e.g. "KISHOR"
  fgRatePerPcs: numeric("fg_rate_per_pcs", { precision: 10, scale: 2 })
    .notNull()
    .default("0"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** 📂 DATA MASTER — dropdown sources */
export const rmTypes = pgTable("rm_types", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
});

export const colorOptions = pgTable("color_options", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
});

export const customers = pgTable("customers", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
});

/** 📋 REGISTER — master lot tracker */
export const lots = pgTable("lots", {
  id: uuid("id").defaultRandom().primaryKey(),
  lotNo: text("lot_no").notNull().unique(), // "LOT-001"
  issueDate: timestamp("issue_date").notNull(),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id),
  colorId: uuid("color_id").references(() => colorOptions.id),
  rmTypeId: uuid("rm_type_id").references(() => rmTypes.id),
  workerId: uuid("worker_id")
    .notNull()
    .references(() => workers.id),

  matKg: numeric("mat_kg", { precision: 10, scale: 3 }).notNull().default("0"),
  rmRatePerKg: numeric("rm_rate_per_kg", { precision: 10, scale: 2 })
    .notNull()
    .default("0"), // manual — H in worker sheet
  plannedPcs: integer("planned_pcs").notNull().default(0),
  daysAllowed: integer("days_allowed"), // L — manual; drives expFgDate chain

  dyeSentDate: timestamp("dye_sent_date"),
  dyeReceivedDate: timestamp("dye_received_date"),
  rmIssueDate: timestamp("rm_issue_date"),

  fgReceivedDate: timestamp("fg_received_date"),
  fgWeightKg: numeric("fg_weight_kg", { precision: 10, scale: 3 }),
  okPcs: integer("ok_pcs").notNull().default(0),
  alterPcs: integer("alter_pcs").notNull().default(0),
  lrPcs: integer("lr_pcs").notNull().default(0), // manual

  status: lotStatusEnum("status").notNull().default("OPEN"),
  deadline: timestamp("deadline"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * 👷 Worker sheets — Material Outward block (rows 9-29 in the real sheet).
 * Feeds the J,S,T,U,V,W,X,Z,AA,AB,AC,AD calculation chain — now computed
 * server-side (see src/domain/calculations.ts) instead of via spreadsheet
 * formula. This fixes the AB penalty bug (used U/Std-Avg instead of
 * V/Delay-Days) found in the original sheet.
 */
export const workerEntries = pgTable("worker_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  lotId: uuid("lot_id")
    .notNull()
    .references(() => lots.id),
  workerId: uuid("worker_id")
    .notNull()
    .references(() => workers.id),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id),

  issueDate: timestamp("issue_date").notNull(),
  matKg: numeric("mat_kg", { precision: 10, scale: 3 }).notNull().default("0"), // G
  ratePerKg: numeric("rate_per_kg", { precision: 10, scale: 2 })
    .notNull()
    .default("0"), // H — manual
  plannedPcs: integer("planned_pcs").notNull().default(0), // K — manual
  daysAllowed: integer("days_allowed"), // L — manual; drives expFgDate

  fgReceivedDate: timestamp("fg_received_date"),
  fgWeightKg: numeric("fg_weight_kg", { precision: 10, scale: 3 }), // O
  okPcs: integer("ok_pcs").notNull().default(0), // P
  alterPcs: integer("alter_pcs").notNull().default(0), // Q
  lrPcs: integer("lr_pcs").notNull().default(0), // R — manual

  notes: text("notes"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * 💰 LEDGER — per-worker payable summary, rebuilt from WorkerEntry
 * aggregates rather than a spreadsheet SUM, so the row-6-excluded bug
 * (E3 = SUM(M7:M16) in the real Ledger sheet) structurally cannot recur.
 */
export const ledgerEntries = pgTable("ledger_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  workerId: uuid("worker_id")
    .notNull()
    .references(() => workers.id),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),

  fgValue: numeric("fg_value", { precision: 12, scale: 2 }).notNull().default("0"),
  alterDeduction: numeric("alter_deduction", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  penalty: numeric("penalty", { precision: 12, scale: 2 }).notNull().default("0"),
  grossPayable: numeric("gross_payable", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  paid: numeric("paid", { precision: 12, scale: 2 }).notNull().default("0"),
  outstanding: numeric("outstanding", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ───────────────────────── relations ─────────────────────────

export const productsRelations = relations(products, ({ many }) => ({
  lots: many(lots),
  workerEntries: many(workerEntries),
}));

export const workersRelations = relations(workers, ({ many }) => ({
  lots: many(lots),
  workerEntries: many(workerEntries),
  ledgerEntries: many(ledgerEntries),
}));

export const lotsRelations = relations(lots, ({ one, many }) => ({
  product: one(products, { fields: [lots.productId], references: [products.id] }),
  color: one(colorOptions, { fields: [lots.colorId], references: [colorOptions.id] }),
  rmType: one(rmTypes, { fields: [lots.rmTypeId], references: [rmTypes.id] }),
  worker: one(workers, { fields: [lots.workerId], references: [workers.id] }),
  workerEntries: many(workerEntries),
}));

export const workerEntriesRelations = relations(workerEntries, ({ one }) => ({
  lot: one(lots, { fields: [workerEntries.lotId], references: [lots.id] }),
  worker: one(workers, { fields: [workerEntries.workerId], references: [workers.id] }),
  product: one(products, { fields: [workerEntries.productId], references: [products.id] }),
}));

export const ledgerEntriesRelations = relations(ledgerEntries, ({ one }) => ({
  worker: one(workers, { fields: [ledgerEntries.workerId], references: [workers.id] }),
}));
