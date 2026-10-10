// Verzonnen items voor de straatbestanden (P5): tests/straat-snapshots.test.mjs en tests/e2e/snelheid.e2e.mjs.
// De straten waaraan de items hangen, zijn echte straten van het district (site/geo/straten.json); de
// werken, parkeerverboden, vergunningen, terrassen en namen zijn verzonnen, en een adres met huisnummer
// staat altijd op de verzonnen Proefstraat. Alles in maart 2099, zodat de toets nooit door de echte
// datum verloopt.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { schrijfStraatSnapshots } from "../../scripts/build-straat-snapshots.mjs";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// 05:22 in Brussel (CET), het uur van de ochtendverversing in de PR-tekst.
export const VERVERST = "2099-03-10T04:22:00.000Z";
export const NU = new Date("2099-03-10T09:00:00.000Z");
export const KAM = { id: "1416", name: "Kammenstraat", postcode: "2000" };
export const PET = { id: "2289", name: "Peterseliestraat", postcode: "2000" };
export const HUIK = { id: "1236", name: "Huikstraat", postcode: "2000" };
const KAM_BOX = [4.40025, 51.21571, 4.40208, 51.21878];
const midden = [(KAM_BOX[0] + KAM_BOX[2]) / 2, (KAM_BOX[1] + KAM_BOX[3]) / 2];

export const WERK_TITEL = "Proefwerk riolering (snel)";
export const werk = (gipodId = 990001, extra = {}) => ({
  gipodId, title: `2000 Antwerpen, Proefstraat 12 - ${WERK_TITEL}`, owner: "water-link", ownerGroup: "water-link", status: "Concreet gepland",
  start: "2099-03-19T06:00:00Z", end: "2099-04-09T16:00:00Z", workTypes: [], occupancyTypes: ["Riolering"],
  sourceUrls: [`https://gipod.api.vlaanderen.be/api/v1/groundworks/${gipodId}`], lastModified: "2099-03-01T00:00:00Z",
  point: midden, recordCount: 1, boundaryConfidence: "point_inside_new", hindrance: null, hindranceSourceLoaded: true,
  streets: [KAM], streetResolution: "nearest_official_axis", streetDistanceMeters: 3, creator: "Proef Persoon", ...extra,
});
export const parkeerverbod = (n = 1) => ({
  id: `parking:PROEF-${n}|L${n}`, kind: "parking", kindLabel: "Parkeerverbod", title: "Verhuis", reason: "Verhuis",
  location: "Proefstraat 12-14, 2000 Antwerpen", start: "2099-03-12T00:00:00.000Z", end: "2099-03-12T00:00:00.000Z",
  status: "Goedgekeurd", reference: `PROEF-${n}`, detail: "", startTime: "07:00", endTime: "17:00", weekdaysOnly: false, postcode: "2000",
  sourceLabel: "A-Sign parkeerverboden", sourceUrl: "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/20",
  streets: [KAM], streetResolution: "official_address_match", streetDistanceMeters: 0,
  vorm: { vlakken: [], lijnen: [[[midden[0], midden[1]], [midden[0] + 0.0001, midden[1]]]] },
});
const inname = {
  id: "iod:PROEF-IOD|CONSTRUCTION|i1", kind: "iod", kindLabel: "Inname openbaar domein", title: "Container", location: "",
  start: "2099-03-11T00:00:00.000Z", end: "2099-03-13T00:00:00.000Z", status: "toelating_gegenereerd", reference: "PROEF-IOD",
  detail: "Fase Werken", phase: "Werken", dossierType: "", innameType: "Container", hindrance: "",
  description: "Container voor Jan Voorbeeld, gsm 0470 12 34 56", sourceLabel: "A-Sign IOD",
  sourceUrl: "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/22", streets: [KAM],
  streetResolution: "geometry_official_axis", streetDistanceMeters: 2,
};
const evenementRij = (i, streets) => ({
  id: `iod:ET2099000001|EVENT|e${i}`, kind: "iod", kindLabel: "Inname openbaar domein", title: "Parcours", location: "",
  start: "2099-03-14T00:00:00.000Z", end: "2099-03-14T00:00:00.000Z", status: "toelating_gegenereerd", reference: "ET2099000001",
  detail: "Fase Evenement", phase: "Evenement", dossierType: "ETL", innameType: "Parcours", hindrance: "True",
  sourceLabel: "A-Sign IOD", sourceUrl: "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/22",
  streets, streetResolution: "geometry_official_axis", streetDistanceMeters: 1,
});
export const VERGUNNING_TITEL_DOSSIER = "20990001";
const vergunning = {
  id: "permit:20990001", dossier: "20990001", project: "OMV_2099000001", dossierType: "OMV2019_AANVRAAG", purpose: "Verbouwing of uitbreiding",
  inhoud: { titel: "Dakterras", labels: ["Dakterras"], wat: "", herkend: true, leeg: false, groep: "Verbouwing of uitbreiding", project: "" },
  decisionDateLabel: "", decision: "", decisionDate: "", complete: "ja", admissible: "ja", authority: "College van burgemeester en schepenen",
  decisionAuthority: "", streets: [KAM], streetResolution: "geometry_official_axis", streetDistanceMeters: 4,
  sourceLabel: "Stad Antwerpen · omgevingsvergunningen in behandeling", sourceUrl: "https://geodata.antwerpen.be/x", aanvrager: "Jan Voorbeeld",
  vorm: { vlakken: [[[[midden[0], midden[1]], [midden[0] + 0.0001, midden[1]], [midden[0], midden[1] + 0.0001], [midden[0], midden[1]]]]], lijnen: [] },
};
const terras = (n, adres) => ({
  id: `terrace:PROEF-T${n}`, recordId: `PROEF-T${n}`, terraceType: "Terraszone binnen kern", status: "actief", address: adres, postcode: "2000",
  sourceUrl: "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/49", streets: [KAM], streetResolution: "official_address_match", streetDistanceMeters: 0,
});
// Een item met een e-mailadres in de titel: dat mag nooit in een straatbestand.
const metMail = { ...parkeerverbod(9), id: "parking:PROEF-9|L9", reference: "PROEF-9", title: "Info: proef@voorbeeld.be", reason: "Info: proef@voorbeeld.be" };

