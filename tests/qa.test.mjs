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

      test("one-time fill: empty notes become 'Plot', existing notes are kept, and it never runs twice", () => withApp(T, [
        char({ name: "Blank", playerName: "Bea" }),
        char({ name: "Spaces", playerName: "Sol", notes: "   " }),
        char({ name: "Imported", playerName: "Ivo", notes: "IMPORT ERRORS / CHECK THESE: x" }),
        char({ name: "Handled", playerName: "Hal", plotNoteDone: true }),
      ], {}, async (app) => {
        await pause(app.frame, 400);
        assert.equal((await stored(app, "Blank")).notes, "Plot");
        assert.equal((await stored(app, "Spaces")).notes, "Plot");
        assert.equal((await stored(app, "Imported")).notes, "IMPORT ERRORS / CHECK THESE: x");
        assert.equal((await stored(app, "Handled")).notes || "", "", "already handled: left alone");
        const style = async (n) => (await app.frame.locator("button").filter({ hasText: n }).first().getAttribute("style")) || "";
        assert.match(await style("Bea"), /#3b82f6|rgb\(59, 130, 246\)/i, "now outlined blue");
      }));

      test("GM filters: 'Needs Attention' shows only red, 'Plot Notes' only blue", () => withApp(T, [
        char({ name: "Red One", playerName: "NfRed", notes: "Owes crowns" }),
        char({ name: "Blue One", playerName: "NfBlue", notes: "Plot: the duke" }),
        char({ name: "Clear One", playerName: "NfClear", notes: "", plotNoteDone: true }),
      ], {}, async (app) => {
        const names = async () => (await app.frame.locator("button").filter({ hasText: /Nf(Red|Blue|Clear)/ }).allInnerTexts()).join(" ");
        const red = app.frame.locator("button", { hasText: /^Needs Attention \(1\)$/ }), blue = app.frame.locator("button", { hasText: /^Plot Notes \(1\)$/ });
        assert.match(await names(), /NfRed[\s\S]*|NfBlue/); assert.match(await names(), /NfClear/);
        await red.click(); await pause(app.frame);
        let t = await names(); assert.match(t, /NfRed/); assert.doesNotMatch(t, /NfBlue|NfClear/);
        assert.equal(await red.getAttribute("aria-pressed"), "true");
        await blue.click(); await pause(app.frame);
        t = await names(); assert.match(t, /NfBlue/); assert.doesNotMatch(t, /NfRed|NfClear/);
        await blue.click(); await pause(app.frame);
        t = await names(); assert.match(t, /NfRed/); assert.match(t, /NfBlue/); assert.match(t, /NfClear/);
      }));

      test("notes starting with 'plot' get a blue outline instead of red", () => withApp(T, [
        char({ name: "Plot A", playerName: "Paula", notes: "Plot: the duke owes her a favor" }),
        char({ name: "Plot B", playerName: "Quinn", notes: "  PLOT hook for next event" }),
        char({ name: "Not Plot", playerName: "Rita", notes: "Plotting a heist — check crowns" }),
        char({ name: "Later Plot", playerName: "Sam", notes: "Owes crowns. Plot later." }),
      ], {}, async (app) => {
        const style = async (n) => (await app.frame.locator("button").filter({ hasText: n }).first().getAttribute("style")) || "";
        const blue = /#3b82f6|rgb\(59, 130, 246\)/i, red = /#ef4444|rgb\(239, 68, 68\)/i;
        for (const n of ["Paula", "Quinn"]) { assert.match(await style(n), blue); assert.doesNotMatch(await style(n), red); }
        for (const n of ["Rita", "Sam"]) { assert.match(await style(n), red); assert.doesNotMatch(await style(n), blue); }
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

    // ---------------- Zealous Dedication ----------------
    // Heroic power. Prerequisite: a single attunement with 100+ Favor. Doubles
    // every per-day circle and per-event use from that attunement, raises its
    // pools (spell, healing, elemental, natural armor, Joules) by 50% rounded
    // down to 5s, and leaves Ley Mage ley points and Max Body alone. Taking it
    // locks out a Second Attunement.
    describe("zealous dedication", () => {
      const ZD = [{ slotIndex: 4, customName: "Zealous Dedication" }];
      const hero = (over = {}) => char({ earnedSP: 400, favorLog: [favor(1, 100)], ...over });
      const read = async (app, who) => { await openCharacter(app, who, { edit: false }); const s = await printSheet(app); await back(app); return s; };

      test("doubles attunement circles and per-event uses; pools +50% rounded down to 5s", () => withApp(T, [
        hero({ playerName: "ZdOn", purchasedPowers: ZD, purchasedSkills: [skill("attunement", 1, "Verdant Protectors")] }),
        hero({ playerName: "ZdOff", purchasedSkills: [skill("attunement", 1, "Verdant Protectors")] }),
        hero({ playerName: "ZdLamp", purchasedPowers: ZD, purchasedSkills: [skill("attunement", 1, "Lamplight Inquest")] }),
      ], {}, async (app) => {
        const off = await read(app, "ZdOff");
        assert.equal(await circles(off, "Voice of the Wild"), 4);
        assert.match(off.text, /Nature's Fury: 100 points/);
        assert.doesNotMatch(off.text, /Zealous Dedication: per-day/);
        const on = await read(app, "ZdOn");
        assert.equal(await circles(on, "Voice of the Wild"), 8, "4 → 8");
        assert.equal(await circles(on, "Shape of the Wild"), 4, "2 → 4");
        assert.equal(await circles(on, "Greater Shape of the Wild"), 2, "1 → 2");
        assert.match(on.text, /Nature's Fury: 150 points/);
        assert.match(on.text, /Zealous Dedication: per-day and per-event uses doubled/);
        const lamp = await read(app, "ZdLamp");
        assert.match(lamp.text, /Walk the Scene 2\/event/);
        assert.match(lamp.text, /The Accusation 2\/event/);
        assert.equal(await circles(lamp, "Count the Shadows"), 6, "3 → 6");
      }));

      test("natural armor and Ley Mage spell pool get +50%; ley points and Max Body do not", () => withApp(T, [
        hero({ playerName: "ZdAsc", purchasedPowers: ZD, purchasedSkills: [skill("attunement", 1, "Path of the Ascetic")] }),
        hero({ playerName: "ZdKnight", purchasedPowers: ZD, purchasedSkills: [skill("attunement", 1, "Knights of Celiene")] }),
        hero({ playerName: "ZdKnight0", purchasedSkills: [skill("attunement", 1, "Knights of Celiene")] }),
        hero({ playerName: "ZdLey", classId: "mage", purchasedPowers: ZD, purchasedSkills: [skill("mage_pool_1"), skill("attunement", 1, "Ley Mage")] }),
        hero({ playerName: "ZdLey0", classId: "mage", purchasedSkills: [skill("mage_pool_1"), skill("attunement", 1, "Ley Mage")] }),
      ], {}, async (app) => {
        assert.match((await read(app, "ZdAsc")).text, /Spirit Made Steel Natural Armor: 65 points/, "45 × 1.5 = 67.5 → 65");
        const bp = (t) => Number((t.match(/Body Points:?\s*(\d+)/) || [])[1]);
        assert.equal(bp((await read(app, "ZdKnight")).text), bp((await read(app, "ZdKnight0")).text), "Max Body unchanged");
        const pool = (t) => Number((t.match(/Pool: (\d+)/) || [])[1]);
        assert.equal(pool((await read(app, "ZdLey")).text) - pool((await read(app, "ZdLey0")).text), 10, "Pool Infusion 25 → 35");
      }));

      test("Gunmage: Joules +50% and dailies doubled", () => withApp(T, [
        hero({ playerName: "ZdGun", classId: "gunslinger", purchasedPowers: ZD, purchasedSkills: [skill("attunement", 1, "Gunmage"), skill("gm_joules_1", 4), skill("gm_conservation", 2)] }),
      ], {}, async (app) => {
        await openCharacter(app, "ZdGun"); await tab(app, "Attunement");
        assert.match(await text(app.frame), /Joules: 27 \(10 free \+ 8 bought, \+50% Zealous Dedication\)/);
        await back(app);
        const s = await read(app, "ZdGun");
        assert.match(s.text, /Joules: 27/);
        assert.equal(await circles(s, "Conservation"), 4);
      }));

      test("power needs a single attunement with 100+ Favor", () => withApp(T, [
        hero({ playerName: "ZdOk", purchasedSkills: [skill("attunement", 1, "Reaper")] }),
        hero({ playerName: "ZdLow", favorLog: [favor(1, 99)], purchasedSkills: [skill("attunement", 1, "Reaper")] }),
        hero({ playerName: "ZdTwo", favorLog: [favor(1, 100), favor(2, 5)], purchasedSkills: [skill("attunement", 1, "Reaper"), skill("second_attunement", 1, "Shaman")] }),
        hero({ playerName: "ZdNone", purchasedSkills: [] }),
      ], {}, async (app) => {
        const eligible = async (who) => {
          await openCharacter(app, who);
          const box = app.frame.locator('input[placeholder="Search powers..."]').last();
          await box.click(); await box.fill("Zealous"); await pause(app.frame);
          const t = await app.frame.locator("div.absolute.z-50").last().innerText();
          await box.fill(""); await app.frame.locator("body").click({ position: { x: 5, y: 5 } }); await pause(app.frame); await back(app);
          return /Available[\s\S]*Zealous Dedication/i.test(t) && !/Not eligible[\s\S]*Zealous Dedication/i.test(t);
        };
        assert.equal(await eligible("ZdOk"), true, "single attunement, 100 Favor");
        assert.equal(await eligible("ZdLow"), false, "99 Favor");
        assert.equal(await eligible("ZdTwo"), false, "two attunements");
        assert.equal(await eligible("ZdNone"), false, "no attunement");
      }));

      test("taking it locks out a Second Attunement", () => withApp(T, [
        hero({ playerName: "ZdLock", purchasedPowers: ZD, purchasedSkills: [skill("attunement", 1, "Reaper")] }),
        hero({ playerName: "ZdFree", purchasedSkills: [skill("attunement", 1, "Reaper")] }),
      ], {}, async (app) => {
        const btn = () => app.frame.locator("button").filter({ hasText: /Second Attunement/ }).last();
        await openCharacter(app, "ZdLock"); await tab(app, "Attunement");
        assert.equal(await btn().isDisabled(), true);
        assert.match((await btn().getAttribute("title")) || "", /Cannot have Zealous Dedication/);
        await back(app);
        await openCharacter(app, "ZdFree"); await tab(app, "Attunement");
        assert.equal(await btn().isDisabled(), false);
      }));
    });

    // ---------------- 2026 import fixes (Base44 copy only) ----------------
    if (T.name === "hub") describe("2026 import fixes", () => {
      const imp = (lines) => ["Imported from workbook tab: \"x\".", "IMPORT ERRORS / CHECK THESE:", ...lines].join("\n");
      const runFix = async (app) => {
        await app.frame.locator("button", { hasText: "Fix 2026 import" }).click(); await pause(app.frame);
        await app.frame.locator("button", { hasText: "Back up and fix" }).click();
        await app.frame.waitForFunction(() => /Backed up \d+ characters|Stopped:/.test(document.body.innerText), null, { timeout: 120000 });
        return text(app.frame);
      };
      test("backs up first, applies the plan, skips GM-edited fields, cleans notes", async () => {
        const a = char({ id: "fx-a", name: "Brim", playerName: "FxA", classId: "monk", species: "Barrowman", notes: imp(["- Skills not found in the app catalog - enter manually (name x times, sheet SP): Bracing Block x1 (2 SP)"]) });
        const b = char({ id: "fx-b", name: "Gruk", playerName: "FxB", classId: "warrior", species: "Ogre", purchasedSkills: [skill("war_parry")], purchasedPowers: [{ slotIndex: 0, customName: "Overwhelming Power!" }],
          notes: imp(["- Powers not found in the app power list (kept as typed): Overwhelming Power!", "- Skills not found in the app catalog - enter manually (name x times, sheet SP): Mystery Thing x1 (3 SP)"]) + "\nGM: owes a favor" });
        const c = char({ id: "fx-c", name: "Edited", playerName: "FxC", classId: "monk", purchasedSkills: [skill("monk_bracing")], notes: imp(["- Skills not found in the app catalog - enter manually (name x times, sheet SP): Bracing Block x1 (2 SP)"]) });
        const d = char({ id: "fx-d", name: "Done", playerName: "FxD", notes: "Plot: already handled" });
        const seed = [a, b, { ...c, purchasedSkills: [] }, d].map((x) => ({ id: x.id, name: x.name, species: x.species, background: x.background, favorLog: [],
          skills: Object.fromEntries((x.purchasedSkills || []).map((s) => [s.skillId, s.timesPurchased])) }));
        const plan = [
          { id: "fx-a", ops: [["species", "Barrows"], ["add", "monk_bracing", 1]], keep: [] },
          { id: "fx-b", ops: [["power", "Overwhelming Power!", null]], keep: ["Skill from sheet not entered: Mystery Thing x1 (3 SP) - no matching app skill"] },
          { id: "fx-c", ops: [["add", "monk_bracing", 1]], keep: [] },
          { id: "fx-d", ops: [["add", "monk_bracing", 1]], keep: [] },
        ];
        await withApp(T, [a, b, c, d], { fixPlan: { plan, seed } }, async (app) => {
          const t = await runFix(app);
          assert.match(t, /Backed up 4 characters/);
          const calls = await app.page.evaluate(() => window.__calls);
          const bi = calls.indexOf("gmBackup");
          assert.ok(bi >= 0 && calls.lastIndexOf("gmSave:Brim") > bi && calls.indexOf("gmFixPlan") > bi, "backup before the fixes are saved");
          const sa = await stored(app, "Brim"), sb = await stored(app, "Gruk"), sc = await stored(app, "Edited"), sd = await stored(app, "Done");
          assert.equal(sa.species, "Barrows"); assert.equal(sa.purchasedSkills.filter((s) => s.skillId === "monk_bracing").length, 1);
          assert.equal(sa.notes, "", "all import lines resolved");
          assert.equal(sb.purchasedPowers[0].customName, "Overwhelming Power");
          assert.match(sb.notes, /GM: owes a favor/); assert.match(sb.notes, /CHECK THESE[\s\S]*Mystery Thing/); assert.doesNotMatch(sb.notes, /Imported from workbook/);
          assert.equal(sc.purchasedSkills.find((s) => s.skillId === "monk_bracing").timesPurchased, 1, "GM already added it: not doubled");
          assert.equal(sd.purchasedSkills.some((s) => s.skillId === "monk_bracing"), false, "no import notes: untouched");
        });
      });

      test("if the Base44 backup fails, nothing changes until the GM continues with the downloaded file", async () => {
        const a = char({ id: "fb-a", name: "Brim", playerName: "FbA", classId: "monk", species: "Barrowman", notes: imp(["- Skills not found in the app catalog - enter manually (name x times, sheet SP): Bracing Block x1 (2 SP)"]) });
        const fixPlan = { plan: [{ id: "fb-a", ops: [["species", "Barrows"], ["add", "monk_bracing", 1]], keep: [] }],
          seed: [{ id: "fb-a", name: "Brim", species: "Barrowman", background: "", favorLog: [], skills: {} }] };
        await withApp(T, [a], { fixPlan, fixBackupFails: true }, async (app) => {
          const dl = app.page.waitForEvent("download");
          await app.frame.locator("button", { hasText: "Fix 2026 import" }).click(); await pause(app.frame);
          await app.frame.locator("button", { hasText: "Back up and fix" }).click();
          assert.match((await dl).suggestedFilename(), /^tfe-characters-backup-\d{4}-\d\d-\d\d\.json$/);
          await app.frame.waitForFunction(() => /Base44 backup failed/.test(document.body.innerText));
          assert.match(await text(app.frame), /entity not found/);
          assert.equal((await stored(app, "Brim")).species, "Barrowman", "nothing changed yet");
          await app.frame.locator("button", { hasText: "Fix using the downloaded backup" }).click();
          await app.frame.waitForFunction(() => /Backed up \d+ characters/.test(document.body.innerText));
          assert.match(await text(app.frame), /downloaded file only/);
          assert.equal((await stored(app, "Brim")).species, "Barrows");
        });
      });

      test("full 2026 roster: every character's import block is processed without errors", async () => {
        const fs = await import("node:fs");
        const dir = new URL("../../the-fallen-empires-hub/base44/functions/", import.meta.url);
        const roster = JSON.parse(fs.readFileSync(new URL("seedCharacters/characters.json", dir)));
        const fixPlan = { plan: JSON.parse(fs.readFileSync(new URL("rosterFixes/plan.json", dir))), seed: JSON.parse(fs.readFileSync(new URL("rosterFixes/seed.json", dir))) };
        await withApp(T, roster, { fixPlan }, async (app) => {
          const t = await runFix(app);
          assert.match(t, new RegExp(`Backed up ${roster.length} characters`));
          const rows = await app.page.evaluate(() => window.__store.rows);
          assert.equal(rows.filter((r) => /Imported from workbook tab|IMPORT ERRORS/.test(r.notes)).length, 0, "no import blocks left");
          const clean = rows.filter((r) => !r.notes.trim()).length;
          assert.ok(clean >= 95, `clean characters: ${clean}`);
        });
      });
    });

    // ---------------- Pricing: entitled variants and 2026 pricing fixes ----------------
    describe("pricing", () => {
      if (T.name === "hub") test("purchases move to the background/species variant the character is entitled to", () => withApp(T, [
        char({ name: "Sch", playerName: "PrSch", classId: "mage", background: "Scholar", purchasedSkills: [skill("read_and_write", 1, "Common"), skill("mage_pool_1")] }),
        char({ name: "Sol", playerName: "PrSol", classId: "paladin", background: "Soldier", purchasedSkills: [skill("pal_weap_ward")] }),
        char({ name: "Hea", playerName: "PrHea", classId: "warrior", background: "Healer", purchasedSkills: [skill("first_aid"), skill("diagnose")] }),
        char({ name: "Hum", playerName: "PrHum", species: "Human", purchasedSkills: [skill("sp_know_human", 2)] }),
      ], {}, async (app) => {
        await pause(app.frame, 400);
        const ids = async (n) => (await stored(app, n)).purchasedSkills.map((p) => `${p.skillId}:${p.timesPurchased}`).sort().join(",");
        assert.match(await ids("Sch"), /bg_scholar_read_write:1/); assert.doesNotMatch(await ids("Sch"), /(^|,)read_and_write:/);
        assert.match(await ids("Sol"), /bg_soldier_weapon_ward:1/); assert.doesNotMatch(await ids("Sol"), /pal_weap_ward/);
        assert.match(await ids("Hea"), /bg_healer_first_aid:1/); assert.match(await ids("Hea"), /bg_healer_diagnose:1/);
        assert.match(await ids("Hum"), /sp_know_human_free:1/); assert.match(await ids("Hum"), /sp_know_human:1/);
      }));

      test("species uses: 1 free at 1st level and one more at 10/20/30/40; extra uses cost the listed SP", () => withApp(T, [
        char({ name: "Dwarf1", playerName: "SfD1", species: "Hill Dwarf", earnedSP: 0 }),
        char({ name: "Dwarf20", playerName: "SfD20", species: "Hill Dwarf", earnedSP: 200, purchasedSkills: [skill("resist_toxin", 4)] }),
        char({ name: "Human20", playerName: "SfH20", species: "Human", earnedSP: 200 }),
      ], {}, async (app) => {
        await openCharacter(app, "SfD1", { edit: false });
        assert.equal(await circles(await printSheet(app), "Resist Toxin"), 1, "1 free at 1st level"); await back(app);
        await openCharacter(app, "SfD20", { edit: false });
        const free = 3; // 200 earned SP = level 20: free at 1st, 10th and 20th
        assert.equal(await circles(await printSheet(app), "Resist Toxin"), 4);
        assert.equal(await unspent(app), 50 + 200 - 4 * Math.max(0, 4 - free), `only uses beyond ${free} free are paid`); await back(app);
        await openCharacter(app, "SfH20", { edit: false });
        assert.doesNotMatch((await printSheet(app)).text, /Resist Toxin/, "not their species");
      }));

      test("Elementalkin Resist Elemental, Kitsune Evade and Half-Troll Regeneration get the free uses too", () => withApp(T, [
        char({ name: "Djinn10", playerName: "SfDj", species: "Djinn (Elementalkin)", earnedSP: 100 }),
        char({ name: "Kit10", playerName: "SfKit", species: "Kitsune", earnedSP: 100 }),
        char({ name: "Troll1", playerName: "SfTr", species: "Half-Troll", earnedSP: 0 }),
      ], {}, async (app) => {
        for (const [who, label, n] of [["SfDj", "Resist Elemental", 2], ["SfKit", "Evade", 2], ["SfTr", "Regeneration", 1]]) {
          await openCharacter(app, who, { edit: false });
          const before = await unspent(app);
          assert.equal(await circles(await printSheet(app), label), n, `${who}: ${label}`);
          assert.equal(before, 50 + (who === "SfTr" ? 0 : 100), "free uses cost nothing");
          await back(app);
        }
      }));

      if (T.name === "hub") test("2026 pricing fixes: mana points, missing tiers, SP owed, guarded and run once", async () => {
        const a = char({ id: "pr-a", name: "Mana", playerName: "PrA", classId: "mage", earnedSP: 200, purchasedSkills: [skill("mage_pool_1"), skill("mage_mana_1", 42)] });
        const b = char({ id: "pr-b", name: "Smith", playerName: "PrB", startingSP: 9, earnedSP: 0, purchasedSkills: [skill("smithing_5")] });
        const c = char({ id: "pr-c", name: "Edited", playerName: "PrC", classId: "mage", earnedSP: 200, purchasedSkills: [skill("mage_pool_1"), skill("mage_mana_1", 30)] });
        const pricingPlan = [{ id: "pr-a", ops: [["set", "mage_mana_1", 42, 21]] }, { id: "pr-b", ops: [["add", "smithing", 4, "smithing_5"]] }, { id: "pr-c", ops: [["set", "mage_mana_1", 42, 21]] }];
        await withApp(T, [a, b, c], { pricingPlan }, async (app) => {
          await app.frame.locator("button", { hasText: "Fix 2026 pricing" }).click(); await pause(app.frame);
          await app.frame.locator("button", { hasText: "Back up and fix pricing" }).click();
          await app.frame.waitForFunction(() => /Corrected \d+|Stopped:/.test(document.body.innerText), null, { timeout: 60000 });
          assert.match(await text(app.frame), /Corrected 2/);
          const n = async (who, id) => (await stored(app, who)).purchasedSkills.filter((p) => p.skillId === id).reduce((x, p) => x + p.timesPurchased, 0);
          assert.equal(await n("Mana", "mage_mana_1"), 21);
          assert.equal(await n("Smith", "smithing"), 4); assert.match((await stored(app, "Smith")).notes, /SP owed: with the full skill chain/);
          assert.equal(await n("Edited", "mage_mana_1"), 30, "count changed since the plan: left alone");
          for (const who of ["Mana", "Smith", "Edited"]) assert.equal((await stored(app, who)).pricing2026Done, true);
        });
      });
    });

    // ---------------- Dailies: any number of purchases ----------------
    describe("dailies", () => {
      test("Barrier (a Daily) can be bought again and each purchase is a circle", () => withApp(T, [
        char({ name: "Barrier Pal", playerName: "DlPal", classId: "paladin", earnedSP: 60, purchasedSkills: [skill("pal_barrier", 3)] }),
      ], {}, async (app) => {
        await openCharacter(app, "DlPal");
        const row = app.frame.locator("div.flex.items-center.gap-2.px-3.py-2").filter({ hasText: /^Barrier/ }).first();
        const before = await unspent(app);
        await row.locator("button", { hasText: "+" }).click(); await pause(app.frame);
        assert.equal(await unspent(app), before - 3, "4th Barrier costs 3 SP");
        await save(app);
        const sheet = await printSheet(app);
        assert.equal(await circles(sheet, "Barrier"), 4);
      }));

      test("Void Familiar: 2 action circles per purchase; species Resist Magic repeatable; Gunsmithing caps at 5", () => withApp(T, [
        char({ name: "Familiar", playerName: "DlWlk", classId: "warlock", earnedSP: 60, purchasedSkills: [skill("wlk_familiar", 3)] }),
        char({ name: "Pixie", playerName: "DlPix", species: "Pixie", earnedSP: 60, purchasedSkills: [skill("resist_magic", 2)] }),
        char({ name: "Smith", playerName: "DlGun", classId: "gunslinger", earnedSP: 60, purchasedSkills: [skill("gun_gunsmithing", 5)] }),
      ], {}, async (app) => {
        await openCharacter(app, "DlWlk", { edit: false });
        assert.equal(await circles(await printSheet(app), "Void Familiar Actions"), 6); await back(app);
        await openCharacter(app, "DlPix", { edit: false });
        assert.equal(await circles(await printSheet(app), "Resist Magic"), 2); await back(app);
        await openCharacter(app, "DlGun");
        const row = app.frame.locator("div.flex.items-center.gap-2.px-3.py-2").filter({ hasText: /^Gunsmithing/ }).first();
        assert.equal(await row.locator("button", { hasText: "+" }).isDisabled(), true, "Gunsmithing max 5");
      }));
    });

    // ---------------- Wiki species powers and skills ----------------
    describe("wiki species powers", () => {
      const picks = async (app, who, q) => {
        await openCharacter(app, who);
        const box = app.frame.locator('input[placeholder="Search powers..."]').first();
        await box.click(); await box.fill(q); await pause(app.frame);
        const t = await app.frame.locator("div.absolute.z-50").last().innerText();
        await box.fill(""); await app.frame.locator("body").click({ position: { x: 5, y: 5 } }); await pause(app.frame); await back(app);
        return t;
      };
      test("species powers from the wiki are pickable by their species only", () => withApp(T, [
        char({ playerName: "WsSidhe", species: "Sidhe (Fae)" }), char({ playerName: "WsOrc", species: "Orc" }),
        char({ playerName: "WsDrak", species: "Metallic Drakken (Gold)" }),
      ], {}, async (app) => {
        assert.match(await picks(app, "WsSidhe", "Essence"), /Available[\s\S]*Essence Born/i);
        assert.match(await picks(app, "WsOrc", "Essence"), /Not eligible[\s\S]*Essence Born/i);
        assert.match(await picks(app, "WsDrak", "Steel Heart"), /Available[\s\S]*Steel Heart/i);
      }));
      test("Sidhe can buy extra Gaze Charm; Barrows extra Resist Psionics", () => withApp(T, [
        char({ playerName: "WsGaze", species: "Sidhe", earnedSP: 20 }), char({ playerName: "WsBar", species: "Barrows", earnedSP: 20 }),
      ], {}, async (app) => {
        await openCharacter(app, "WsGaze"); await tab(app, "Species");
        assert.match(await text(app.frame), /Gaze Charm \(Sidhe — 4 SP\)/); await back(app);
        await openCharacter(app, "WsBar"); await tab(app, "Species");
        assert.match(await text(app.frame), /Resist Psionics \(Barrows — 2 SP\)/);
      }));
    });

    // ---------------- Gunmage (101st MC(A)) ----------------
    // Ranks unlock SP purchases instead of granting abilities. Likely break points:
    // Joule pricing and totals, rank gates from Favor, the 51-75 band, prerequisite
    // chains, SP totals, the second slot, rank loss, and the printed sheet.
    describe("gunmage", () => {
      const gunRow = (app, name) => app.frame.locator("div.flex.items-center.gap-2.px-3.py-2").filter({ hasText: name }).first();
      const plus = (app, name) => gunRow(app, name).locator("button", { hasText: "+" });
      const minus = (app, name) => gunRow(app, name).locator("button", { hasText: "−" });
      const gm = (over = {}) => char({ classId: "gunslinger", species: "Human", earnedSP: 200, ...over });

      test("names and nicknames all select Gunmage", () => withApp(T, [
        gm({ playerName: "ZqNic1", purchasedSkills: [skill("attunement", 1, "101st MC(A)")] }),
        gm({ playerName: "ZqNic2", purchasedSkills: [skill("attunement", 1, "Spellshot")] }),
        gm({ playerName: "ZqNic3", purchasedSkills: [skill("attunement", 1, "gun mage")] }),
      ], {}, async (app) => {
        for (const who of ["ZqNic1", "ZqNic2", "ZqNic3"]) {
          await openCharacter(app, who); await tab(app, "Attunement");
          assert.match(await text(app.frame), /Gunmage Purchases \(Rank 1\)/, who);
          await back(app);
        }
      }));

      test("Joules 11-50: 1 SP buys 2 Joules, capped at 20 purchases (50 Joules)", () => withApp(T, [
        gm({ playerName: "ZqJo", favorLog: [favor(1, 0)], purchasedSkills: [skill("attunement", 1, "Gunmage"), skill("gm_joules_1", 19)] }),
      ], {}, async (app) => {
        await openCharacter(app, "ZqJo"); await tab(app, "Attunement");
        assert.match(await text(app.frame), /Joules: 48 \(10 free \+ 38 bought\)/);
        const before = await unspent(app);
        await plus(app, "Gunmage Joules (11–50)").click(); await pause(app.frame);
        assert.equal(await unspent(app), before - 1, "one purchase = 1 SP");
        assert.match(await text(app.frame), /Joules: 50 \(10 free \+ 40 bought\)/);
        assert.equal(await plus(app, "Gunmage Joules (11–50)").isDisabled(), true, "no Joule 51 from the cheap band");
      }));

      test("Joules 51-75 need Rank 5 AND a full 11-50 band; 2 SP each; 75 max", () => withApp(T, [
        gm({ playerName: "ZqR4full", favorLog: [favor(1, 15)], purchasedSkills: [skill("attunement", 1, "Gunmage"), skill("gm_joules_1", 20)] }),
        gm({ playerName: "ZqR5part", favorLog: [favor(1, 20)], purchasedSkills: [skill("attunement", 1, "Gunmage"), skill("gm_joules_1", 19)] }),
        gm({ playerName: "ZqR5full", favorLog: [favor(1, 20)], purchasedSkills: [skill("attunement", 1, "Gunmage"), skill("gm_joules_1", 20), skill("gm_joules_2", 24)] }),
      ], {}, async (app) => {
        const band = "Gunmage Joules (51–75)";
        await openCharacter(app, "ZqR4full"); await tab(app, "Attunement");
        assert.equal(await plus(app, band).isDisabled(), true, "Rank 4 is too low"); await back(app);
        await openCharacter(app, "ZqR5part"); await tab(app, "Attunement");
        assert.equal(await plus(app, band).isDisabled(), true, "11-50 not full"); await back(app);
        await openCharacter(app, "ZqR5full"); await tab(app, "Attunement");
        const before = await unspent(app);
        await plus(app, band).click(); await pause(app.frame);
        assert.equal(await unspent(app), before - 2);
        assert.match(await text(app.frame), /Joules: 75 \(10 free \+ 65 bought\)/);
        assert.equal(await plus(app, band).isDisabled(), true, "75 is the cap");
      }));

      test("unspent SP counts Gunmage purchases already on the sheet", () => withApp(T, [
        gm({ playerName: "ZqSum", earnedSP: 100, favorLog: [favor(1, 50)], purchasedSkills: [
          skill("attunement", 1, "Gunmage"), skill("gm_joules_1", 20), skill("gm_joules_2", 5), skill("gm_acc_1"), skill("gm_acc_2"), skill("gm_acc_3"),
          skill("gm_conservation", 2), skill("gm_forced_return", 1), skill("gm_consume"), skill("gm_truesight", 3)] }),
      ], {}, async (app) => {
        await openCharacter(app, "ZqSum");
        // 150 - attunement 10 - joules 20 - 10 - accuracy 60 - conservation 4 - forced return 3 - consume 5 - truesight 15
        assert.equal(await unspent(app), 150 - 10 - 20 - 10 - 60 - 4 - 3 - 5 - 15);
      }));

      test("each unlock opens at its rank and not before", () => withApp(T, [
        gm({ playerName: "ZqLo", favorLog: [favor(1, 4)], purchasedSkills: [skill("attunement", 1, "Gunmage"), skill("gm_conservation"), skill("gm_acc_1"), skill("gm_acc_2")] }),
        gm({ playerName: "ZqHi", favorLog: [favor(1, 45)], purchasedSkills: [skill("attunement", 1, "Gunmage"), skill("gm_conservation"), skill("gm_acc_1"), skill("gm_acc_2")] }),
      ], {}, async (app) => {
        const items = ["Gunmage Accuracy +3", "Gunmage Forced Return", "Gunmage Consume", "Gunmage Truesight"];
        await openCharacter(app, "ZqLo"); await tab(app, "Attunement");
        for (const n of items) assert.equal(await plus(app, n).isDisabled(), true, `${n} locked at Rank 1`);
        await back(app);
        await openCharacter(app, "ZqHi"); await tab(app, "Attunement");
        assert.match(await text(app.frame), /Rank 10 · Adept · Favor 45/);
        for (const n of items) assert.equal(await plus(app, n).isDisabled(), false, `${n} open at Rank 10`);
      }));

      test("prerequisite chains: Accuracy in order; Conservation can't be removed under Forced Return", () => withApp(T, [
        gm({ playerName: "ZqChain", favorLog: [favor(1, 25)], purchasedSkills: [skill("attunement", 1, "Gunmage"), skill("gm_conservation"), skill("gm_forced_return")] }),
      ], {}, async (app) => {
        await openCharacter(app, "ZqChain"); await tab(app, "Attunement");
        assert.equal(await plus(app, "Gunmage Accuracy +2").isDisabled(), true, "+2 needs +1");
        assert.equal(await minus(app, "Gunmage Conservation").isDisabled(), true, "Forced Return needs it");
        await plus(app, "Gunmage Accuracy +1").click(); await pause(app.frame);
        assert.equal(await plus(app, "Gunmage Accuracy +2").isDisabled(), false);
      }));

      test("Gunmage Accuracy does not count toward Gunslinger Accuracy", () => withApp(T, [
        gm({ playerName: "ZqSep", favorLog: [favor(1, 0)], purchasedSkills: [skill("attunement", 1, "Gunmage"), skill("gm_acc_1")] }),
      ], {}, async (app) => {
        await openCharacter(app, "ZqSep"); await tab(app, "Gunslinger Skills");
        const row = app.frame.locator("div.flex.items-center.gap-2.px-3.py-2").filter({ hasText: /^Accuracy \+2/ }).first();
        assert.equal(await row.locator("button", { hasText: "+" }).isDisabled(), true, "class Accuracy +2 still needs class Accuracy +1");
      }));

      test("second attunement slot uses its own Favor", () => withApp(T, [
        gm({ playerName: "ZqTwo", favorLog: [favor(1, 45), favor(2, 5)], purchasedSkills: [skill("attunement", 1, "Reaper"), skill("second_attunement", 1, "Gunmage")] }),
      ], {}, async (app) => {
        await openCharacter(app, "ZqTwo"); await tab(app, "Attunement");
        assert.match(await text(app.frame), /Gunmage Purchases \(Rank 2\)/);
        assert.equal(await plus(app, "Gunmage Conservation").isDisabled(), false);
        assert.equal(await plus(app, "Gunmage Forced Return").isDisabled(), true, "Rank 3 needs 10 Favor in slot 2");
      }));

      test("entry warning: Human Mage and Human Gunslinger are fine; others warned but allowed", () => withApp(T, [
        gm({ playerName: "ZqOkM", classId: "mage", purchasedSkills: [skill("attunement", 1, "Gunmage")] }),
        gm({ playerName: "ZqOkG", purchasedSkills: [skill("attunement", 1, "Gunmage")] }),
        gm({ playerName: "ZqElf", species: "Deep Elf", purchasedSkills: [skill("attunement", 1, "Gunmage")] }),
        gm({ playerName: "ZqWar", classId: "warrior", purchasedSkills: [skill("attunement", 1, "Gunmage")] }),
      ], {}, async (app) => {
        for (const [who, warned] of [["ZqOkM", false], ["ZqOkG", false], ["ZqElf", true], ["ZqWar", true]]) {
          await openCharacter(app, who); await tab(app, "Attunement");
          const t = await text(app.frame);
          assert.equal(/Gunmage requires a Human Mage or Gunslinger/.test(t), warned, who);
          assert.match(t, /Gunmage Purchases/, `${who} can still buy`);
          await back(app);
        }
      }));

      test("losing rank keeps purchases and SP, and adds a prerequisite exception note", () => withApp(T, [
        gm({ name: "Demoted", playerName: "ZqDem", favorLog: [favor(1, 0)], purchasedSkills: [skill("attunement", 1, "Gunmage"), skill("gm_truesight", 2)] }),
      ], {}, async (app) => {
        await openCharacter(app, "ZqDem");
        assert.equal(await unspent(app), 250 - 10 - 10, "purchases still charged");
        const notes = await app.frame.evaluate(() => [...document.querySelectorAll("textarea")].map((t) => t.value).join("\n"));
        assert.match(notes, /Prerequisite exception: Gunmage Truesight requires Gunmage Rank 10/);
        await tab(app, "Attunement");
        assert.match(await text(app.frame), /Gunmage Truesight[\s\S]*×2/);
      }));

      test("non-Gunmage characters see no Gunmage purchases", () => withApp(T, [
        gm({ playerName: "ZqRea", favorLog: [favor(1, 45)], purchasedSkills: [skill("attunement", 1, "Reaper")] }),
      ], {}, async (app) => {
        await openCharacter(app, "ZqRea"); await tab(app, "Attunement");
        const t = await text(app.frame);
        assert.doesNotMatch(t, /Gunmage Purchases|Joules/);
      }));

      test("player view shows Gunmage purchases by name with their SP", () => withApp(T, [
        gm({ name: "Spellshot", playerName: "ZqGus", playerEmail: "gus@example.com", favorLog: [favor(1, 50)], purchasedSkills: [
          skill("attunement", 1, "Gunmage"), skill("gm_joules_1", 4), skill("gm_acc_1")] }),
      ], { role: "player", email: "gus@example.com" }, async (app) => {
        await openCharacter(app, "Spellshot", { edit: false });
        const v = await text(app.frame);
        assert.match(v, /Gunmage Joules \(11–50\)\s*×4\s*4 SP/);
        assert.match(v, /Gunmage Accuracy \+1\s*20 SP/);
        assert.doesNotMatch(v, /Gm Joules|Gm Acc/, "no raw skill ids");
      }));

      test("printed sheet: Joules total, rank text, purchases, one circle per daily", () => withApp(T, [
        gm({ name: "Printshot", playerName: "ZqPrn", favorLog: [favor(1, 50)], purchasedSkills: [
          skill("attunement", 1, "Gunmage"), skill("gm_joules_1", 4), skill("gm_acc_1"), skill("gm_conservation", 2), skill("gm_truesight", 3)] }),
      ], {}, async (app) => {
        await openCharacter(app, "ZqPrn", { edit: false });
        const sheet = await printSheet(app);
        assert.match(sheet.text, /Joules: 18/);
        assert.match(sheet.text, /Rank 1 - Ballistic Magic; 10 Joules; Friendly Fire scroll/);
        assert.match(sheet.text, /Rank 9 - Unlocks 5th level spells; Ward Shot scroll/);
        assert.match(sheet.text, /Gunmage Accuracy \+1/);
        assert.equal(await circles(sheet, "Conservation"), 2);
        assert.equal(await circles(sheet, "Truesight"), 3);
      }));
    });

    // ---------------- Printed sheet ----------------
    describe("printed sheet", () => {
      test("layout: attunements side by side, narrow Checkout, no Tickets, resets never split", () => withApp(T, [
        char({ name: "Printer", playerName: "PtrLayout", classId: "mage", favorLog: [favor(1, 20), favor(2, 20)], checkout: { membership: true },
          purchasedSkills: [skill("attunement", 1, "Reaper"), skill("second_attunement", 1, "Riverwalkers"), skill("mage_pool_1")] }),
      ], {}, async (app) => {
        await openCharacter(app, "PtrLayout", { edit: false });
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
