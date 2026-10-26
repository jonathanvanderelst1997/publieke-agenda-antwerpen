// Fuzz van de vaste vorm (site/werk-vorm.js, regel 39): alle combinaties van schrijfwijzen van de straat en het huisnummer,
// met een staart (een naam, contactgegevens of een spoor van een verhuizing) in de titel, een fase of de opdrachtgever.
// - Een adreskaart: op geen enkele uitgang een woord uit de staart, een "@" of een spoor.
// - Een gewone kaart: op de kaart, in de lijst en in kaart-uitleg.json het huisnummer (regel van de eigenaar van 26 oktober
//   2026), maar nergens een huisnummer bij het spoor van een verhuizing; in de historiek en de straatbestanden (die bewaren
//   nog geen huisnummer) nergens één los huisnummer; nergens een spoor.
// Alleen verzonnen straten (Proefstraat, Testlaan) en verzonnen namen; geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";

import { VERHUIS_SPOOR, lijstTitel, werkenVoorDeSite } from "../site/werk-vorm.js";
import { werkKaartje } from "../site/kaart-uitleg.js";
import { ownerGroup } from "../site/works-core.js";
import { workEntry } from "../site/place-core.js";
import { itemVoorHistoriek } from "../lib/historiek-privacy.mjs";
import { compactWorkItem } from "../lib/live-history.mjs";
import { bouwKaartUitleg, kaartUitlegVoorPubliek } from "../lib/kaart-uitleg-refresh.mjs";
import { itemVoorStraat } from "../scripts/build-straat-snapshots.mjs";

const VANDAAG = "2099-03-10";
const PROEF = { id: "9101", name: "Proefstraat", postcode: "2000" };
const STRAATVORMEN = ["Proefstraat {n}", "PROEFSTRAAT {n}", "Proefstr. {n}", "2000 Antwerpen, Proefstraat {n}", "Proefstraat | {n}", "Proefstraat: {n}", "Proefstraat, {n}", "Testlaan 5 - Proefstraat {n}", "Korte Proefstraat {n}", "Anna-Proefstraat {n}"];
// Een andere straat met de naam van het punt erin: nooit een nummer (liever geen nummer dan een fout huis).
const ANDERE_STRAAT = /Korte Proefstraat|Anna-Proefstraat/;
const NUMMERVORMEN = ["12", "12A", "31/2", "12-12", "12 tem 14", "12 en 14", "1DN02", "nr 12", "thv 12"];
// Een staart en de woorden die er nergens van mogen terugkomen op een adreskaart (verzonnen).
const STAARTEN = [
  ["Proefmans", ["Proefmans"]], ["Fam. Testers", ["Fam.", "Testers"]], ["Mw. Voorbeeldig", ["Mw.", "Voorbeeldig"]],
  ["proef@voorbeeld.test", ["@", "voorbeeld"]], ["0470 12 34 56", ["0470"]],
  ["Vеrhuis", []], ["Ver­huis", []], ["ver huis", []], ["VERHUIZING", []], ["uithuizing", []], ["ladderlift", []],
];
const PLAATSEN = ["title", "fase", "owner"];

