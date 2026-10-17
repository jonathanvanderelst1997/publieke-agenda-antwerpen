// Schrijft de werklijst "vragen aan de stad" (lib/vragen-aan-de-stad.mjs) naar docs/VRAGEN_AAN_DE_STAD.md: de
// evenementendossiers zonder naam en de werfzones zonder doel, de dossiers die de meeste straten raken eerst.
// Leest alleen wat al binnen is (site/sources, site/straat); geen netwerk.
//
//   node scripts/vragen-aan-de-stad.mjs [--vandaag 2026-10-12] [--uit docs/VRAGEN_AAN_DE_STAD.md]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { vragenAanDeStad, vragenMarkdown } from "../lib/vragen-aan-de-stad.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lees = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const arg = (naam) => { const i = process.argv.indexOf(naam); return i > 0 ? process.argv[i + 1] : null; };

// De werfzonerijen van alle straten, met de straten als namen (een straatbestand bewaart ze als plaats in `straten`).
export function werfzoneRijen(map = path.join(root, "site", "straat")) {
  const rijen = new Map();
  for (const bestand of fs.existsSync(map) ? fs.readdirSync(map).filter((f) => f.endsWith(".json")).sort() : []) {
    const doc = JSON.parse(fs.readFileSync(path.join(map, bestand), "utf8"));
    const namen = (Array.isArray(doc.straten) ? doc.straten : []).map((s) => (Array.isArray(s) ? s[1] : s?.name));
    const naam = (i) => (Number.isInteger(i) ? namen[i] : i?.name) || "";
    for (const r of Array.isArray(doc.publiekeRuimte) ? doc.publiekeRuimte : []) {
      if (r?.kind !== "sgw") continue;
      const vorige = rijen.get(r.id);
      const straten = (lijst) => (Array.isArray(lijst) ? lijst : []).map((i) => ({ name: naam(i) })).filter((s) => s.name);
      const rij = { reference: r.reference, start: r.start, end: r.end, werfzoneStreets: straten(r.werfzoneStreets), omleidingStreets: straten(r.omleidingStreets) };
      if (vorige) { vorige.werfzoneStreets.push(...rij.werfzoneStreets); vorige.omleidingStreets.push(...rij.omleidingStreets); } else rijen.set(r.id, rij);
    }
  }
  return [...rijen.values()];
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const vandaag = arg("--vandaag") || new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(new Date());
  const uitleg = lees("site/sources/kaart-uitleg.json");
  const vragen = vragenAanDeStad({
    evenementen: uitleg.evenementen, werken: uitleg.werken, rijen: werfzoneRijen(),
    hand: lees("site/sources/evenement-identiteit.json"), auto: lees("site/sources/evenement-identiteit-auto.json"), vandaag,
  });
  const uit = path.join(root, arg("--uit") || "docs/VRAGEN_AAN_DE_STAD.md");
  fs.writeFileSync(uit, vragenMarkdown(vragen, { vandaag }), "utf8");
  console.log(JSON.stringify({ vragen: vragen.length, evenementen: vragen.filter((v) => v.soort === "evenement").length, werfzones: vragen.filter((v) => v.soort === "werfzone").length, bestand: path.relative(root, uit) }));
}
