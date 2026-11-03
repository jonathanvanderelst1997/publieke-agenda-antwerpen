// Een site die automatische toegang weigert (lib/fetch-util.mjs, BRON_WEIGERT_CODE). Sinds de nacht van 22 op
// 23-10-2026 antwoordt de rand van www.antwerpen.be (Akamai) elke klant die geen browser is met een 403
// "Access Denied", ook voor robots.txt. Vijf bronnen faalden daardoor met http_403, en sources:health gaf
// bij elke verversing opnieuw alarm, voor iets wat geen verversing kan oplossen. Nu: een eigen foutcode,
// de vorige stand blijft, en een melding met uitleg in plaats van een fout. Niets probeert er omheen.
// Sinds 3-11-2026 (besluit van de eigenaar) toont de site de komende items van de laatste goede lezing tot hun eigen
// datum, hoe oud die lezing ook is; de weigering blijft dan altijd een melding, één zin per website.
// De weigeringspagina hieronder heeft de vorm van de echte, met een verzonnen referentie.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { BRON_WEIGERT_CODE, FetchError, errorSinceOf, fetchWithTimeout, isRandWeigering, isTransientErrorCode, isWeigeringCode, sourceHealthOf } from "../lib/fetch-util.mjs";
import { LIVE_HISTORY_LAYERS } from "../lib/live-history.mjs";
import { STRAAT_LAGEN } from "../lib/straat-bestanden.mjs";
import { SOURCE_ID, run } from "../scripts/fetch-sources-koopzondagen.mjs";
import { leesWerkstroom } from "../scripts/refresh-droog.mjs";
import { checkHealth, weigeringsMeldingen } from "../scripts/sources-health.mjs";

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

test("sources:health: geweigerd is één melding per website, met de dag waarop het begon, geen fout", (t) => {
  const root = makeRoot(t);
  const regel = (sourceId, errorCode, extra = {}) => ({ sourceId, file: `sources/${sourceId}.json`, scope: "stad", fetchStatus: "error", retrievedAt: "2026-10-22T03:20:28.162Z", maxAgeHours: 48, itemCount: 5, errorCode, ...extra });
  const schrijf = (sources) => fs.writeFileSync(path.join(root, "site", "sources", "refresh-status.json"), JSON.stringify({ schemaVersion: 1, generatedAt: "2026-10-23T03:21:01.051Z", classificationAsOf: "2026-10-23", sources }));
  const vroeg = Date.parse("2026-10-23T06:00:00Z");
  assert.equal(sourceHealthOf(regel("stad-koopzondagen", BRON_WEIGERT_CODE), vroeg), "geweigerd");
  assert.equal(sourceHealthOf(regel("stad-districten", `channel_${BRON_WEIGERT_CODE}`), vroeg), "geweigerd");
  assert.equal(sourceHealthOf(regel("stad-koopzondagen", "http_403"), vroeg), "error", "een andere 403 blijft een fout");

  const sinds = { errorSince: "2026-10-23T03:21:01.051Z" };
  schrijf([regel("stad-districten", `channel_${BRON_WEIGERT_CODE}`, sinds), regel("stad-koopzondagen", BRON_WEIGERT_CODE, sinds)]);
  const geweigerd = checkHealth({ rootDir: root, at: vroeg, env: {} });
  assert.equal(geweigerd.exitCode, 0);
  assert.equal(geweigerd.unhealthy, 0);
  assert.match(geweigerd.lines.join("\n"), /^stad-koopzondagen\tgeweigerd\terror\t/m);
  const meldingen = geweigerd.meldingen.filter((m) => m.titel === "Bron weigert automatische toegang");
  assert.equal(meldingen.length, 1, "één melding voor dezelfde website");
  assert.equal(meldingen[0].tekst, "www.antwerpen.be weigert ons sinds 23-10-2026; de agenda toont de laatst bekende activiteiten (laatste goede lezing 22-10-2026) tot hun eigen datum voorbij is. Nieuwe activiteiten van deze bronnen komen er pas bij als de stad de agenda weer toelaat of de gegevens als open data geeft. Bronnen: stad-districten, stad-koopzondagen.");

  schrijf([regel("stad-koopzondagen", "http_403")]);
  assert.equal(checkHealth({ rootDir: root, at: vroeg, env: {} }).exitCode, 1, "zonder de weigeringspagina blijft het alarm");
});

