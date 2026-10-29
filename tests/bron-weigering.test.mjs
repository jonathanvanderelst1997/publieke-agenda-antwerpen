// Een site die automatische toegang weigert (lib/fetch-util.mjs, BRON_WEIGERT_CODE). Sinds de nacht van 22 op
// 23-10-2026 antwoordt de rand van www.antwerpen.be (Akamai) elke klant die geen browser is met een 403
// "Access Denied", ook voor robots.txt. Vijf bronnen faalden daardoor met http_403, en sources:health gaf
// bij elke verversing opnieuw alarm, voor iets wat geen verversing kan oplossen. Nu: een eigen foutcode,
// de vorige stand blijft, en een melding met uitleg in plaats van een fout. Niets probeert er omheen.
// De weigeringspagina hieronder heeft de vorm van de echte, met een verzonnen referentie.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { BRON_WEIGERT_CODE, FetchError, fetchWithTimeout, isRandWeigering, isTransientErrorCode, isWeigeringCode, sourceHealthOf } from "../lib/fetch-util.mjs";
import { LIVE_HISTORY_LAYERS } from "../lib/live-history.mjs";
import { STRAAT_LAGEN } from "../lib/straat-bestanden.mjs";
import { SOURCE_ID, run } from "../scripts/fetch-sources-koopzondagen.mjs";
import { leesWerkstroom } from "../scripts/refresh-droog.mjs";
import { checkHealth } from "../scripts/sources-health.mjs";

const AKAMAI = `<HTML><HEAD>
<TITLE>Access Denied</TITLE>
</HEAD><BODY>
<H1>Access Denied</H1>

You don't have permission to access "http&#58;&#47;&#47;www&#46;antwerpen&#46;be&#47;info&#47;koopzondagen" on this server.<P>
Reference&#32;&#35;18&#46;0000aaaa&#46;1700000000&#46;0bad0bad
<P>https&#58;&#47;&#47;errors&#46;edgesuite&#46;net&#47;18&#46;0000aaaa&#46;1700000000&#46;0bad0bad</P>
</BODY>
</HTML>
`;
const page = fs.readFileSync(new URL("./fixtures/koopzondagen-2026-09-28.article.html", import.meta.url), "utf8");
const NOW = new Date("2026-09-28T06:00:00Z");
const quiet = () => {};
const antwoord = (body, status, type = "text/html") => new Response(body, { status, headers: { "content-type": type } });
const workflow = fs.readFileSync(new URL("../.github/workflows/refresh.yml", import.meta.url), "utf8");

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bron-weigering-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "site", "sources"), { recursive: true });
  return root;
}

test("herkent de weigering aan de rand, en alleen die", () => {
  assert.equal(isRandWeigering(403, AKAMAI), true);
  assert.equal(isRandWeigering(403, "<h1>Forbidden</h1>"), false, "een gewone 403 blijft http_403");
  assert.equal(isRandWeigering(503, AKAMAI), false);
  assert.equal(isRandWeigering(403, ""), false);
  assert.equal(isTransientErrorCode(BRON_WEIGERT_CODE), false, "geen tijdelijke fout: herhalen helpt niet");
});

test("fetchWithTimeout: de weigering wordt een eigen foutcode; elk ander antwoord gaat onveranderd door", async () => {
  await assert.rejects(fetchWithTimeout(async () => antwoord(AKAMAI, 403), "https://www.antwerpen.be/info/koopzondagen"), (error) => error instanceof FetchError && error.code === BRON_WEIGERT_CODE);
  const gewoon = await fetchWithTimeout(async () => antwoord("<h1>Forbidden</h1>", 403), "https://www.antwerpen.be/x");
  assert.equal(gewoon.status, 403);
  assert.equal(await gewoon.text(), "<h1>Forbidden</h1>", "de aanroeper kan het antwoord nog lezen");
  const ok = await fetchWithTimeout(async () => antwoord("goed", 200), "https://www.antwerpen.be/x");
  assert.equal(await ok.text(), "goed");
  // Een testantwoord zonder clone() (geen echte Response) gaat ongemoeid door.
  const kaal = await fetchWithTimeout(async () => ({ ok: false, status: 403, text: async () => AKAMAI }), "https://www.antwerpen.be/x");
  assert.equal(kaal.status, 403);
});

