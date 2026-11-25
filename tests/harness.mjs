// Test harness for the TFE Character Database regression suite (`./qa check`).
//
// Serves both copies of the app over a local web server and opens them in
// Chromium with test characters already loaded:
//   gh  - this repo's index.html (GitHub Pages copy, characters in browser storage)
//   hub - the Base44 website copy (the-fallen-empires-hub/public/character-db),
//         loaded inside a parent page that provides a stand-in for Base44
//         (window.tfeBridge) that follows the same access rules as the real
//         Character entity: GMs see and edit everything; players only see their
//         own characters and can only change Notes and the Spellbook.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
// require() so a globally installed Playwright (NODE_PATH) also works
const { chromium } = createRequire(import.meta.url)("playwright");

const here = path.dirname(fileURLToPath(import.meta.url));
export const GH_FILE = process.env.TFE_GH || path.resolve(here, "..", "index.html");
export const HUB_FILE =
  process.env.TFE_HUB || path.resolve(here, "..", "..", "the-fallen-empires-hub", "public", "character-db", "index.html");

export const TARGETS = [
  { name: "gh", label: "GitHub Pages copy", file: GH_FILE },
  { name: "hub", label: "Base44 website copy", file: HUB_FILE },
].filter((t) => fs.existsSync(t.file));

export const GM_EMAIL_GH = "fallenempiresllc@gmail.com";
export const GM_EMAIL_HUB = "mikedcraft@gmail.com";

// Parent page for the Base44 copy: a fake Base44 bridge backed by sessionStorage.
const PARENT = `<!doctype html><html><body style="margin:0"><script>
const fx = window.__TFE_FIXTURE || { chars: [], role: "gm" };
const norm = (e) => String(e ?? "").trim().toLowerCase();
function toRecord(c){const{__rid,notes,spellbook,...sheet}=c;const pe=norm(c.playerEmail);return{name:c.name||"Unnamed",player_name:c.playerName||"",player_email:pe,notes:notes||"",spellbook:Array.isArray(spellbook)?spellbook:[],legacy_id:c.id,sheet:{...sheet,playerEmail:pe}}}
function fromRecord(r){const sh=r.sheet||{};return{...sh,id:r.legacy_id||sh.id||r.id,name:r.name??"",playerName:r.player_name??"",playerEmail:r.player_email??"",notes:r.notes??"",spellbook:Array.isArray(r.spellbook)?r.spellbook:[],__rid:r.id}}
let store = JSON.parse(sessionStorage.getItem("fakeDB") || "null");
if (!store) { store = { rows: fx.chars.map((c, i) => ({ id: "r" + (i + 1), ...toRecord(c) })), n: fx.chars.length + 1 }; }
const persist = () => sessionStorage.setItem("fakeDB", JSON.stringify(store));
persist(); window.__store = store; window.__calls = [];
const clone = (x) => JSON.parse(JSON.stringify(x));
window.tfeBridge = {
  async me() { return fx.role === "gm" ? { email: "${GM_EMAIL_HUB}", isGM: true } : null; },
  gmSignIn() {}, gmSignOut() {},
  async adminSignIn(email) { const ok = norm(email) === "fallenempiresllc@gmail.com"; window.__admin = ok; return ok; },
  adminSignOut() { window.__admin = false; }, isAdminSession() { return !!window.__admin; },
  async gmList() { __calls.push("gmList"); return clone(store.rows).map(fromRecord); },
  async gmSave(c) { __calls.push("gmSave:" + c.name); const d = toRecord(c); let r; if (c.__rid) { r = store.rows.find((x) => x.id === c.__rid); Object.assign(r, d); } else { r = { id: "r" + store.n++, ...d }; store.rows.push(r); } persist(); return fromRecord(clone(r)); },
  async gmSeed() { __calls.push("gmSeed"); return { seeded: 0 }; },
  async gmBackup(label) { __calls.push("gmBackup"); if (fx.fixBackupFails) throw Error("Server error during backup: entity not found"); window.__backups = (window.__backups || []).concat([{ label, rows: clone(store.rows) }]); return { ok: true, count: store.rows.length, parts: 1 }; },
  async gmCorrections() { __calls.push("gmCorrections"); return clone(fx.corrections || { version: "none", label: "x", items: [] }); },
  async gmPricingPlan() { __calls.push("gmPricingPlan"); return { pricing: clone(fx.pricingPlan || []) }; },
  async gmFixPlan() { __calls.push("gmFixPlan"); if (!fx.fixPlan) throw Error("no plan"); return clone(fx.fixPlan); },
  async gmDelete(c) { __calls.push("gmDelete:" + c.id); store.rows = store.rows.filter((x) => x.id !== c.__rid); window.__store = store; persist(); },
  async playerList(email) { __calls.push("playerList:" + norm(email)); return clone(store.rows.filter((r) => r.player_email === norm(email))).map(fromRecord); },
  async playerSaveNotes(email, c, notes) { const r = store.rows.find((x) => x.id === c.__rid); if (!r || r.player_email !== norm(email)) throw Error("Not your character"); r.notes = notes; persist(); return notes; },
  async playerSaveSpellbook(email, c, rows) { const r = store.rows.find((x) => x.id === c.__rid); if (!r || r.player_email !== norm(email)) throw Error("Not your character"); r.spellbook = rows; persist(); return rows; },
};
</script><iframe id="db" src="/hub/character-db/index.html" style="width:100%;height:100vh;border:0"></iframe></body></html>`;

