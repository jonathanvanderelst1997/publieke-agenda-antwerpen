// De nieuwe bron district-asign-evenementen in het register, het broncontract, sources:health,
// validate-data en de koppeling op de kaart (pakket P2). Verzonnen gegevens.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { agendaItemsUitBronnen } from "../lib/kaart-uitleg-refresh.mjs";
import { SOURCE_DEFINITIONS, normalizeSourceItem, sourceDocument, validateSourceDocument } from "../lib/source-feed.mjs";
import { AFGELEIDE_BRONNEN, FETCHERS } from "../lib/source-registry.mjs";
import { checkHealth } from "../scripts/sources-health.mjs";
import { alleenUitDossiers } from "../site/place-core.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_ID = "district-asign-evenementen";
const RETRIEVED = "2026-10-10T05:20:00.000Z";
const ASIGN = "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/22";
const item = (velden = {}) => ({
  id: "asign-ev-et2099000001-2026-10-18", externalId: "ET2099000001", title: "Evenement in de Proefstraat — naam volgt", theme: "Activiteit", className: "activity",
  date: "2026-10-18", endDate: null, timeSlot: "Info", timeText: "", location: "Proefstraat en Voorbeeldlaan", postcodes: ["2000"],
  info: "Parcours door 2 straten: Proefstraat en Voorbeeldlaan.", kind: "activity", sourceUrl: ASIGN, retrievedAt: RETRIEVED, reviewRequired: false, inDistrict: true,
  fasen: [{ naam: "Opbouw", start: "2026-10-17", eind: "2026-10-17" }, { naam: "Evenement", start: "2026-10-18", eind: "2026-10-18" }],
  straten: ["Proefstraat", "Voorbeeldlaan"], sameAs: ["district-kal-proef-2026-10-18"], ...velden,
});

test("register: een afgeleide bron na refresh:herkenning, geen fetcher; het broncontract kent haar", () => {
  assert.deepEqual(AFGELEIDE_BRONNEN.map((bron) => [bron.name, bron.na]), [[SOURCE_ID, "refresh:herkenning"]]);
  assert.equal(FETCHERS.some((fetcher) => fetcher.sourceIds.includes(SOURCE_ID)), false);
  const definitie = SOURCE_DEFINITIONS[SOURCE_ID];
  assert.deepEqual([definitie.scope, definitie.allowedHosts, definitie.idPrefix, definitie.bootstrapOptional, definitie.derivedAfter], ["district", ["geodata.antwerpen.be"], "asign-ev-", true, "refresh:herkenning"]);
});

test("broncontract: fasen, straten en sameAs zijn geldige optionele velden; fout gevormd wordt geweigerd", () => {
  const document = sourceDocument(SOURCE_ID, { retrievedAt: RETRIEVED, fetchStatus: "ok", items: [item()] });
  assert.deepEqual(validateSourceDocument(document, { expectedSourceId: SOURCE_ID }), []);
  assert.deepEqual(document.items[0].fasen.map((f) => f.naam), ["Opbouw", "Evenement"]);
  // Een lege lijst valt weg bij het normaliseren.
  assert.equal("sameAs" in normalizeSourceItem(item({ sameAs: [] })), false);
  const fout = (velden) => validateSourceDocument({ ...document, items: [{ ...document.items[0], ...velden }] }, { expectedSourceId: SOURCE_ID }).join(" ");
  assert.match(fout({ fasen: [{ naam: "Opbouw", start: "2026-10-18", eind: "2026-10-17" }] }), /ongeldige fasen/);
  assert.match(fout({ fasen: [{ naam: "Opbouw", start: "2026-10-17", eind: "2026-10-17", beheerder: "x" }] }), /ongeldige fasen/);
  assert.match(fout({ straten: ["Proefstraat", ""] }), /ongeldige straten/);
  assert.match(fout({ sameAs: ["asign-ev-et2099000001-2026-10-18"] }), /ongeldige sameAs/, "niet naar zichzelf");
  assert.match(fout({ sameAs: ["Niet Geldig"] }), /ongeldige sameAs/);
  assert.match(fout({ sourceUrl: "https://www.antwerpen.be/info/proef" }), /toegelaten host/);
});

function statusFile(root) {
  fs.mkdirSync(path.join(root, "site", "sources"), { recursive: true });
  fs.writeFileSync(path.join(root, "site", "sources", "refresh-status.json"), JSON.stringify({ schemaVersion: 1, generatedAt: RETRIEVED, classificationAsOf: "2026-10-10", sources: [] }));
}

