// Plek en uur uit de tekst van een artikel (vaagheidsplan van 12 oktober 2026, stap 7: verrijken met wat al binnen
// is). Een districtsartikel of een nieuwsbrief zonder vaste plek krijgt bij het ophalen "District X, locatie via de
// officiële bron" en uur "Info", terwijl de tekst van het artikel zelf vaak zegt waar en hoe laat: "in sporthal De
// Rode Loop", "naar park Gravenhof", "van 13 tot 16 uur". De build (scripts/build-sources.mjs) neemt dat over, met
// erbij dat het uit de tekst van het bericht komt.
//
// Niets verzinnen: alleen een plaats die de tekst letterlijk noemt, na een voorzetsel ("in", "op", "naar", "aan",
// "bij", "van") en met een woord dat een plek is (sporthal, park, fort, bibliotheek ...) en een eigen naam met een
// hoofdletter of een cijfer ("Fort 8"). Geen huisnummer, geen straat met nummer, geen persoon: een plaatsnaam van een
// publieke plek. "Maak kennis met Academie Ekeren" is geen plaats (geen voorzetsel van plaats); "het fort van
// Merksem wordt omgetoverd" ook niet (geen voorzetsel ervoor). Een uur alleen als de tekst precies één keer "van X
// tot Y uur" zegt. Puur: geen netwerk, geen klok.

const PLEK_WOORDEN = [
  "sporthal", "sportcentrum", "sportpark", "park", "fort", "kasteel", "bibliotheek", "cultuurcentrum", "ontmoetingscentrum",
  "dienstencentrum", "buurthuis", "buurtcentrum", "zaal", "academie", "kerk", "domein", "zwembad", "museum", "theater", "speeltuin", "jeugdcentrum",
];
// Hoofdletter of kleine letter aan het begin, de rest zoals het woord: geen vlag "i", want de naam erna moet met een
// hoofdletter of cijfer beginnen.
const woord = (w) => `[${w[0].toUpperCase()}${w[0]}]${w.slice(1)}`;
const PLEK_WOORD = `(?:${PLEK_WOORDEN.map(woord).join("|")})`;
const NAAMDEEL = "[A-Z0-9ÀÂÄÉÈÊËÏÎÔÖÛÜ][\\wÀ-ÿ'’-]*";
const VOORZETSEL = "(?:[Ii]n|[Oo]p|[Nn]aar|[Aa]an|[Bb]ij|[Vv]an)";
const PLEK = new RegExp(`(?<![\\wÀ-ÿ])${VOORZETSEL}\\s+(?:het\\s+|de\\s+)?(${PLEK_WOORD}\\s+(?:(?:van|de|den|der|het)\\s+)?${NAAMDEEL}(?:\\s+${NAAMDEEL}){0,3})`, "g");
// Een huisnummer of een postcode in de naam: dan niet (geen adres).
const MET_NUMMER = /\b\d{2,}\b|\b\d+\s*[a-z]?\s*,/;

// De plaatsen die de tekst noemt, met een hoofdletter vooraan, zonder dubbels; hoogstens twee.
export function plekkenUitTekst(tekst = "") {
  const t = String(tekst ?? "").replace(/\s+/g, " ");
  const uit = [];
  for (const m of t.matchAll(PLEK)) {
    const naam = m[1].replace(/[\s,;:.]+$/, "").trim();
    if (!naam || MET_NUMMER.test(naam)) continue;
    const mooi = naam.charAt(0).toUpperCase() + naam.slice(1);
    if (!uit.some((x) => x.toLowerCase() === mooi.toLowerCase())) uit.push(mooi);
  }
  return uit.slice(0, 2);
}

// "van 13 tot 16 uur", "van 14 tot 16.30 uur": begin en einde, alleen als de tekst het precies één keer zegt.
const UREN = /\bvan (\d{1,2})(?:[.:u](\d{2}))? tot (\d{1,2})(?:[.:u](\d{2}))? uur\b/g;
const hhmm = (u, m) => `${String(Number(u)).padStart(2, "0")}:${m || "00"}`;
export function urenUitTekst(tekst = "") {
  const treffers = [...String(tekst ?? "").matchAll(UREN)];
  if (treffers.length !== 1) return null;
  const [heel, u1, m1, u2, m2] = treffers[0];
  if (Number(u1) > 23 || Number(u2) > 24 || Number(m1 || 0) > 59 || Number(m2 || 0) > 59) return null;
  return { begin: hhmm(u1, m1), einde: hhmm(u2, m2), tekst: heel };
}

// De terugvalplaats van een fetcher: "District Merksem, locatie via de officiële bron" (en varianten).
export const PLEK_VIA_BRON = /,?\s*locatie via de officiële bron$/i;
// Bronnen waarvan de tekst een artikel van de stad of het district is. UiT nooit (die tekst nemen we niet over).
export const ARTIKEL_BRONNEN = new Set(["stad-districten", "district-nieuws", "district-kalender", "district-projecten", "mail-district", "mail-stad"]);

// Eén agendapunt: plek en uur uit zijn eigen tekst (titel en info), als de bron ze niet apart gaf. Anders hetzelfde
// item terug. sourceId: van het bronbestand (een item in een bronbestand draagt het niet zelf).
export function plekEnUurUitTekst(item = {}, sourceId = item?.sourceId) {
  if (!ARTIKEL_BRONNEN.has(sourceId)) return item;
  const tekst = `${item.title || ""}. ${item.info || ""}`;
  let uit = item;
  if (PLEK_VIA_BRON.test(String(item.location || ""))) {
    const plekken = plekkenUitTekst(tekst);
    if (plekken.length) {
      const rest = String(item.location).replace(PLEK_VIA_BRON, "").trim();
      uit = { ...uit, location: `${plekken.join(" en ")}${rest ? `, ${rest}` : ""} (plaats volgens het bericht)` };
    }
  }
  if (item.timeSlot === "Info" && !String(item.timeText || "").trim()) {
    const uren = urenUitTekst(item.info);
    if (uren) uit = { ...uit, timeSlot: uren.begin, timeText: `${uren.tekst} (volgens het bericht)` };
  }
  return uit;
}