export function bronnen({ werken = [werk()], extraRuimte = [] } = {}) {
  return {
    schemaVersion: 1,
    ververst: VERVERST,
    lagen: {
      werken: { ok: true, items: werken },
      publiekeRuimte: { ok: true, items: [parkeerverbod(1), inname, evenementRij(1, [KAM, PET]), metMail, ...extraRuimte] },
      vergunningen: { ok: true, items: [vergunning] },
      terrassen: { ok: true, items: [terras(1, "Proefstraat 5"), terras(2, "Proefstraat 5"), terras(3, "Proefstraat 9")] },
    },
  };
}
// De bronnen gaan in de echte verversing eerst door de privacy-opkuis (verzamelStraatBronnen); hier ook.
export async function schoneBronnen(opties) {
  const { itemVoorStraat, terrassenVoorStraat, kaderVanItem } = await import("../../scripts/build-straat-snapshots.mjs");
  const b = bronnen(opties);
  for (const naam of ["werken", "publiekeRuimte", "vergunningen"]) {
    b.lagen[naam].items = b.lagen[naam].items.map((item) => { const s = itemVoorStraat(item, { laag: naam }); const k = kaderVanItem(item); return s && k ? { ...s, __kader: k } : s; }).filter(Boolean);
  }
  b.lagen.terrassen.items = terrassenVoorStraat(b.lagen.terrassen.items);
  return b;
}
export const agendaItems = [
  { id: "proef-buurtfeest-2099-03-15", title: "Buurtfeest (proef)", date: "2099-03-15", location: "Kammenstraat, 2000 Antwerpen", theme: "Activiteit", timeText: "14.00 uur" },
  { id: "proef-voorbij-2099-03-01", title: "Al voorbij (proef)", date: "2099-03-01", location: "Kammenstraat, 2000 Antwerpen", theme: "Activiteit" },
];
export const kaartUitleg = { schemaVersion: 1, generatedAt: VERVERST, vanaf: "2099-03-10", tot: "2099-05-09", werken: {}, evenementen: { ET2099000001: { start: "2099-03-14", eind: "2099-03-14", soort: "", soortBron: "", beschrijvingen: [], straten: ["Kammenstraat", "Peterseliestraat", "Huikstraat"], kruist: [], stratenTekst: "", gekoppeld: null, kaart: [] } } };

// Een werkmap met wat de bouwer leest: de echte stratenlijst en een verzonnen kaart-uitleg.
export function maakWerkmap(root) {
  fs.mkdirSync(path.join(root, "site", "geo"), { recursive: true });
  fs.mkdirSync(path.join(root, "site", "sources"), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, "site", "geo", "straten.json"), path.join(root, "site", "geo", "straten.json"));
  fs.writeFileSync(path.join(root, "site", "sources", "kaart-uitleg.json"), JSON.stringify(kaartUitleg));
}

export async function bouw(root, { bronnenDoc = undefined, history = null, nu = NU } = {}) {
  const b = bronnenDoc === undefined ? await schoneBronnen() : bronnenDoc;
  return schrijfStraatSnapshots({ rootDir: root, bronnen: b, agendaItems, history, clock: () => nu });
}
