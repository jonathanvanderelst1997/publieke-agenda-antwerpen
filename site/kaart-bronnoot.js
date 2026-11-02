// Wat een bewoner echt mag afleiden uit onvolledige officiële records.
// Geen nieuwe feiten of persoonsnamen; deze zinnen tonen ontbrekende context al op een gesloten kaart.
// Wat ontbreekt, zegt een zin uit de vaste lijst (site/onbekend-zinnen.js).
import { onbekendZin } from "./onbekend-zinnen.js";
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const ontbreekt = (entry) => Array.isArray(entry?.uitleg?.ontbreekt) ? entry.uitleg.ontbreekt.map(clean) : [];
const heeft = (regels, regex) => regels.some((tekst) => regex.test(tekst));
export function kaartBronNoot(entry = {}, { zichtbaar = [] } = {}) {
  const regels = ontbreekt(entry), item = entry.item || {};
  const context = clean(zichtbaar.join(" ") + " " + (entry.summary || "")).toLowerCase();
  const soort = entry.source, soortInname = item.kind;
  if (soort === "terraces") {
    // De A-Sign-laag wordt al privacyveilig samengevat naar type en status.
    return "Terrasregistratie: type en status bekend; de uitbater wordt hier niet getoond.";
  }
  if (soort === "publicSpace" && soortInname === "sgw") {
    // De A-Sign SGW-laag geeft het type verkeersmaatregel (werfzone/omleiding), niet de werfopdracht.
    return "Deze bron omschrijft de verkeersmaatregel; het doel van de werkzaamheden is hier niet bevestigd.";
  }
  if (soort === "publicSpace" && (soortInname === "iod" || soortInname === "event")) {
    const delen = [];
    if (heeft(regels, /wat er gebeurt en de naam niet gepubliceerd/i) && !/wat er gebeurt.*niet gepubliceerd/i.test(context))
      delen.push(onbekendZin("bronnoot-activiteit"));
    else if (heeft(regels, /naam van het evenement niet gepubliceerd/i) && !/naam.*niet gepubliceerd/i.test(context))
      delen.push(onbekendZin("bronnoot-naam"));
    if (heeft(regels, /uren niet gepubliceerd/i) && !/uren.*niet gepubliceerd/i.test(context))
      delen.push(onbekendZin("bronnoot-uur"));
    if (delen.length) return delen.join(" · ") + ".";
  }
  if (soort === "works" && heeft(regels, /omschrijving niet gepubliceerd/i) &&
      !/omschrijving.*niet gepubliceerd/i.test(context)) {
    return "De beheerder heeft geen vrije omschrijving van dit werk gepubliceerd.";
  }
  return "";
}