test("sources:health: ook weken later blijft een weigering een melding, met dezelfde zin (het alarm reageert één keer)", (t) => {
  const root = makeRoot(t);
  const regel = { sourceId: "stad-koopzondagen", file: "sources/stad-koopzondagen.json", scope: "stad", fetchStatus: "error", retrievedAt: "2026-10-22T03:20:28.162Z", maxAgeHours: 48, itemCount: 5, errorCode: BRON_WEIGERT_CODE, errorSince: "2026-10-23T03:21:01.051Z" };
  fs.writeFileSync(path.join(root, "site", "sources", "refresh-status.json"), JSON.stringify({ schemaVersion: 1, generatedAt: "2026-10-23T03:21:01.051Z", classificationAsOf: "2026-10-23", sources: [regel] }));
  const laat = Date.parse("2026-11-13T06:00:00Z");
  assert.equal(sourceHealthOf(regel, laat), "geweigerd");
  const te = checkHealth({ rootDir: root, at: laat, env: {} });
  assert.equal(te.exitCode, 0);
  assert.equal(te.unhealthy, 0);
  const vroeger = checkHealth({ rootDir: root, at: Date.parse("2026-10-24T06:00:00Z"), env: {} });
  const zin = (r) => r.meldingen.find((m) => m.titel === "Bron weigert automatische toegang").tekst;
  assert.equal(zin(te), zin(vroeger), "geen uren of tijdstippen in de zin");
  assert.match(zin(te), /^www\.antwerpen\.be weigert ons sinds 23-10-2026; de agenda toont de laatst bekende activiteiten/);
  // Zonder errorSince (een ouder bestand): de dag van de laatste goede lezing.
  assert.deepEqual(weigeringsMeldingen([{ ...regel, errorSince: undefined }]).map((t) => t.split(";")[0]), ["www.antwerpen.be weigert ons sinds de laatste goede lezing van 22-10-2026"]);
});

test("keepPreviousOnError: lastError.since is de eerste mislukte poging van de reeks", () => {
  assert.equal(errorSinceOf(null, "2026-10-23T03:21:01.051Z"), "2026-10-23T03:21:01.051Z", "eerste fout: nu");
  assert.equal(errorSinceOf({ fetchStatus: "ok" }, "2026-10-24T03:00:00.000Z"), "2026-10-24T03:00:00.000Z");
  const vorige = { fetchStatus: "error", lastError: { code: BRON_WEIGERT_CODE, at: "2026-11-02T04:00:00.000Z", since: "2026-10-23T03:21:01.051Z" } };
  assert.equal(errorSinceOf(vorige, "2026-11-03T04:00:00.000Z"), "2026-10-23T03:21:01.051Z", "de reeks loopt door");
  assert.equal(errorSinceOf({ fetchStatus: "error", lastError: { code: "timeout", at: "2026-11-02T04:00:00.000Z" } }, "2026-11-03T04:00:00.000Z"), "2026-11-02T04:00:00.000Z", "ouder bestand zonder since: de vorige poging");
});

