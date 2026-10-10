// Officiële straatnaam en postcode voor een naam uit een stadslaag ("DAGERAADPLAATS",
// "Jan Vanhoenackersstraat"). Bron: site/geo/straten.json (straatas van district Antwerpen, gebouwd
// door scripts/build-straten.mjs). Puur na het laden; wie geen index heeft, krijgt de naam terug zoals
// hij binnenkwam (netjes in hoofdletters) en geen postcode.
import fs from "node:fs";
import path from "node:path";

export const STRATEN_FILE = path.join("site", "geo", "straten.json");

export function straatSleutel(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

// Index { sleutel: { naam, postcodes[] } } uit de rijen [id, naam, postcode, wijken, kader].
export function buildStraatIndex(document) {
  const index = new Map();
  for (const row of Array.isArray(document?.streets) ? document.streets : []) {
    const naam = typeof row?.[1] === "string" ? row[1].trim() : "";
    const postcode = /^\d{4}$/.test(String(row?.[2] ?? "")) ? String(row[2]) : null;
    if (!naam) continue;
    const key = straatSleutel(naam);
    const entry = index.get(key) ?? { naam, postcodes: [] };
    if (postcode && !entry.postcodes.includes(postcode)) entry.postcodes.push(postcode);
    entry.postcodes.sort();
    index.set(key, entry);
  }
  return index;
}

export function loadStraatIndex(rootDir) {
  try {
    return buildStraatIndex(JSON.parse(fs.readFileSync(path.join(rootDir, STRATEN_FILE), "utf8")));
  } catch {
    return new Map();
  }
}

// "FREDERIK VAN EEDENPLEIN" -> "Frederik van Eedenplein": tussenvoegsels klein, behalve vooraan.
const PARTICLES = new Set(["van", "de", "der", "den", "het", "ter", "te", "en"]);
export function netteNaam(value) {
  const words = String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase().split(" ").filter(Boolean);
  return words
    .map((word, index) => (index > 0 && PARTICLES.has(word) ? word : word.replace(/(^|[-'’])(\p{L})/gu, (whole, sep, letter) => sep + letter.toUpperCase())))
    .join(" ");
}

// Geeft { naam, postcodes, gevonden }. Een kleine tikfout van de bron ("…ackersstraat" voor
// "…ackerstraat") wordt nog herkend; verder niets raden.
export function zoekStraat(value, index) {
  const raw = String(value ?? "").trim();
  const key = straatSleutel(raw);
  const hit = index?.get?.(key) ?? index?.get?.(key.replace(/sstraat$/, "straat"));
  if (hit) return { naam: hit.naam, postcodes: [...hit.postcodes], gevonden: true };
  return { naam: netteNaam(raw), postcodes: [], gevonden: false };
}

export function locatieMetPostcode(naam, postcodes) {
  return postcodes.length === 1 ? `${naam}, ${postcodes[0]} Antwerpen` : `${naam}, Antwerpen`;
}