test("fetcher: een weigering laat de vorige stand staan, met de eigen foutcode in refresh-status", async (t) => {
  const root = makeRoot(t);
  const eerst = await run({ rootDir: root, clock: () => NOW, env: {}, log: quiet, fetch: async () => antwoord(page, 200, "text/html; charset=utf-8") });
  assert.equal(eerst[0].fetchStatus, "ok");
  const voor = JSON.parse(fs.readFileSync(path.join(root, "site", "sources", `${SOURCE_ID}.json`), "utf8"));
  let verzoeken = 0;
  const [status] = await run({ rootDir: root, clock: () => new Date("2026-09-29T06:00:00Z"), env: {}, log: quiet, fetch: async () => { verzoeken += 1; return antwoord(AKAMAI, 403); } });
  assert.deepEqual([status.fetchStatus, status.errorCode, status.itemCount, status.retrievedAt], ["error", BRON_WEIGERT_CODE, voor.items.length, voor.retrievedAt]);
  assert.equal(verzoeken, 1, "geen herhaling, geen omweg");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "site", "sources", `${SOURCE_ID}.json`), "utf8")).items, voor.items);
});

test("sources:health: geweigerd is een melding met uitleg zolang de vorige stand binnen maxAgeHours valt", (t) => {
  const root = makeRoot(t);
  const regel = (sourceId, errorCode) => ({ sourceId, file: `sources/${sourceId}.json`, scope: "stad", fetchStatus: "error", retrievedAt: "2026-10-22T03:20:28.162Z", maxAgeHours: 48, itemCount: 5, errorCode });
  const schrijf = (sources) => fs.writeFileSync(path.join(root, "site", "sources", "refresh-status.json"), JSON.stringify({ schemaVersion: 1, generatedAt: "2026-10-23T03:21:01.051Z", classificationAsOf: "2026-10-23", sources }));
  const vroeg = Date.parse("2026-10-23T06:00:00Z");
  assert.equal(sourceHealthOf(regel("stad-koopzondagen", BRON_WEIGERT_CODE), vroeg), "geweigerd");
  assert.equal(sourceHealthOf(regel("stad-districten", `channel_${BRON_WEIGERT_CODE}`), vroeg), "geweigerd");
  assert.equal(sourceHealthOf(regel("stad-koopzondagen", "http_403"), vroeg), "error", "een andere 403 blijft een fout");

  schrijf([regel("stad-districten", `channel_${BRON_WEIGERT_CODE}`), regel("stad-koopzondagen", BRON_WEIGERT_CODE)]);
  const geweigerd = checkHealth({ rootDir: root, at: vroeg, env: {} });
  assert.equal(geweigerd.exitCode, 0);
  assert.equal(geweigerd.unhealthy, 0);
  assert.match(geweigerd.lines.join("\n"), /^stad-koopzondagen\tgeweigerd\terror\t/m);
  assert.equal(geweigerd.meldingen.filter((m) => m.titel === "Bron weigert automatische toegang").length, 2);
  assert.match(geweigerd.warnings.join("\n"), /stad-koopzondagen: de website weigert automatische toegang \("Access Denied" aan de rand, geen storing bij ons\); laatste geslaagde ophaling 2026-10-22T03:20:28\.162Z \(26 uur oud\)\. Die stand blijft staan tot ze 48 uur oud is\./);

  schrijf([regel("stad-koopzondagen", "http_403")]);
  assert.equal(checkHealth({ rootDir: root, at: vroeg, env: {} }).exitCode, 1, "zonder de weigeringspagina blijft het alarm");
});

test("sources:health: is de vorige stand te oud, dan wordt een weigering een fout, met de ouderdom erbij", (t) => {
  const root = makeRoot(t);
  const regel = { sourceId: "stad-koopzondagen", file: "sources/stad-koopzondagen.json", scope: "stad", fetchStatus: "error", retrievedAt: "2026-10-22T03:20:28.162Z", maxAgeHours: 48, itemCount: 5, errorCode: BRON_WEIGERT_CODE };
  fs.writeFileSync(path.join(root, "site", "sources", "refresh-status.json"), JSON.stringify({ schemaVersion: 1, generatedAt: "2026-10-23T03:21:01.051Z", classificationAsOf: "2026-10-23", sources: [regel] }));
  // 22 dagen na de laatste geslaagde ophaling: de site verbergt de items al lang.
  const laat = Date.parse("2026-11-13T06:00:00Z");
  assert.equal(sourceHealthOf(regel, laat), "error");
  assert.equal(sourceHealthOf(regel, Date.parse("2026-10-24T03:20:28.162Z")), "geweigerd", "precies 48 uur: nog een melding");
  assert.equal(sourceHealthOf(regel, Date.parse("2026-10-24T03:20:29.162Z")), "error", "een seconde later: een fout");
  const te = checkHealth({ rootDir: root, at: laat, env: {} });
  assert.equal(te.exitCode, 1);
  assert.equal(te.unhealthy, 1);
  assert.match(te.lines.join("\n"), /^stad-koopzondagen\terror\terror\t/m);
  const melding = te.meldingen.find((m) => m.titel === "Bron weigert automatische toegang, stand te oud");
  assert.ok(melding, "een eigen melding met de ouderdom");
  assert.match(melding.tekst, /\(530 uur oud\)\. Dat is ouder dan 48 uur: de site toont de items van deze bron niet meer\./);
});

