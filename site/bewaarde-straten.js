// Alleen officiële straten die de bezoeker expliciet bewaart. Geen account, huisnummer of serveropslag.
import { zonderToevoegingInTekst } from "./witte-lijst.js";
export const OPSLAG_SLEUTEL = "publieke-agenda-bewaarde-straten-v1";
export const MAX_BEWAARDE_STRATEN = 12;
const geldigeSleutel = (key) => typeof key === "string" && key.length <= 180 && /^straat:\d+\|[^|]+\|\d{4}$/.test(key);
export function leesBewaardeStraten(opslag) {
  try {
    const lijst = JSON.parse(opslag?.getItem(OPSLAG_SLEUTEL) || "[]");
    // Een sleutel van vóór de straatas zonder homoniemtoevoeging ("straat:1|Proefstraat_AN|2018") is dezelfde straat.
    return Array.isArray(lijst) ? [...new Set(lijst.filter(geldigeSleutel).map(zonderToevoegingInTekst))].slice(0, MAX_BEWAARDE_STRATEN) : [];
  } catch { return []; }
}
export function bewaardeStraten(index, opslag) {
  return leesBewaardeStraten(opslag).map((key) => index?.byKey?.get(key))
    .filter((plek) => plek?.type === "straat" && geldigeSleutel(plek.key));
}
export function isBewaardeStraat(opslag, plek) {
  return plek?.type === "straat" && leesBewaardeStraten(opslag).includes(plek.key);
}
export function wisselBewaardeStraat(index, opslag, plek) {
  if (!opslag || typeof opslag.setItem !== "function")
    return { ok: false, bewaard: false, message: "Dit toestel laat plaatselijke opslag niet toe. De straat is niet bewaard." };
  if (plek?.type !== "straat" || !geldigeSleutel(plek.key) || index?.byKey?.get(plek.key)?.type !== "straat")
    return { ok: false, bewaard: false, message: "Kies eerst een officiële straat om die te bewaren." };
  const eerder = leesBewaardeStraten(opslag);
  const al = eerder.includes(plek.key);
  if (!al && eerder.length >= MAX_BEWAARDE_STRATEN)
    return { ok: false, bewaard: false, message: "Je kunt maximaal 12 straten bewaren. Verwijder eerst een bewaarde straat." };
  const nieuw = al ? eerder.filter((key) => key !== plek.key) : [...eerder, plek.key];
  try {
    opslag.setItem(OPSLAG_SLEUTEL, JSON.stringify(nieuw));
    return { ok: true, bewaard: !al, message: al
      ? "Straat verwijderd uit je bewaarde straten op dit toestel."
      : "Straat bewaard op dit toestel. Geen huisnummer of persoonlijke locatie opgeslagen." };
  } catch {
    return { ok: false, bewaard: al, message: "Opslaan lukte niet. Controleer de privacyinstellingen van je browser." };
  }
}
