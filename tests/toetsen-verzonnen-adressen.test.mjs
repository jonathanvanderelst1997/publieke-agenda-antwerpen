// De toetsen gebruiken alleen verzonnen adressen (nakijkronde van head 1ed84e65: een toetscommentaar noemde een echte straat
// met huisnummer bij een echt GIPOD-dossier). Deze toets zoekt in tests/ een echte straat (uit de straatas van de repo,
// site/geo/straten.json) met een huisnummer op een regel met een GIPOD-nummer (zeven tot negen cijfers) of het woord GIPOD:
// zo'n regel zou een echt dossier aan een echt adres koppelen. Geen netwerk.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("geen echte straat met huisnummer op een regel met een GIPOD-nummer in de toetsen", () => {
  const fold = (v) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const namen = [...new Set(JSON.parse(fs.readFileSync(path.join(root, "site", "geo", "straten.json"), "utf8")).streets.map((r) => fold(r[1])).filter((n) => n.length > 4))];
  const straatNummer = new RegExp(`(?<!\\p{L})(?:${namen.map(esc).sort((a, b) => b.length - a.length).join("|")})(?!\\p{L})\\s*[,|:-]?\\s*(?:nr\\.?\\s*)?\\d{1,3}(?!\\d)`, "u");
  const gipodNummer = /(?<![\p{L}\d])\d{7,9}(?![\p{L}\d])|gipod/iu;
  const fout = [];
  for (const f of fs.readdirSync(path.join(root, "tests"), { recursive: true }).filter((x) => /\.m?js$/.test(x))) {
    fs.readFileSync(path.join(root, "tests", f), "utf8").split("\n").forEach((regel, i) => {
      if (gipodNummer.test(regel) && straatNummer.test(fold(regel))) fout.push(`tests/${f}:${i + 1}`);
    });
  }
  assert.deepEqual(fout, []);
});