let server, base;
export async function startServer() {
  server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const send = (body, type = "text/html; charset=utf-8") => { res.writeHead(200, { "Content-Type": type }); res.end(body); };
    if (u.pathname === "/gh/index.html") return send(fs.readFileSync(GH_FILE));
    if (u.pathname === "/hub/" || u.pathname === "/hub/index.html") return send(PARENT);
    if (u.pathname === "/hub/character-db/index.html") return send(fs.readFileSync(HUB_FILE));
    res.writeHead(404); res.end("not found");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  return base;
}
export async function stopServer() { await new Promise((r) => server.close(r)); }

let browser;
export async function startBrowser() { browser = await chromium.launch(); return browser; }
export async function stopBrowser() { await browser?.close(); }

// A test character with sensible defaults.
let seq = 0;
export function char(over = {}) {
  seq++;
  return {
    id: over.id ?? `0000000${seq}-test-4000-8000-${String(seq).padStart(12, "0")}`,
    name: `Test Hero ${seq}`, playerName: `Player ${seq}`, playerEmail: "",
    classId: "warrior", species: "Human", background: "Soldier",
    startingSP: 50, earnedSP: 100, spLog: [], purchasedSkills: [], purchasedPowers: [],
    favorLog: [], crownLog: [], crowns: 0, deaths: 0, notes: "", ...over,
  };
}
export const skill = (skillId, timesPurchased = 1, label) => ({ instanceId: `${skillId}-${Math.random().toString(36).slice(2, 8)}`, skillId, timesPurchased, ...(label ? { label } : {}) });
export const favor = (slot, amount) => ({ attunementSlot: slot, amount, date: "2026-01-01", note: "test" });

