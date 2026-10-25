// Vóór een push: staat er in een commit die nog niet gepusht is een echte straat met een bestaand huisnummer, in de
// boodschap of in de toegevoegde regels (lib/echte-adressen.mjs)? Een gepushte commit staat publiek in de PR en in de
// geschiedenis; een lokale nog niet. Daarnaast de eindboom: de netto diff basis...tot, zonder uitzonderingen (wat de PR
// aan het eind toevoegt, telt altijd). Het script toont alleen plaatsen en aantallen, nooit de waarde.
//
//   node scripts/adressen-in-commits.mjs --basis origin/<tak> [--tot HEAD] [--straten site/geo/straten.json]
//                                        [--zonder-data] [--uitzonderingen lib/adressen-uitzonderingen.json]
//
// Vindt het iets in een lokale commit, push die commit dan niet. Zonder rebase, amend of force: zet één nieuwe commit
// met de eindboom bovenop de gepushte tip, op een nieuwe lokale tak (git commit-tree <tot>^{tree} -p <basis>), en kijk
// die opnieuw na met dit script. Die push is een gewone fast-forward. Exitcode 1 bij een bevinding, 2 bij een fout.
//
// In CI (ci.yml, job check, bij elke PR): --basis de basiscommit en --tot de kop van de PR, met --zonder-data (de
// gegenereerde data uit publieke bronnen, de padlijst van de databaan, telt niet) en --uitzonderingen (een commit die
// al gepusht is en zonder force niet meer weg kan, op precies die plaats en met een reden). Zo houdt de scan een PR met
// een nieuw echt adres tegen, zonder vals alarm op wat al publiek staat. Een uitzondering geldt alleen voor die commit:
// staat het adres er aan de kop van de PR nog (ook verschoven, zonder "+"-regel in een latere commit), dan houdt de
// netto diff de PR tegen (nakijkronde van 18 oktober 2026).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { adressenAanDeKop, adressenInCommits, echteAdresStukken, geldigeUitzonderingen, laadDataPaden, laadStraatnamen, metUitzonderingen, standaardStratenBestand } from "../lib/echte-adressen.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const UITZONDERINGEN_BESTAND = path.join("lib", "adressen-uitzonderingen.json");

function opties(argv) {
  const uit = { tot: "HEAD", straten: standaardStratenBestand(root), zonderData: false, uitzonderingen: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--zonder-data") {
      uit.zonderData = true;
      continue;
    }
    const [naam, waarde] = [argv[i], argv[i + 1]];
    if (!["--basis", "--tot", "--straten", "--uitzonderingen"].includes(naam) || waarde === undefined) throw new Error(`onbekende of lege optie: ${naam}`);
    uit[naam.slice(2)] = waarde;
    i += 1;
  }
  if (!uit.basis) throw new Error("--basis ontbreekt (bv. origin/<tak>)");
  return uit;
}

// De uitzonderingen uit een bestand, nagekeken: de vorm, en geen echt adres in een reden.
function leesUitzonderingen(bestand, namen) {
  const { lijst, fouten } = geldigeUitzonderingen(JSON.parse(fs.readFileSync(bestand, "utf8")));
  lijst.forEach((u, i) => { if (echteAdresStukken(u.reden, namen).length) fouten.push(`uitzondering ${i + 1}: de reden noemt een echt adres`); });
  if (fouten.length) throw new Error(`${path.basename(bestand)}: ${fouten.join("; ")}`);
  return lijst;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { basis, tot, straten, zonderData, uitzonderingen: uitzBestand } = opties(process.argv.slice(2));
    const namen = laadStraatnamen(path.resolve(straten));
    const uitzonderingen = uitzBestand ? leesUitzonderingen(path.resolve(uitzBestand), namen) : [];
    const overslaan = zonderData ? laadDataPaden(path.join(root, "lib", "data-lane-paths.json")) : [];
    const { commits, bevindingen } = adressenInCommits({ basis, tot, namen, overslaan });
    const { over, uitgezonderd } = metUitzonderingen(bevindingen, uitzonderingen);
    const kop = adressenAanDeKop({ basis, tot, namen, overslaan }).bevindingen;
    const plaats = (b) => (b.waar === "boodschap" ? "commitboodschap" : `${b.waar}:${b.regels.join(",")}`);
    for (const b of over) console.log(`${b.commit} ${plaats(b)}: ${b.aantal}× echte straat met een bestaand huisnummer`);
    for (const b of uitgezonderd) console.log(`${b.commit} ${plaats(b)}: ${b.aantal}× uitgezonderd (al gepusht; de reden staat in ${path.basename(uitzBestand)})`);
    for (const b of kop) console.log(`aan de kop ${plaats(b)}: ${b.aantal}× echte straat met een bestaand huisnummer, nog in de eindboom`);
    console.log(`${commits} commit(s) in ${basis}..${tot} nagekeken${zonderData ? " (zonder de gegenereerde data)" : ""}, ${over.length} plaats(en) met een echt adres${uitgezonderd.length ? `, ${uitgezonderd.length} uitgezonderd` : ""}.`);
    console.log(`Aan de kop (netto diff ${basis}...${tot}${zonderData ? ", zonder de gegenereerde data" : ""}): ${kop.length} plaats(en) met een echt adres; een uitzondering geldt hier niet.`);
    if (over.length && process.env.GITHUB_ACTIONS === "true") console.log(`::error title=Echt adres in een commit::${over.length} plaats(en) met een echte straat en een bestaand huisnummer; zie de regels hierboven (alleen plaatsen, nooit de waarde).`);
    if (kop.length && process.env.GITHUB_ACTIONS === "true") console.log(`::error title=Echt adres aan de kop::${kop.length} plaats(en) in de eindboom van de PR met een echte straat en een bestaand huisnummer; een uitzondering geldt daar niet (alleen plaatsen, nooit de waarde).`);
    process.exitCode = over.length || kop.length ? 1 : 0;
  } catch (error) {
    // Alleen de eerste regel: een git-fout kan een stuk van een diff bevatten.
    console.error(`adressen-in-commits: ${String(error?.message || error).split("\n")[0]}`);
    process.exitCode = 2;
  }
}
