// De overgang naar de vaste vorm per werk (site/werk-vorm.js): elk werk-id dat main ooit publiceerde, wordt een gewone kaart
// in site/sources/werk-vorm.json. Zo komt er bij de overgang geen enkel huisnummer bij: een werk dat main al toonde, blijft
// zoals main het toonde. Alleen een nieuw werk kan een adreskaart worden (de verversing beslist, regel 14).
//
// Bron: alle versies in de git-geschiedenis van origin/main (of --basis <ref>) van kaart-uitleg.json (de werken),
// site/history/live-layers.json en site/history/archive/*.json (items en wijzigingen) en site/straat/*.json. Geen netwerk.
// De unie met wat er al staat: een id dat al in een lijst staat, blijft daar. Veilig om opnieuw te draaien; draai het na
// elke merge van origin/main en als laatste stap vóór ready.
//
//   node scripts/maak-werk-vorm.mjs --overgang [--basis origin/main]
//
// De uitvoer noemt alleen aantallen.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { werkVormDocument } from "../site/werk-vorm.js";
import { leesWerkVorm, schrijfWerkVorm, werkIdsInKaartUitleg, werkIdsInTekst } from "../lib/werk-vorm-bestand.mjs";

export const GEPUBLICEERD = Object.freeze(["site/sources/kaart-uitleg.json", "site/history/live-layers.json", "site/history/archive", "site/straat"]);
const git = (rootDir, args, input) => {
  const r = spawnSync("git", args, { cwd: rootDir, input, maxBuffer: 2 * 1024 ** 3 });
  if (r.status !== 0) throw new Error(`git ${args[0]} mislukt`);
  return r.stdout;
};
const isJson = (pad) => /^site\/(?:sources\/kaart-uitleg\.json|history\/live-layers\.json|history\/archive\/[^/]+\.json|straat\/\d+\.json)$/.test(pad);

// De blobs van elke versie van de gepubliceerde bestanden op `basis`, met hun pad.
export function blobsInGeschiedenis(rootDir, basis = "origin/main") {
  const blobs = new Map();
  const raw = git(rootDir, ["log", "--raw", "--no-abbrev", "--root", "--format=", basis, "--", ...GEPUBLICEERD]).toString("utf8");
  for (const regel of raw.split("\n")) {
    const m = regel.match(/^:\d+ \d+ [0-9a-f]+ ([0-9a-f]+) [A-Z]\d*\t(?:[^\t]+\t)?([^\t]+)$/);
    if (m && !/^0+$/.test(m[1]) && isJson(m[2])) blobs.set(m[1], m[2]);
  }
  const tip = git(rootDir, ["ls-tree", "-r", basis, "--", ...GEPUBLICEERD]).toString("utf8");
  for (const regel of tip.split("\n")) {
    const m = regel.match(/^\d+ blob ([0-9a-f]+)\t(.+)$/);
    if (m && isJson(m[2])) blobs.set(m[1], m[2]);
  }
  return blobs;
}
// Een ondiepe kloon waarvan de grens al gepubliceerde bestanden draagt, kent niet elke versie: dan stoppen.
function grensVolledig(rootDir) {
  if (git(rootDir, ["rev-parse", "--is-shallow-repository"]).toString("utf8").trim() !== "true") return true;
  const shallow = path.resolve(rootDir, git(rootDir, ["rev-parse", "--git-path", "shallow"]).toString("utf8").trim());
  const grens = fs.existsSync(shallow) ? fs.readFileSync(shallow, "utf8").split("\n").filter(Boolean) : [];
  return grens.every((c) => !git(rootDir, ["ls-tree", "-r", "--name-only", c, "--", ...GEPUBLICEERD]).toString("utf8").trim());
}

export function werkIdsInGeschiedenis(rootDir, basis = "origin/main") {
  const blobs = blobsInGeschiedenis(rootDir, basis);
  const ids = new Set();
  if (!blobs.size) return ids;
  const uit = git(rootDir, ["cat-file", "--batch"], `${[...blobs.keys()].join("\n")}\n`);
  let i = 0;
  while (i < uit.length) {
    const eol = uit.indexOf(10, i);
    const kop = uit.subarray(i, eol).toString("utf8").split(" ");
    if (kop[1] !== "blob") { i = eol + 1; continue; }
    const grootte = Number(kop[2]);
    const tekst = uit.subarray(eol + 1, eol + 1 + grootte).toString("utf8");
    if (blobs.get(kop[0]) === "site/sources/kaart-uitleg.json") werkIdsInKaartUitleg(tekst, ids);
    else werkIdsInTekst(tekst, ids);
    i = eol + 1 + grootte + 1;
  }
  return ids;
}

export function maakWerkVorm({ rootDir, basis = "origin/main" } = {}) {
  if (!grensVolledig(rootDir)) throw new Error("ondiepe kloon zonder de eerste versies van de gepubliceerde bestanden: eerst git fetch --unshallow origin");
  const vorig = leesWerkVorm(rootDir);
  const adreskaart = new Set(vorig.adreskaart), gewoon = new Set(vorig.gewoon);
  const ids = werkIdsInGeschiedenis(rootDir, basis);
  let nieuw = 0;
  for (const id of ids) if (!adreskaart.has(id) && !gewoon.has(id)) { gewoon.add(id); nieuw += 1; }
  const doc = werkVormDocument({ adreskaart, gewoon });
  schrijfWerkVorm(rootDir, doc);
  return { gepubliceerd: ids.size, nieuwGewoon: nieuw, adreskaart: doc.adreskaart.length, gewoon: doc.gewoon.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const args = process.argv.slice(2);
  if (!args.includes("--overgang")) {
    console.error("gebruik: node scripts/maak-werk-vorm.mjs --overgang [--basis origin/main]");
    process.exitCode = 1;
  } else {
    try {
      const i = args.indexOf("--basis");
      console.log(JSON.stringify(maakWerkVorm({ rootDir, basis: i >= 0 && args[i + 1] ? args[i + 1] : "origin/main" })));
    } catch (error) {
      console.error(error?.message || String(error));
      process.exitCode = 1;
    }
  }
}