test("sources:health leest de afgeleide bron uit haar bestand: nog niet afgeleid, ok of verouderd, nooit als fout", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asign-health-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  statusFile(root);
  const leeg = checkHealth({ rootDir: root, at: Date.parse("2026-10-10T06:00:00Z"), env: {} });
  const leegTekst = leeg.lines.join("\n");
  assert.match(leegTekst, new RegExp(`^${SOURCE_ID}\\tnog niet afgeleid\\twacht op refresh:herkenning$`, "m"));
  assert.doesNotMatch(leegTekst, new RegExp(`^${SOURCE_ID}\\tnog niet opgehaald`, "m"));
  fs.writeFileSync(path.join(root, "site", "sources", `${SOURCE_ID}.json`), JSON.stringify(sourceDocument(SOURCE_ID, { retrievedAt: RETRIEVED, fetchStatus: "ok", items: [item(), item({ id: "asign-ev-et2099000002-2026-10-05", externalId: "ET2099000002", date: "2026-10-05", sameAs: [] })] })));
  const vers = checkHealth({ rootDir: root, at: Date.parse("2026-10-10T06:00:00Z"), env: {} });
  assert.match(vers.lines.join("\n"), new RegExp(`^${SOURCE_ID}\\tok\\tafgeleid na refresh:herkenning\\titems=2\\tupcoming=1\\tretrievedAt=${RETRIEVED}$`, "m"));
  assert.equal(vers.exitCode, 0);
  const oud = checkHealth({ rootDir: root, at: Date.parse("2026-10-13T06:00:00Z"), env: {} });
  assert.match(oud.lines.join("\n"), new RegExp(`^${SOURCE_ID}\\tverouderd\\t`, "m"));
  assert.ok(oud.warnings.some((w) => w.startsWith(`${SOURCE_ID}: niet bijgewerkt sinds`)));
  assert.equal(oud.exitCode, 0, "een verouderde afgeleide bron is een melding, geen fout");
});

test("validate-data: een huisnummer in een agendapunt van de afgeleide bron is een fout, met alleen het pad", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asign-validatie-"));
  try {
    fs.cpSync(path.join(repoRoot, "lib"), path.join(root, "lib"), { recursive: true });
    fs.mkdirSync(path.join(root, "scripts"));
    fs.copyFileSync(path.join(repoRoot, "scripts", "validate-data.mjs"), path.join(root, "scripts", "validate-data.mjs"));
    fs.mkdirSync(path.join(root, "site", "sources"), { recursive: true });
    for (const name of fs.readdirSync(path.join(repoRoot, "site")).filter((entry) => entry.endsWith(".js"))) fs.copyFileSync(path.join(repoRoot, "site", name), path.join(root, "site", name));
    const schrijf = (items) => fs.writeFileSync(path.join(root, "site", "sources", `${SOURCE_ID}.json`), JSON.stringify(sourceDocument(SOURCE_ID, { retrievedAt: RETRIEVED, fetchStatus: "ok", items })));
    const run = () => spawnSync(process.execPath, [path.join(root, "scripts", "validate-data.mjs")], { encoding: "utf8" });
    schrijf([item()]);
    const goed = run();
    assert.equal(goed.stderr.split("\n").filter((l) => l.startsWith(`${SOURCE_ID}.json`)).length, 0, goed.stderr);
    schrijf([item({ location: "Proefstraat 999", straten: ["Proefstraat 999"] })]); // verzonnen straat en huisnummer
    const fout = run();
    const regels = fout.stderr.split("\n").filter((l) => l.startsWith(`${SOURCE_ID}.json`));
    assert.deepEqual(regels, [`${SOURCE_ID}.json: privacy huisnummer op items[0].location`, `${SOURCE_ID}.json: privacy huisnummer op items[0].straten[0]`]);
    assert.equal(fout.status, 1);
    assert.equal(fout.stderr.includes("999"), false, "de melding toont de waarde niet");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("koppeling op de kaart: een dossier koppelt nooit aan een agendapunt dat alleen uit de dossiers komt", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asign-koppel-"));
  try {
    fs.mkdirSync(path.join(root, "site", "sources"), { recursive: true });
    fs.writeFileSync(path.join(root, "site", "sources", `${SOURCE_ID}.json`), JSON.stringify({ items: [item()] }));
    fs.writeFileSync(path.join(root, "site", "sources", "district-kalender.json"), JSON.stringify({ items: [{ id: "district-kal-proef-2026-10-18", title: "Proefcriterium", date: "2026-10-18", location: "Proefstraat" }] }));
    assert.deepEqual(agendaItemsUitBronnen(root).map((i) => i.id), ["district-kal-proef-2026-10-18"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.equal(alleenUitDossiers({ sourceId: SOURCE_ID }), true);
  assert.equal(alleenUitDossiers({ sourceId: SOURCE_ID, sources: [{ sourceId: SOURCE_ID }] }), true);
  assert.equal(alleenUitDossiers({ sourceId: "district-kalender", sources: [{ sourceId: "district-kalender" }, { sourceId: SOURCE_ID }] }), false, "samen met de kalender is er een tweede bron");
  assert.equal(alleenUitDossiers({ sourceId: "district-kalender" }), false);
});