// De stap "Elke bron gezond" van source-health draait hier echt (bash, jq en GNU date, zoals op de runner), met een
// verzonnen refresh-status.json; zie ook tests/refresh-workflow.test.mjs. Ontbreekt een van de drie (macOS heeft BSD
// date), dan slaat de toets over in plaats van vals te falen.
const stapKanDraaien = spawnSync("bash", ["-c", "command -v jq >/dev/null && date -u -d 2026-10-22T03:20:28Z +%s >/dev/null 2>&1"]).status === 0;
test("de bronstatus in de workflow: een weigering is een waarschuwing binnen maxAgeHours en daarna een fout, zoals sourceHealthOf", { skip: stapKanDraaien ? false : "bash, jq of GNU date ontbreekt" }, () => {
  const stap = leesWerkstroom(workflow).get("source-health").steps.find((s) => s.name === "Elke bron gezond");
  assert.ok(stap?.run, "stap Elke bron gezond");
  const draai = (bronnen) => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bron-weigering-stap-"));
    try {
      fs.mkdirSync(path.join(temp, "in"));
      fs.writeFileSync(path.join(temp, "in", "refresh-status.json"), JSON.stringify({ sources: bronnen }));
      const sinds = new Date().toISOString();
      const lagen = [...LIVE_HISTORY_LAYERS.map((laag) => ["live-historiek", laag]), ...[...STRAAT_LAGEN.map(([naam]) => naam), "evenementen"].map((laag) => ["straatbestanden", laag])]
        .map(([bron, laag]) => ({ bron, laag, status: "ok", sinds, errorCode: null }));
      fs.writeFileSync(path.join(temp, "in", "live-lagen.json"), JSON.stringify({ lagen }));
      const uit = spawnSync("bash", ["-c", stap.run], { env: { ...process.env, RUNNER_TEMP: temp }, encoding: "utf8" });
      return { code: uit.status, tekst: uit.stdout };
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  };
  const recent = new Date(Date.now() - 26 * 3_600_000).toISOString();
  const oud = new Date(Date.now() - 22 * 24 * 3_600_000).toISOString();
  const fout = (sourceId, errorCode, retrievedAt) => ({ sourceId, fetchStatus: "error", retrievedAt, errorCode, maxAgeHours: 48 });
  // Binnen 48 uur: een waarschuwing met uitleg, de run blijft groen. Ook als kanaalfout van stad-districten.
  for (const errorCode of [BRON_WEIGERT_CODE, `channel_${BRON_WEIGERT_CODE}`]) {
    assert.equal(isWeigeringCode(errorCode), true, errorCode);
    const { code, tekst } = draai([fout("stad-koopzondagen", errorCode, recent)]);
    assert.equal(code, 0, `${errorCode}: ${tekst}`);
    assert.match(tekst, /::warning title=Bron weigert automatische toegang::stad-koopzondagen: de website weigert automatische toegang/);
    assert.match(tekst, /de vorige stand van 26 uur geleden blijft staan tot ze 48 uur oud is/);
  }
  // Te oud of zonder datum: rood, met een BRON-regel die zegt waarom (die gaat naar het alarm-issue).
  for (const retrievedAt of [oud, "-"]) {
    const { code, tekst } = draai([fout("stad-koopzondagen", BRON_WEIGERT_CODE, retrievedAt)]);
    assert.equal(code, 1, tekst);
    assert.match(tekst, /^BRON stad-koopzondagen: de website weigert automatische toegang \(bron_weigert_automatisch\) en de vorige stand \(.*\) is ouder dan 48 uur; de site toont de items van deze bron niet meer$/m);
  }
  // Een gewone 403 blijft rood, ook binnen 48 uur: zonder de weigeringspagina weten we niet wat er is.
  const gewoon = draai([fout("stad-koopzondagen", "http_403", recent)]);
  assert.equal(gewoon.code, 1, gewoon.tekst);
  assert.match(gewoon.tekst, /^BRON stad-koopzondagen: fetchStatus error \(http_403\)$/m);
});

test("de bronstatus in de workflow kent dezelfde code als sourceHealthOf", () => {
  assert.ok(workflow.includes(`[ "$kern" = "${BRON_WEIGERT_CODE}" ]`));
  assert.match(workflow, /title=Bron weigert automatische toegang::/);
  assert.equal(isTransientErrorCode(BRON_WEIGERT_CODE), false);
});
