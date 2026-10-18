// Eenmalige opkuis van de bewaarde, gegenereerde bestanden na de regel "geen homoniemtoevoeging van de straatas"
// (site/witte-lijst.js): "Proefstraat_AN" heet "Proefstraat", en een huisnummer erachter is een huisnummer. De bronnen geven
// de naam voortaan zonder toevoeging (straatasNaam in site/street-core.js, gipodTekst in site/works-core.js, het adres van
// A-Sign in site/adres-privacy.js) en de verversing schrijft ze zo; dit script past dezelfde regels één keer toe op wat al
// bewaard was, zonder iets op te halen:
// - site/sources/kaart-uitleg.json: de straten en teksten van werken en evenementen (kaartUitlegVoorPubliek, zoals de
//   verversing ze schrijft); het tijdstip van de verversing blijft;
// - site/history (live-layers.json en archive/): scripts/opkuis-historiek-privacy.mjs (ook het huisnummer na een straat
//   met toevoeging);
// - site/straat/*.json, site/straat-index.json en site/history/radar.json: opnieuw geschreven uit hun vorige stand
//   (schrijfStraatSnapshots met `herschrijf`); elke laag houdt de stand en het tijdstip van de laatste verversing.
// site/geo/straten.json komt opnieuw uit de straatas met `npm run geo:straten` (netwerk; niet hier).
//
//   node scripts/opkuis-straatnamen.mjs          toont alleen wat er zou veranderen
//   node scripts/opkuis-straatnamen.mjs --write  schrijft de bestanden
//
// Veilig om opnieuw te draaien: een schoon bestand blijft gelijk. De uitvoer noemt alleen bestanden en aantallen.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { kaartUitlegVoorPubliek, serialiseer } from "../lib/kaart-uitleg-refresh.mjs";
import { KAART_UITLEG_FILE, validateKaartUitleg } from "../lib/kaart-uitleg-validatie.mjs";
import { heeftToevoeging } from "../site/witte-lijst.js";
import { opkuisHistoriekPrivacy } from "./opkuis-historiek-privacy.mjs";
import { schrijfStraatSnapshots } from "./build-straat-snapshots.mjs";

// Hoeveel teksten in een document nog een toevoeging dragen.
export function telToevoegingen(waarde) {
  if (typeof waarde === "string") return heeftToevoeging(waarde) ? 1 : 0;
  if (Array.isArray(waarde)) return waarde.reduce((som, v) => som + telToevoegingen(v), 0);
  if (waarde && typeof waarde === "object") return Object.values(waarde).reduce((som, v) => som + telToevoegingen(v), 0);
  return 0;
}

export function opkuisStraatnamen({ rootDir, write = false, log = () => {} } = {}) {
  if (!rootDir) throw new Error("rootDir ontbreekt");
  const rapport = { write, kaartUitleg: null, historiek: null, straten: null };

  const uitlegFile = path.join(rootDir, "site", "sources", KAART_UITLEG_FILE);
  if (fs.existsSync(uitlegFile)) {
    const voor = JSON.parse(fs.readFileSync(uitlegFile, "utf8"));
    const na = kaartUitlegVoorPubliek(voor);
    const fouten = validateKaartUitleg(na);
    const tekst = serialiseer(na);
    const gewijzigd = tekst !== fs.readFileSync(uitlegFile, "utf8");
    rapport.kaartUitleg = { toevoegingenVoor: telToevoegingen(voor), toevoegingenNa: telToevoegingen(na), gewijzigd, fouten: fouten.length };
    if (fouten.length) throw new Error(`kaart-uitleg ongeldig na de opkuis: ${fouten[0]}`);
    if (write && gewijzigd) fs.writeFileSync(uitlegFile, tekst, "utf8");
  }

  const historiek = opkuisHistoriekPrivacy({ rootDir, write });
  rapport.historiek = { gewijzigd: historiek.gewijzigd, nietGeschreven: historiek.nietGeschreven, nogBevindingen: historiek.nogBevindingen };

  // De straatbestanden lezen de kaart-uitleg en de historiek (radar): daarom als laatste.
  if (write) rapport.straten = schrijfStraatSnapshots({ rootDir, herschrijf: true, log });
  return rapport;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const rapport = opkuisStraatnamen({ rootDir, write: process.argv.includes("--write") });
    console.log(JSON.stringify(rapport, null, 2));
    if (Object.keys(rapport.historiek.nietGeschreven).length || Object.keys(rapport.historiek.nogBevindingen).length) process.exitCode = 1;
  } catch (error) {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  }
}