// De stap "Elke bron gezond" van source-health draait hier echt (bash, jq en GNU date, zoals op de runner), met een
// verzonnen refresh-status.json; zie ook tests/refresh-workflow.test.mjs. Ontbreekt een van de drie (macOS heeft BSD
// date), dan slaat de toets over in plaats van vals te falen.
const stapKanDraaien = spawnSync("bash", ["-c", "command -v jq >/dev/null && date -u -d 2026-10-22T03:20:28Z +%s >/dev/null 2>&1"]).status === 0;
test("de bronstatus in de workflow: een weigering is nooit een fout; de zin uit weigering.txt wordt één melding", { skip: stapKanDraaien ? false : "bash, jq of GNU date ontbreekt" }, () => {
  const stap = leesWerkstroom(workflow).get("source-health").steps.find((s) => s.name === "Elke bron gezond");
  assert.ok(stap?.run, "stap Elke bron gezond");
  const draai = (bronnen, weigering = null) => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bron-weigering-stap-"));
    try {
      fs.mkdirSync(path.join(temp, "in"));
      fs.writeFileSync(path.join(temp, "in", "refresh-status.json"), JSON.stringify({ sources: bronnen }));
      if (weigering !== null) fs.writeFileSync(path.join(temp, "in", "weigering.txt"), weigering);
      const sinds = new Date().toISOString();
      const lagen = [...LIVE_HISTORY_LAYERS.map((laag) => ["live-historiek", laag]), ...[...STRAAT_LAGEN.map(([naam]) => naam), "evenementen"].map((laag) => ["straatbestanden", laag])]
        .map(([bron, laag]) => ({ bron, laag, status: "ok", sinds, errorCode: null }));
      fs.writeFileSync(path.join(temp, "in", "live-lagen.json"), JSON.stringify({ lagen }));
      const output = path.join(temp, "output");
      const uit = spawnSync("bash", ["-c", stap.run], { env: { ...process.env, RUNNER_TEMP: temp, GITHUB_OUTPUT: output }, encoding: "utf8" });
      const tekst = fs.existsSync(output) ? fs.readFileSync(output, "utf8") : "";
      const m = tekst.match(/^melding<<(\S+)\n([\s\S]*?)\n?\1\n/m);
      return { code: uit.status, tekst: uit.stdout, melding: m ? m[2] : null };
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  };
  const recent = new Date(Date.now() - 26 * 3_600_000).toISOString();
  const oud = new Date(Date.now() - 22 * 24 * 3_600_000).toISOString();
  const fout = (sourceId, errorCode, retrievedAt) => ({ sourceId, fetchStatus: "error", retrievedAt, errorCode, maxAgeHours: 48 });
  const zin = "www.antwerpen.be weigert ons sinds 23-10-2026; de agenda toont de laatst bekende activiteiten (laatste goede lezing 22-10-2026) tot hun eigen datum voorbij is. Bronnen: stad-koopzondagen.";
  // Recent, oud of zonder datum, ook als kanaalfout van stad-districten: groen, zonder BRON-regel.
  for (const errorCode of [BRON_WEIGERT_CODE, `channel_${BRON_WEIGERT_CODE}`]) {
    assert.equal(isWeigeringCode(errorCode), true, errorCode);
    for (const retrievedAt of [recent, oud, "-"]) {
      const { code, tekst } = draai([fout("stad-koopzondagen", errorCode, retrievedAt)], `${zin}\n`);
      assert.equal(code, 0, `${errorCode} ${retrievedAt}: ${tekst}`);
      assert.doesNotMatch(tekst, /^BRON /m);
      assert.match(tekst, /de agenda toont de laatst bekende stand/);
    }
  }
  // De zin uit weigering.txt: één ::warning en de job-output "melding" voor het alarm-issue.
  const met = draai([fout("stad-koopzondagen", BRON_WEIGERT_CODE, oud)], `${zin}\n`);
  assert.equal((met.tekst.match(/::warning title=Bron weigert automatische toegang::/g) || []).length, 1, met.tekst);
  assert.ok(met.tekst.includes(`::warning title=Bron weigert automatische toegang::${zin}`), met.tekst);
  assert.equal(met.melding, zin);
  // Geen bestand of een leeg bestand: geen melding.
  assert.equal(draai([fout("stad-koopzondagen", BRON_WEIGERT_CODE, oud)]).melding, null);
  assert.equal(draai([fout("stad-koopzondagen", BRON_WEIGERT_CODE, oud)], "").melding, null);
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
