// TFE Character Database regression suite. Run with:  ./qa check
// Every test runs against both copies of the app (GitHub Pages and the Base44
// website copy) when both are present; see tests/harness.mjs.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  TARGETS, startServer, stopServer, startBrowser, stopBrowser, open, char, skill, favor,
  text, pause, openCharacter, tab, unspent, save, back, printSheet, circles, stored,
} from "./harness.mjs";

before(async () => { await startServer(); await startBrowser(); });
after(async () => { await stopBrowser(); await stopServer(); });

// Opens the app, runs fn, then checks the page threw no JavaScript errors.
async function withApp(target, chars, opts, fn) {
  const app = await open(target, chars, opts);
  try { await fn(app); assert.deepEqual(app.errors, [], "page errors: " + app.errors.join(" | ")); }
  finally { await app.close(); }
}

for (const T of TARGETS) {
  describe(`${T.label}`, () => {
    // ---------------- Access, dashboard, notes ----------------
    describe("access and dashboard", () => {
      test("GM sees every character", () => withApp(T, [char({ name: "Alpha", playerName: "Ann" }), char({ name: "Bravo", playerName: "Ben" })], {}, async (app) => {
        const t = await text(app.frame);
        assert.match(t, /Alpha/); assert.match(t, /Bravo/);
      }));

      test("generated sample characters are removed; imported characters are kept", () => withApp(T, [
        char({ id: "seed-01", name: "Aldric Stoneheart", playerName: "Travis" }),
        char({ id: "seed-15", name: "Mira Sunsong", playerName: "Taylor" }),
        char({ name: "Imported Hero", playerName: "Real Player" }),
      ], {}, async (app) => {
        const t = await text(app.frame);
        assert.doesNotMatch(t, /Aldric Stoneheart|Mira Sunsong/);
        assert.match(t, /Imported Hero/);
        if (T.name === "gh") {
          const left = await app.page.evaluate(() => JSON.parse(localStorage.getItem("tfe_characters")).map((c) => c.name));
          assert.deepEqual(left, ["Imported Hero"]);
        } else {
          const rows = await app.page.evaluate(() => window.__store.rows.map((r) => r.name));
          assert.deepEqual(rows, ["Imported Hero"]);
        }
      }));

      test("no 'Load Test Data' button", () => withApp(T, [char()], {}, async (app) => {
        assert.equal(await app.frame.locator("text=Load Test Data").count(), 0);
      }));

      test("characters with notes get a red outline; others do not", () => withApp(T, [
        char({ name: "Has Notes", playerName: "Nina", notes: "Owes 3 crowns" }), char({ name: "No Notes", playerName: "Ned" }),
      ], {}, async (app) => {
        const style = async (n) => (await app.frame.locator("button").filter({ hasText: n }).first().getAttribute("style")) || "";
        assert.match(await style("Nina"), /red|#ef4444|rgb\(2(20|39)/i);
        assert.doesNotMatch(await style("Ned"), /red|#ef4444/i);
      }));

      test("a player sees only their own characters and cannot edit them", () => withApp(T, [
        char({ name: "Mine", playerName: "Pat", playerEmail: "pat@example.com" }),
        char({ name: "Not Mine", playerName: "Quinn", playerEmail: "quinn@example.com" }),
      ], { role: "player", email: "pat@example.com" }, async (app) => {
        const t = await text(app.frame);
        assert.match(t, /Mine/); assert.doesNotMatch(t, /Not Mine/);
        await openCharacter(app, "Mine", { edit: false });
        assert.equal(await app.frame.locator("button", { hasText: /^Edit/ }).count(), 0);
      }));

      if (T.name === "hub") {
        test("admin email on the main screen opens the GM view; no Google button", () => withApp(T, [
          char({ name: "Alpha", playerName: "Ann", playerEmail: "ann@example.com" }), char({ name: "Bravo", playerName: "Ben" }),
        ], { role: "player", email: "" }, async (app) => {
          const f = app.frame;
          assert.equal(await f.locator("text=GM sign in with Google").count(), 0);
          await f.fill("#tfe-login-email", " FallenEmpiresLLC@gmail.com "); await f.click("button[type=submit]"); await pause(f, 500);
          const t = await text(f);
          assert.match(t, /Alpha/); assert.match(t, /Bravo/); assert.match(t, /GM · fallenempiresllc@gmail.com/);
          await openCharacter(app, "Ben");
          assert.ok(await f.locator("button", { hasText: /^Save/ }).count(), "GM editor available");
          await back(app);
          await f.locator("button", { hasText: /Sign out/ }).first().click(); await pause(f, 300);
          assert.ok(await f.locator("#tfe-login-email").count(), "back at the login screen");
        }));
      }
      if (T.name === "hub") {
        test("player email login: unknown email is refused, case does not matter, Notes save", () => withApp(T, [
          char({ name: "Seraphine", playerName: "Jess", playerEmail: "jess@example.com" }),
        ], { role: "player", email: "" }, async (app) => {
          const f = app.frame;
          await f.fill("#tfe-login-email", "nobody@example.com"); await f.click("button[type=submit]"); await pause(f, 300);
          assert.ok((await f.locator("#tfe-login-error").innerText()).length > 0);
          await f.fill("#tfe-login-email", " JESS@Example.com "); await f.click("button[type=submit]"); await pause(f, 400);
          await openCharacter(app, "Seraphine", { edit: false });
          await f.fill("#tfe-player-notes", "Missed last event"); await f.click("text=Save notes"); await pause(f, 300);
          assert.equal((await stored(app, "Seraphine")).notes, "Missed last event");
        }));
      }
    });

    // ---------------- Editor behaviour ----------------
    describe("editor", () => {
      test("Save keeps the character open and shows Saved", () => withApp(T, [char({ name: "Saver", playerName: "Sam" })], {}, async (app) => {
        await openCharacter(app, "Sam");
        await app.frame.locator("label", { hasText: "Loose Paid" }).locator("input").fill("42");
        assert.equal(await app.frame.locator("button", { hasText: /^Save$/ }).count(), 1);
        await save(app);
        assert.equal(await app.frame.locator("button", { hasText: /^Saved/ }).count(), 1, "button should read Saved");
        assert.ok(await app.frame.locator("button", { hasText: /Back/ }).count(), "still in the editor");
        assert.equal(String((await stored(app, "Saver")).checkout?.loosePaid), "42");
      }));

      test("Tickets Available field is gone; Checkout boxes are present", () => withApp(T, [char({ name: "Tix", playerName: "Tia" })], {}, async (app) => {
        await openCharacter(app, "Tia");
        const t = await text(app.frame);
        assert.doesNotMatch(t, /Tickets Available/);
        for (const box of ["Membership", "Spend Crowns for SP", "Waiver"]) assert.match(t, new RegExp(box));
      }));
    });

    // ---------------- SP math ----------------
    describe("skill points", () => {
      test("unspent SP = starting + earned - skill costs", () => withApp(T, [
        char({ name: "Math", playerName: "Max", earnedSP: 100, purchasedSkills: [skill("track", 3)] }),
      ], {}, async (app) => {
        await openCharacter(app, "Max");
        assert.equal(await unspent(app), 150 - 9);
      }));

      test("stacked discount: Track (Nomad and Ranger) costs 1 SP", () => withApp(T, [
        char({ name: "Stack", playerName: "Sid", classId: "ranger", background: "Nomad", purchasedSkills: [skill("bg_nomad_ranger_track", 4)] }),
      ], {}, async (app) => {
        await openCharacter(app, "Sid");
        assert.equal(await unspent(app), 150 - 4);
      }));

      test("Iron Body can be bought up to 4 times", () => withApp(T, [
        char({ name: "Monk Iron", playerName: "Ira", classId: "monk", purchasedSkills: [skill("monk_iron_body", 3)] }),
      ], {}, async (app) => {
        await openCharacter(app, "Ira");
        const row = app.frame.locator('xpath=//*[normalize-space(text())="Iron Body"]/ancestor::div[.//button][1]').first();
        const plus = row.locator("button", { hasText: "+" });
        assert.ok(await plus.isEnabled(), "4th purchase allowed");
        await plus.click(); await pause(app.frame);
        assert.ok(!(await plus.isEnabled()), "no 5th purchase");
      }));

      test("Monk: old Energy tiers move to 18/18 and old-only skills stay for owners", () => withApp(T, [
        char({ name: "Old Monk", playerName: "Olga", classId: "monk", earnedSP: 150, purchasedSkills: [skill("monk_energy_1", 16), skill("monk_energy_2", 16), skill("monk_energy_3", 4), skill("monk_parry"), skill("monk_focus_1")] }),
        char({ name: "New Monk", playerName: "Nico", classId: "monk", earnedSP: 150 }),
      ], {}, async (app) => {
        await openCharacter(app, "Olga");
        assert.equal(await unspent(app), 200 - (18 + 36 + 4 + 20));
        let t = await text(app.frame);
        assert.match(t, /Parry/); assert.match(t, /High Block/);
        await back(app); await openCharacter(app, "Nico");
        t = await text(app.frame);
        assert.doesNotMatch(t, /Parry|Riposte|Focus \+4/); assert.match(t, /High Block/); assert.match(t, /Energy \(1–18\)/);
      }));

      test("Scholars' base common Knowledges move to the Background tab at 2 SP; rare and species stay", () => withApp(T, [
        char({ name: "Scholarly", playerName: "Sky", classId: "mage", background: "Scholar", earnedSP: 100,
          purchasedSkills: [skill("knowledge_area", 5, "Magic"), skill("knowledge_area", 2, "Planes"), skill("knowledge_area", 5, "Essence"), skill("knowledge_area", 1, "Barrowman"), skill("knowledge_area_rare", 3, "Acheron")] }),
        char({ name: "Already Right", playerName: "Ace", classId: "champion", background: "Scholar",
          purchasedSkills: [skill("bg_scholar_knowledge_discount", 5, "Warfare"), skill("knowledge_area_rare", 5, "Acheron")] }),
      ], {}, async (app) => {
        await openCharacter(app, "Sky");
        assert.equal(await unspent(app), 150 - (7 * 2 + 5 * 3 + 1 * 3 + 3 * 3), "Magic+Planes at 2 SP, Essence/Barrowman/Acheron at 3");
        const sk = (await stored(app, "Scholarly")).purchasedSkills.filter((p) => p.skillId !== "rw_common_free").map((p) => `${p.skillId}:${p.label}:${p.timesPurchased}`).sort();
        if (T.name === "hub") assert.deepEqual(sk, ["bg_scholar_knowledge_discount:Magic:5", "bg_scholar_knowledge_discount:Planes:2", "knowledge_area:Barrowman:1", "knowledge_area:Essence:5", "knowledge_area_rare:Acheron:3"], "saved to Base44");
        await back(app); await openCharacter(app, "Ace");
        assert.equal(await unspent(app), 150 - (10 + 15), "already-correct Scholar unchanged");
      }));

      test("Scholar Knowledge: six areas max, Rank 5 each, common and species areas only", () => withApp(T, [
        char({ name: "Six Areas", playerName: "Sal", classId: "mage", background: "Scholar", earnedSP: 200,
          purchasedSkills: ["Astronomy", "Cycle", "History", "Magic", "Nature", "Planes"].map((a, k) => skill("bg_scholar_knowledge_discount", k === 0 ? 5 : 1, a)) }),
      ], {}, async (app) => {
        await openCharacter(app, "Sal"); await tab(app, "Background");
        const before = await unspent(app);
        const add = app.frame.locator("button", { hasText: /Knowledge \(Area\) \(Scholar or Warlock\)/ }).filter({ hasText: "+" }).last();
        assert.ok(await add.isDisabled(), "no seventh area");
        const rowOf = (lbl) => app.frame.locator('select:has(option:text("— Choose a common knowledge —"))').filter({ has: app.frame.locator(`option[value="${lbl}"]:checked`) });
        const astro = app.frame.locator("select").filter({ hasText: "— Choose a common knowledge —" }).first();
        const opts = await astro.locator("option").allTextContents();
        for (const o of ["Planar Cartography", "Warfare", "High Elf", "Barrows"]) assert.ok(opts.some((x) => x.startsWith(o)), o);
        for (const o of ["Essence", "Titans", "Acheron", "Abyss", "Old Gods"]) assert.ok(!opts.some((x) => x.startsWith(o)), "rare " + o);
        assert.ok(opts.includes("Cycle (already favored)"), "other chosen areas are disabled");
        await astro.locator("xpath=ancestor::div[.//button][1]").locator("button", { hasText: "+" }).first().click(); await pause(app.frame);
        assert.equal(await unspent(app), before, "Astronomy already at Rank 5");
      }));

      test("custom common Knowledge (Other) works on Everyman and Scholar Background", () => withApp(T, [
        char({ name: "Myranda", playerName: "Myra", classId: "mage", background: "Scholar", earnedSP: 100,
          purchasedSkills: [skill("knowledge_area", 2, "Frogs"), skill("bg_scholar_knowledge_discount", 1, "")] }),
      ], {}, async (app) => {
        await openCharacter(app, "Myra");
        assert.equal(await unspent(app), 150 - (6 + 2));
        await tab(app, "Everyman Skills");
        const frogs = app.frame.locator('input[placeholder^="Custom common knowledge"]');
        assert.equal(await frogs.first().inputValue(), "Frogs", "existing custom label shown as Other");
        await tab(app, "Background");
        const sel = app.frame.locator("select").filter({ hasText: "— Choose a common knowledge —" }).first();
        await sel.selectOption("__other"); await pause(app.frame);
        await app.frame.locator('input[placeholder^="Custom common knowledge"]').first().fill("Toads"); await pause(app.frame, 200);
        await save(app);
        const sk = (await stored(app, "Myranda")).purchasedSkills.filter((p) => p.skillId !== "rw_common_free").map((p) => `${p.skillId}:${p.label}`).sort();
        assert.deepEqual(sk, ["bg_scholar_knowledge_discount:Toads", "knowledge_area:Frogs"]);
      }));

      test("Loremaster Ancient Lore: 3 favored Knowledges at Rank 5, 6 at Rank 10, never the Scholar's", () => withApp(T, [
        char({ name: "Lore Five", playerName: "Lou", classId: "mage", background: "Scholar", earnedSP: 200, favorLog: [favor(1, 20)],
          purchasedSkills: [skill("attunement", 1, "Loremaster"), skill("bg_scholar_knowledge_discount", 2, "Magic"), skill("lore_know", 3, "History")] }),
        char({ name: "Lore Ten", playerName: "Lia", classId: "warlock", earnedSP: 200, favorLog: [favor(1, 45)], purchasedSkills: [skill("attunement", 1, "Loremaster")] }),
        char({ name: "Lore Two", playerName: "Leo", classId: "mage", earnedSP: 200, favorLog: [favor(1, 5)], purchasedSkills: [skill("attunement", 1, "Loremaster")] }),
      ], {}, async (app) => {
        await openCharacter(app, "Lou");
        assert.equal(await unspent(app), 250 - (10 + 4 + 6), "Scholar Magic 2x2, Loremaster History 3x2");
        await tab(app, "Attunement");
        assert.match(await text(app.frame), /Ancient Lore - Favored Knowledges \(1\/3\)/);
        const sel = app.frame.locator("select").filter({ hasText: "— Choose a common knowledge —" }).first();
        assert.ok((await sel.locator("option").allTextContents()).includes("Magic (already favored)"), "Scholar's Magic cannot be Lore-favored");
        await back(app); await openCharacter(app, "Lia"); await tab(app, "Attunement");
        assert.match(await text(app.frame), /Ancient Lore - Favored Knowledges \(0\/6\)/);
        assert.match(await text(app.frame), /Loremaster Favored and Warlock/);
        await back(app); await openCharacter(app, "Leo"); await tab(app, "Attunement");
        assert.doesNotMatch(await text(app.frame), /Ancient Lore - Favored/);
      }));

      test("Goblins pay double for Read and Write; Ogres pay +1 for Read and Write and Knowledge; free skills stay free", () => withApp(T, [
        char({ name: "Gob", playerName: "Gabe", species: "Goblin", earnedSP: 100,
          purchasedSkills: [skill("read_and_write", 1, "Elvish"), skill("knowledge_area", 2, "Nature"), skill("sp_know_goblin_free")] }),
        char({ name: "Ogg", playerName: "Ozzy", species: "Ogre", earnedSP: 100,
          purchasedSkills: [skill("read_and_write", 1, "Dwarven"), skill("knowledge_area", 2, "Warfare"), skill("sp_know_ogre_free"), skill("sp_know_ogre", 1)] }),
        char({ name: "Hum", playerName: "Hal", species: "Human", earnedSP: 100,
          purchasedSkills: [skill("read_and_write", 1, "Elvish"), skill("knowledge_area", 2, "Nature")] }),
      ], {}, async (app) => {
        await openCharacter(app, "Gabe");
        assert.equal(await unspent(app), 150 - (6 + 6), "Read and Write 3x2, Knowledge normal");
        await back(app); await openCharacter(app, "Ozzy");
        assert.equal(await unspent(app), 150 - (4 + 8 + 0 + 4), "+1 on Read and Write and each Knowledge rank; free Knowledge stays 0");
        await back(app); await openCharacter(app, "Hal");
        assert.equal(await unspent(app), 150 - (3 + 6));
        for (const who of ["Gabe", "Ozzy"]) {
          await back(app); await openCharacter(app, who); await tab(app, "Everyman Skills");
          assert.match(await text(app.frame), /Read and Write \(Common\) — Free\s*0 SP/, who + " keeps free Read and Write (Common)");
        }
      }));

      test("Graystalkers Rank 3 discount lowers the chosen skill", () => withApp(T, [
        char({ name: "Gray", playerName: "Gil", classId: "rogue", attChoices: { graystalkers: { discount: "Chemistry" } }, favorLog: [favor(1, 20)],
          purchasedSkills: [skill("attunement", 1, "Graystalkers"), skill("chemistry", 4), skill("chemistry_5")] }),
      ], {}, async (app) => {
        await openCharacter(app, "Gil");
        assert.equal(await unspent(app), 150 - (10 + 12 + 6));
      }));
    });

    // ---------------- Prerequisites ----------------
    describe("prerequisites", () => {
      const row = (app, name) => app.frame.locator(`xpath=//span[normalize-space(text())="${name}"]/ancestor::div[.//button][1]`).first();
      test("a skill can't be bought until its prerequisite is owned, and a needed prerequisite can't be removed", () => withApp(T, [
        char({ name: "Focuser", playerName: "Fay", classId: "warrior", earnedSP: 100 }),
      ], {}, async (app) => {
        await openCharacter(app, "Fay"); await tab(app, "Warrior Skills");
        assert.ok(await row(app, "Focus +2").locator("button", { hasText: "+" }).isDisabled(), "Focus +2 blocked");
        assert.match(await row(app, "Focus +2").innerText(), /Req: Focus \+1 \(missing\)/);
        await row(app, "Focus +1").locator("button", { hasText: "+" }).click(); await pause(app.frame);
        await row(app, "Focus +2").locator("button", { hasText: "+" }).click(); await pause(app.frame);
        assert.equal(await unspent(app), 150 - 30);
        const minus = row(app, "Focus +1").locator("button", { hasText: "−" });
        assert.ok(await minus.isDisabled(), "Focus +1 needed by Focus +2");
        assert.match(await row(app, "Focus +1").innerText(), /Needed by Focus \+2/);
      }));

      test("Spell Pool 4 alone: missing Spell Pools 1-3 are added when SP allows, otherwise a note is added", () => withApp(T, [
        char({ name: "Rich Mage", playerName: "Rita", classId: "mage", earnedSP: 100, purchasedSkills: [skill("mage_pool_4")] }),
        char({ name: "Poor Mage", playerName: "Pete", classId: "mage", earnedSP: 0, startingSP: 20, purchasedSkills: [skill("mage_pool_4")] }),
      ], {}, async (app) => {
        await openCharacter(app, "Rita");
        assert.equal(await unspent(app), 150 - (0 + 5 + 10 + 15), "pools 1-3 bought");
        await back(app);
        const style = (await app.frame.locator("button").filter({ hasText: "Pete" }).first().getAttribute("style")) || "";
        assert.match(style, /red|#ef4444|rgb\(239, 68, 68\)/i, "exception note gives the red outline");
        await openCharacter(app, "Pete");
        assert.equal(await unspent(app), 20 - 15, "build left unchanged");
        const boxes = await app.frame.evaluate(() => [...document.querySelectorAll("textarea")].map((t) => t.value).join("\n"));
        assert.match(boxes, /Prerequisite exception: missing prerequisites would cost 10 more SP/);
        assert.match(boxes, /Spell Pool 4 requires Spell Pool 3/);
        if (T.name === "hub") assert.match((await stored(app, "Poor Mage")).notes, /Spell Pool 4 requires Spell Pool 3/);
      }));

      test("Read and Write (Common) is free for everyone except Orcs and Half-Trolls; Rank 5 crafting needs Ranks 1-4", () => withApp(T, [
        char({ name: "Smith", playerName: "Sol", species: "Human", earnedSP: 100, purchasedSkills: [skill("smithing", 2), skill("smithing_5")] }),
        char({ name: "Grok", playerName: "Gus", species: "Orc", earnedSP: 100 }),
      ], {}, async (app) => {
        await openCharacter(app, "Sol");
        assert.equal(await unspent(app), 150 - (4 * 4 + 8), "Smithing filled to 4 ranks; Read and Write free");
        await tab(app, "Everyman Skills");
        assert.match(await text(app.frame), /Read and Write \(Common\) — Free/);
        await back(app); await openCharacter(app, "Gus"); await tab(app, "Everyman Skills");
        assert.doesNotMatch(await text(app.frame), /Read and Write \(Common\) — Free/);
      }));
    });

    // ---------------- Class / profession skill lists ----------------
    describe("skill lists", () => {
      const listFor = async (app, who, label) => { await openCharacter(app, who); await tab(app, label); return text(app.frame); };
      test("Rogue: Exhausting Attack and Sap at 4 SP", () => withApp(T, [char({ playerName: "Rae", classId: "rogue" })], {}, async (app) => {
        const t = await listFor(app, "Rae", "Rogue Skills");
        assert.match(t, /Exhausting Attack/); assert.doesNotMatch(t, /Crippling Attack/);
        assert.match(t, /Sap\s*4 SP/);
      }));
      test("Paladin: Strength of Conviction 3 SP and Chain Spell", () => withApp(T, [char({ playerName: "Pal", classId: "paladin" })], {}, async (app) => {
        const t = await listFor(app, "Pal", "Paladin Skills");
        assert.match(t, /Strength of Conviction\s*3 SP/); assert.match(t, /Chain Spell \(1–2\)/);
      }));
      test("Caller: Mana past 100 capped at 120", () => withApp(T, [char({ playerName: "Cal", classId: "caller" })], {}, async (app) => {
        const t = await listFor(app, "Cal", "Caller Skills");
        assert.match(t, /Mana \(101–120\)/);
      }));
      test("Everyman has Major Harvesting and no attunement dropdown", () => withApp(T, [char({ playerName: "Eve" })], {}, async (app) => {
        const t = await listFor(app, "Eve", "Everyman Skills");
        assert.match(t, /Major/);
        assert.equal(await app.frame.locator('select:has(option:text("— Select attunement —"))').count(), 0);
      }));
      test("Professions tab shows count; Background tab has no professions", () => withApp(T, [char({ playerName: "Pro", background: "Nomad" })], {}, async (app) => {
        await openCharacter(app, "Pro");
        assert.match(await text(app.frame), /Professions \(0\/3\)/);
        await tab(app, "Background");
        assert.doesNotMatch(await text(app.frame), /Officer Rank/);
      }));
    });

    // ---------------- Attunements ----------------
    describe("attunements", () => {
      test("dropdown lists all 40 attunements plus Other", () => withApp(T, [char({ playerName: "Ada", purchasedSkills: [skill("attunement", 1, "")] })], {}, async (app) => {
        await openCharacter(app, "Ada"); await tab(app, "Attunement");
        const opts = await app.frame.locator('select:has(option:text("— Select attunement —"))').first().locator("option").allTextContents();
        assert.equal(opts.length, 1 + 40 + 1, opts.join(","));
        for (const n of ["Iron Stars", "Preserver of the Spirit", "Graystalkers", "Gunmage (101st MC(A))", "Other"]) assert.ok(opts.includes(n), n);
        assert.ok(!opts.includes("Psionics"));
      }));

      test("Gunmage: rank-unlocked purchases count against SP, 10 free Joules, dailies print one circle per purchase", () => withApp(T, [
        char({ name: "Spellshot", playerName: "Gus", classId: "gunslinger", species: "Human", earnedSP: 100, favorLog: [favor(1, 20)], purchasedSkills: [skill("attunement", 1, "101st MC(A)")] }),
      ], {}, async (app) => {
        await openCharacter(app, "Gus"); await tab(app, "Attunement");
        let t = await text(app.frame);
        assert.match(t, /Gunmage \(101st MC\(A\)\)/); assert.match(t, /Rank 5 · Journeyman · Favor 20/);
        assert.match(t, /Joules: 10 \(10 free \+ 0 bought\)/);
        assert.doesNotMatch(t, /Gunmage requires/);
        const before = await unspent(app);
        const row = (name) => app.frame.locator("div.flex.items-center.gap-2.px-3.py-2").filter({ hasText: name }).first();
        const plus = (name) => row(name).locator("button", { hasText: "+" });
        for (let k = 0; k < 4; k++) { await plus("Gunmage Joules (11–50)").click(); await pause(app.frame, 60); }
        await plus("Gunmage Accuracy +1").click(); await pause(app.frame);
        await plus("Gunmage Accuracy +2").click(); await pause(app.frame);
        await plus("Gunmage Conservation").click(); await pause(app.frame, 60);
        await plus("Gunmage Conservation").click(); await pause(app.frame);
        assert.equal(await unspent(app), before - (4 * 0.5 + 20 + 20 + 2 * 2));
        assert.match(await text(app.frame), /Joules: 14 \(10 free \+ 4 bought\)/);
        // Rank 5 unlocks Joules 51-75 only after 11-50 is full; Accuracy +3 needs Rank 6; Truesight Rank 10.
        assert.equal(await plus("Gunmage Accuracy +3").isDisabled(), true);
        assert.equal(await plus("Gunmage Truesight").isDisabled(), true);
        assert.equal(await plus("Gunmage Joules (51–75)").isDisabled(), true);
        await save(app);
        const sheet = await printSheet(app);
        assert.match(sheet.text, /Joules: 14/);
        assert.match(sheet.text, /Rank 1 - Ballistic Magic; 10 Joules; Friendly Fire scroll/);
        assert.match(sheet.text, /Gunmage Accuracy \+2/);
        assert.equal(await circles(sheet, "Conservation"), 2);
      }));

      test("Gunmage: warning for non-Human or wrong class; locked at Rank 1", () => withApp(T, [
        char({ name: "Elfshot", playerName: "Elle", classId: "warrior", species: "Forest Elf", favorLog: [], purchasedSkills: [skill("attunement", 1, "Gunmage")] }),
      ], {}, async (app) => {
        await openCharacter(app, "Elle"); await tab(app, "Attunement");
        const t = await text(app.frame);
        assert.match(t, /Gunmage requires a Human Mage or Gunslinger/);
        assert.match(t, /Gunmage Purchases \(Rank 1\)/);
        const plus = app.frame.locator("div.flex.items-center.gap-2.px-3.py-2").filter({ hasText: "Gunmage Conservation" }).first().locator("button", { hasText: "+" });
        assert.equal(await plus.isDisabled(), true);
      }));

      test("old labels and nicknames map to the right attunement", () => withApp(T, [
        char({ playerName: "Ari", purchasedSkills: [skill("attunement", 1, "Argynt Stars"), skill("second_attunement", 1, "Corhite Adept (Player Version)")] }),
      ], {}, async (app) => {
        await openCharacter(app, "Ari"); await tab(app, "Attunement");
        const t = await text(app.frame);
        assert.match(t, /Iron Stars/); assert.match(t, /Corhite Adept/);
      }));

      test("rank comes from Favor (10 Favor = Rank 3) and higher ranks are greyed", () => withApp(T, [
        char({ playerName: "Ren", favorLog: [favor(1, 10)], purchasedSkills: [skill("attunement", 1, "Reaper")] }),
      ], {}, async (app) => {
        await openCharacter(app, "Ren"); await tab(app, "Attunement");
        assert.match(await text(app.frame), /Rank 3 · Novice · Favor 10/);
        const greyed = await app.frame.locator("div.opacity-40").count();
        assert.equal(greyed, 7 + 1, "ranks 4-10 plus Special greyed");
      }));

      test("rank choices save, and one-per-group picks hide used options", () => withApp(T, [
        char({ name: "Corhite", playerName: "Cory", favorLog: [favor(1, 45)], purchasedSkills: [skill("attunement", 1, "Corhite Adept")] }),
      ], {}, async (app) => {
        await openCharacter(app, "Cory"); await tab(app, "Attunement");
        const sel = app.frame.locator('select:has(option:text("— Choose —"))');
        await sel.nth(0).selectOption("Orange Healing"); await pause(app.frame);
        const second = await sel.nth(1).locator("option").allTextContents();
        assert.ok(!second.some((o) => o.startsWith("Orange Healing")), "already used");
        await save(app);
        assert.deepEqual((await stored(app, "Corhite")).attChoices, { "corhite adept": { spec1: "Orange Healing" } });
      }));

      test("Specials are free text, greyed below 75 Favor, and print", () => withApp(T, [
        char({ name: "Lacuna", playerName: "Lux", favorLog: [favor(1, 80)], purchasedSkills: [skill("attunement", 1, "Lacuna Society")] }),
      ], {}, async (app) => {
        await openCharacter(app, "Lux"); await tab(app, "Attunement");
        const box = app.frame.locator('textarea[placeholder^="Negotiated"]');
        assert.equal(await box.evaluate((el) => el.closest("div.flex.gap-3").className.includes("opacity-40")), false);
        await box.fill("The Unasked Question 1/event"); await pause(app.frame, 200); await save(app);
        const sheet = await printSheet(app);
        assert.match(sheet.text, /Special - The Unasked Question 1\/event/);
      }));

      test("Collectors companions: slots by rank and per-reset circles", () => withApp(T, [
        char({ name: "Menagerie", playerName: "Mel", favorLog: [favor(1, 25)], purchasedSkills: [skill("attunement", 1, "Collectors of Meliniter's Menagerie")],
          companions: [{ name: "Bramble", cat: "Cycle", abil: [{ a: "Wound Closure", l: 2 }, { a: "Purifying Aura", l: 1 }] }] }),
      ], {}, async (app) => {
        await openCharacter(app, "Mel"); await tab(app, "Attunement");
        assert.match(await text(app.frame), /3 companions, 2 abilities each/);
        const sheet = await printSheet(app);
        assert.match(sheet.text, /Companion 1: Bramble - Cycle - Wound Closure Level 2/);
        assert.equal(await circles(sheet, "Regeneration"), 2);
        assert.equal(await circles(sheet, "Resist Toxin"), 1);
      }));

      test("circle counts scale with rank and picks (Spellsingers Slinger)", () => withApp(T, [
        char({ name: "Singer", playerName: "Sia", favorLog: [favor(1, 50)], attChoices: { spellsingers: { paragon: "Slinger" } }, purchasedSkills: [skill("attunement", 1, "Spellsingers")] }),
      ], {}, async (app) => {
        await openCharacter(app, "Sia");
        const sheet = await printSheet(app);
        assert.equal(await circles(sheet, "Voice Magic Silence"), 3);
        assert.equal(await circles(sheet, "Planar Asylum"), 2);
        assert.equal(await circles(sheet, "Voice All Allies Heroism"), 2);
      }));

      test("Knights of Celiene adds Body; Ley Mage adds 25 Spell Pool", () => withApp(T, [
        char({ name: "Plain", playerName: "Pia", classId: "mage", purchasedSkills: [skill("mage_pool_1")] }),
        char({ name: "Knightly", playerName: "Kit", classId: "mage", favorLog: [favor(1, 15), favor(2, 40)], purchasedSkills: [skill("mage_pool_1"), skill("attunement", 1, "Knights of Celiene"), skill("second_attunement", 1, "Ley Mage")] }),
      ], {}, async (app) => {
        const read = async (who) => { await openCharacter(app, who, { edit: false }); const s = await printSheet(app); await s.page.close(); await back(app); return s.text; };
        const a = await read("Pia"), b = await read("Kit");
        const bp = (t) => Number((t.match(/Body Points:?\s*(\d+)/) || [])[1]);
        const pool = (t) => Number((t.match(/Pool: (\d+)/) || [])[1]);
        assert.equal(bp(b) - bp(a), 4, "Knights rank 4 = +4 Body");
        assert.equal(pool(b) - pool(a), 25, "Ley Mage rank 9 Pool Infusion");
      }));
    });

    // ---------------- Printed sheet ----------------
    describe("printed sheet", () => {
      test("layout: attunements side by side, narrow Checkout, no Tickets, resets never split", () => withApp(T, [
        char({ name: "Printer", playerName: "Pri", classId: "mage", favorLog: [favor(1, 20), favor(2, 20)], checkout: { membership: true },
          purchasedSkills: [skill("attunement", 1, "Reaper"), skill("second_attunement", 1, "Riverwalkers"), skill("mage_pool_1")] }),
      ], {}, async (app) => {
        await openCharacter(app, "Pri", { edit: false });
        const s = await printSheet(app);
        assert.match(s.text, /Printer/);
        assert.doesNotMatch(s.text, /Tickets Available/);
        assert.match(s.text, /Checkout/);
        const boxes = await s.page.evaluate(() => [...document.querySelectorAll("div")].filter((d) => d.style.flex === "0 0 2.75in").map((d) => Math.round(d.getBoundingClientRect().top)));
        assert.equal(boxes.length, 2); assert.equal(boxes[0], boxes[1], "attunement boxes on one row");
        assert.ok(s.html.includes("flex:0 0 1.75in"), "narrow Checkout");
        assert.equal((s.html.match(/break-inside:avoid;page-break-inside:avoid;/g) || []).length >= 2, true, "resets kept whole");
        assert.match(s.html, /display:inline-flex/, "trackers flow side by side");
      }));
    });

    // ---------------- Analytics ----------------
    describe("analytics", () => {
      test("Popular Powers by class shows % of characters and % of picks", () => withApp(T, [
        char({ playerName: "A1", classId: "mage", purchasedPowers: [{ slotIndex: 0, customName: "Spell Focus I" }, { slotIndex: 1, customName: "Mentor" }] }),
        char({ playerName: "A2", classId: "mage", purchasedPowers: [{ slotIndex: 0, customName: "Spell Focus I" }] }),
        char({ playerName: "A3", classId: "warrior", purchasedPowers: [{ slotIndex: 0, customName: "Mentor" }] }),
      ], {}, async (app) => {
        await app.frame.locator("button", { hasText: "Analytics" }).first().click(); await pause(app.frame, 300);
        const box = app.frame.locator("div.rounded-xl").filter({ hasText: "Popular Powers" }).last();
        await box.locator("button", { hasText: "By Class" }).click(); await pause(app.frame);
        await box.locator("select").selectOption({ label: "Mage (2)" }); await pause(app.frame);
        let t = await box.innerText();
        assert.match(t, /Spell Focus I[\s\S]*?100%[\s\S]*?2 of 2/);
        await box.locator("button", { hasText: "% of all power picks" }).click(); await pause(app.frame);
        t = await box.innerText();
        assert.match(t, /Spell Focus I[\s\S]*?67%[\s\S]*?2 of 3/);
      }));
    });
  });
}