const teksten = (waarde, uit = []) => {
  if (typeof waarde === "string") uit.push(waarde);
  else if (Array.isArray(waarde)) for (const v of waarde) teksten(v, uit);
  else if (waarde && typeof waarde === "object") for (const v of Object.values(waarde)) teksten(v, uit);
  return uit;
};
// Eén los huisnummer na de straat (in elke schrijfwijze), los van de lezer van de site: een nummer dat niet het begin is van
// een reeks naar een ander nummer. "1DN02" is een code, geen nummer.
const LOS = /(?:proefstraat|proefstr\.?)[\s|:,.-]{0,4}(?:(?:nrs?\.?|thv|ter hoogte van)\s*)?(\d{1,3})[a-z]?(?![\p{L}\d])(\s*(?:\/\s*\d+|-|–|tem|t\/m|tot en met|en|,)\s*(\d{1,3}))?/giu;
const losNummer = (t) => [...t.matchAll(LOS)].some((m) => !(m[2] && !/^\s*\//.test(m[2]) && m[3] && Number(m[3]) !== Number(m[1])));

function werken() {
  const uit = [];
  let id = 991000;
  for (const straat of STRAATVORMEN) for (const nummer of NUMMERVORMEN) for (const [staart, woorden] of STAARTEN) for (const adresIn of ["title", "fase"]) for (const plaats of PLAATSEN) {
    const adres = straat.replace("{n}", nummer);
    const tekst = { title: adresIn === "title" ? adres : "Werk in openbaar domein", fase: adresIn === "fase" ? `Fase 1 ${adres}` : "Fase 1", owner: "Fluvius System Operator" };
    tekst[plaats] = `${tekst[plaats] === "Werk in openbaar domein" ? "" : `${tekst[plaats]} `}${staart}`.trim();
    id += 1;
    uit.push({
      werk: {
        gipodId: id, title: tekst.title, owner: tekst.owner, ownerGroup: ownerGroup(tekst.owner), status: "In uitvoering",
        start: "2099-03-01T06:00:00Z", end: "2099-03-30T16:00:00Z", workTypes: ["klantaansluiting"], occupancyTypes: ["Elektriciteit"], lastModified: "2099-02-01T00:00:00Z",
        point: [4.4, 51.22], recordCount: 1, boundaryConfidence: "point_inside_new", hindranceSourceLoaded: true,
        hindrance: { severe: false, consequences: ["Parkeerverbod"], start: "2099-03-12T06:00:00Z", end: "2099-03-12T16:00:00Z", phases: [{ description: tekst.fase, start: "2099-03-12T06:00:00Z", end: "2099-03-12T16:00:00Z", consequences: ["Parkeerverbod"] }] },
        streets: [PROEF], streetResolution: "nearest_official_axis", streetDistanceMeters: 3,
      },
      woorden, wat: `${adres} | ${staart} in ${plaats}`,
    });
  }
  return uit;
}

test("de controle van de fuzz ziet een los huisnummer, en geen reeks of code", () => {
  for (const t of ["Proefstraat 12", "PROEFSTRAAT 12A", "Proefstraat, nr. 12", "Proefstraat | 31/2", "Proefstraat 12-12", "Proefstr. thv 12"]) assert.equal(losNummer(t), true, t);
  for (const t of ["Proefstraat 12 tem 14", "Proefstraat, nr. 12–14", "Proefstraat 12 en 14", "Proefstraat 1DN02", "Proefstraat (huisnummer weggelaten)", "Testlaan 5"]) assert.equal(losNummer(t), false, t);
});

test("fuzz: een adreskaart heeft nergens de staart, een gewone kaart toont het nummer behalve bij een verhuizing, en nergens een spoor", async () => {
  const gevallen = werken();
  const ids = gevallen.map((g) => g.werk.gipodId);
  const vormen = { adreskaart: { vorm: { adreskaart: ids, gewoon: [] } }, gewoon: { vorm: { adreskaart: [], gewoon: ids } }, nieuw: { vorm: null } };
  let a = 0, b = 0, metNummer = 0, gewoonMetNummer = 0, verhuisZonder = 0;
  for (const [naam, { vorm }] of Object.entries(vormen)) {
    const items = werkenVoorDeSite(gevallen.map((g) => g.werk), vorm);
    const { document } = await bouwKaartUitleg({ works: items, fetch: null, clock: () => new Date(`${VANDAAG}T05:00:00Z`) });
    const uitleg = kaartUitlegVoorPubliek(document);
    items.forEach((item, i) => {
      const { woorden, wat } = gevallen[i];
      const k = werkKaartje(item, { vandaag: VANDAAG });
      const e = workEntry(item, { vandaag: VANDAAG, uitleg });
      const uitgangen = {
        kaart: [k.titel, k.samenvatting, k.bronTekst || "", ...k.regels.flat()],
        "kaart met de verversing": [e.title, e.summary, e.uitleg.bronTekst || "", ...e.uitleg.regels.flat()],
        lijstTitel: [lijstTitel(item)],
        historiek: teksten(compactWorkItem(itemVoorHistoriek(item))),
        straatitem: teksten(itemVoorStraat(item, { laag: "werken" })),
        "kaart-uitleg.json": teksten(uitleg.werken[String(item.gipodId)]),
      };
      for (const [uitgang, lijst] of Object.entries(uitgangen)) {
        const alles = lijst.join(" · ");
        assert.equal(lijst.some((t) => VERHUIS_SPOOR.test(t)), false, `${naam}: spoor op ${uitgang} bij ${wat}`);
        if (item.adresKaart) for (const woord of woorden) assert.equal(alles.toLowerCase().includes(woord.toLowerCase()), false, `${naam}: "${woord}" op ${uitgang} van een adreskaart bij ${wat}`);
        else if (item.eenAdres === true || uitgang === "historiek" || uitgang === "straatitem") assert.equal(losNummer(alles), false, `${naam}: los huisnummer op ${uitgang} van een gewone kaart bij ${wat}: ${alles.slice(0, 300)}`);
      }
      if (!item.adresKaart && item.eenAdres === true) verhuisZonder += 1;
      if (!item.adresKaart && /^Proefstraat, nr\. 12\b/.test(Object.fromEntries(k.regels).Waar || "")) gewoonMetNummer += 1;
      if (item.adresKaart && ANDERE_STRAAT.test(wat)) assert.equal(item.huisnummers, "", `${naam}: een nummer bij een andere straat: ${wat}`);
      if (item.adresKaart) { a += 1; if (item.huisnummers) metNummer += 1; } else b += 1;
    });
  }
  // Beide vormen komen in de fuzz voor (ook bij een werk dat de verversing of de browser zelf beslist), en een gewone kaart
  // toont het nummer (behalve bij het spoor van een verhuizing).
  assert.ok(a > 1000 && b > 1000 && metNummer > 500, `${a} adreskaarten (${metNummer} met een nummer) en ${b} gewone kaarten`);
  assert.ok(gewoonMetNummer > 300 && verhuisZonder > 300, `${gewoonMetNummer} gewone kaarten met nr. 12, ${verhuisZonder} met het spoor van een verhuizing`);
});