// Open the app for one target with the given characters.
// opts.role: "gm" (default) or "player" (with opts.email).
export async function open(target, chars, opts = {}) {
  const role = opts.role ?? "gm";
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1600 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(({ chars, role, email, target, gmEmail, fixPlan, fixBackupFails, pricingPlan, corrections }) => {
    window.__TFE_FIXTURE = { chars, role, email, fixPlan, fixBackupFails, pricingPlan, corrections };
    window.open = () => ({ document: { write(h) { window.__printed = h; }, close() {} }, print() {}, focus() {} });
    try {
      if (!sessionStorage.getItem("__fixture")) {
        sessionStorage.setItem("__fixture", "1");
        if (target === "gh") localStorage.setItem("tfe_characters", JSON.stringify(chars));
        const who = role === "gm" ? (target === "gh" ? gmEmail : "") : email;
        who ? sessionStorage.setItem("tfe_session_email", who) : sessionStorage.removeItem("tfe_session_email");
      }
    } catch {}
  }, { chars, role, email: opts.email ?? "", target: target.name, gmEmail: GM_EMAIL_GH, fixPlan: opts.fixPlan ?? null, fixBackupFails: !!opts.fixBackupFails, pricingPlan: opts.pricingPlan ?? null, corrections: opts.corrections ?? null });
  await page.goto(target.name === "gh" ? `${base}/gh/index.html` : `${base}/hub/`);
  const frame = await getFrame(page, target);
  await frame.waitForFunction(() => !/Loading characters/.test(document.body.innerText), null, { timeout: 15000 });
  return { ctx, page, frame, errors, target, close: () => ctx.close() };
}

async function getFrame(page, target) {
  if (target.name === "gh") return page.mainFrame();
  for (let i = 0; i < 100; i++) {
    const f = page.frames().find((x) => /character-db/.test(x.url()));
    if (f) { await f.waitForLoadState("domcontentloaded"); return f; }
    await page.waitForTimeout(50);
  }
  throw new Error("Character Database iframe did not load");
}

// ---------- UI helpers (work the same on both copies) ----------
export const text = (f) => f.evaluate(() => document.body.innerText);
export const pause = (f, ms = 150) => f.page().waitForTimeout(ms);

export async function openCharacter(app, playerOrName, { edit = true } = {}) {
  const f = app.frame;
  await f.locator("button").filter({ hasText: playerOrName }).first().click();
  await pause(f, 200);
  if (edit) {
    const ed = f.locator("button", { hasText: /^Edit/ });
    if (await ed.count()) { await ed.first().click(); await pause(f, 200); }
  }
}
export async function tab(app, label) {
  await app.frame.locator("button", { hasText: label }).first().click();
  await pause(app.frame, 120);
}
export async function unspent(app) {
  const m = (await text(app.frame)).match(/(-?\d+) SP unspent/);
  return m ? Number(m[1]) : null;
}
export async function save(app) {
  await app.frame.locator("button", { hasText: /^Save$/ }).first().click();
  await pause(app.frame, 300);
}
export async function back(app) {
  await app.frame.locator("button", { hasText: /Back/ }).first().click();
  await pause(app.frame, 200);
}
// Print the open character and return a page showing the printed sheet.
export async function printSheet(app) {
  await app.frame.locator("button", { hasText: /Print/ }).first().click();
  await pause(app.frame, 200);
  const html = await app.frame.evaluate(() => window.__printed);
  if (!html) throw new Error("Print produced no sheet");
  const p = await app.ctx.newPage();
  await p.setContent(html);
  return { page: p, html, text: await p.evaluate(() => document.body.innerText) };
}
// Number of circles printed next to a tracker label (first reset).
export async function circles(sheet, label) {
  return sheet.page.evaluate((label) => {
    const s = [...document.querySelectorAll("span")].find((x) => x.textContent.trim() === label);
    return s ? s.parentElement.querySelectorAll('span[style*="border-radius:50%"]').length : 0;
  }, label);
}
// Read the saved character data (from browser storage or the fake Base44).
export async function stored(app, name) {
  if (app.target.name === "gh") {
    return app.page.evaluate((n) => JSON.parse(localStorage.getItem("tfe_characters") || "[]").find((c) => c.name === n), name);
  }
  return app.page.evaluate((n) => { const r = window.__store.rows.find((x) => x.name === n); return r && { ...r.sheet, notes: r.notes, spellbook: r.spellbook, name: r.name }; }, name);
}
