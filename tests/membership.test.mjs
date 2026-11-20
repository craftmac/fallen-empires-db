// Monthly Membership SP (Base44 backend function in the-fallen-empires-hub).
// Tests the function's own date and grant logic without touching Base44.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { HUB_FILE } from "./harness.mjs";

const entry = path.resolve(path.dirname(HUB_FILE), "..", "..", "base44", "functions", "monthlyMembership", "entry.ts");

test("monthly membership grants 1 SP once per Chicago month", { skip: !fs.existsSync(entry) && "website repo not found" }, async () => {
  const src = fs.readFileSync(entry, "utf8");
  const body = src.slice(src.indexOf("const DESCRIPTION"), src.indexOf("export default"));
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tfe-qa-")), "membership.mts");
  fs.writeFileSync(tmp, body);
  const { currentMonth, alreadyGranted, grant } = await import(pathToFileURL(tmp).href);

  assert.equal(currentMonth(new Date("2026-12-01T05:30:00Z")), "2026-11", "11:30 pm Nov 30 in Chicago is still November");
  assert.equal(currentMonth(new Date("2026-12-01T07:00:00Z")), "2026-12");

  const sheet = { earnedSP: 84, spLog: [{ type: "earned", date: "2026-11-13", amount: 1, spMembership: 1 }] };
  assert.equal(alreadyGranted(sheet.spLog, "2026-11"), true, "manual membership SP counts");
  assert.equal(alreadyGranted(sheet.spLog, "2026-12"), false);

  const g = grant(sheet, "2026-12");
  assert.equal(g.earnedSP, 85);
  const e = g.spLog.at(-1);
  assert.equal(e.date, "2026-12-01"); assert.equal(e.description, "Monthly Membership"); assert.equal(e.amount, 1);
  assert.equal(alreadyGranted(g.spLog, "2026-12"), true, "never granted twice");
});
