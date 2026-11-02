// Buurtinformatie per gekozen officiële straat: kleine 7-dagenradar en verwijzingen
// naar betrouwbare Vlaamse kaarten. Geen adres-/huisnummerregistratie op een server.
import { buildPlaceIndex, resolvePlaceParam } from "./place-core.js";
import { radarToestand, radarVoorStraat } from "./buurt-info-core.js";

let indexBelofte = null, radarBelofte = null;
async function laadJson(url) {
  const antwoord = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-cache" });
  if (!antwoord.ok) throw new Error(`http_${antwoord.status}`);
  return antwoord.json();
}
function laadIndex() {
  if (!indexBelofte) indexBelofte = laadJson("/geo/straten.json")
    .then((doc) => buildPlaceIndex({ streets: Array.isArray(doc?.streets) ? doc.streets : [], wijken: [] }))
    .catch(() => null);
  return indexBelofte;
}
function laadRadar() {
  if (!radarBelofte) radarBelofte = laadJson("/history/radar.json").catch(() => null);
  return radarBelofte;
}
function paneel() {
  const plek = document.querySelector("#plek .pv-place");
  if (!plek) return null;
  let element = document.getElementById("buurt-info");
  if (element) return element;
  element = document.createElement("section");
  element.id = "buurt-info";
  element.className = "buurt-info";
  element.setAttribute("aria-label", "Wat verandert er in deze straat en omgeving?");
  element.innerHTML = [
    '<div class="buurt-info-kop"><div><span class="buurt-info-kicker">In deze buurt</span><h3>Wijzigingen en de omgeving</h3></div><small>Gebaseerd op officiële straatgegevens</small></div>',
    '<p class="buurt-info-toestand" role="status" aria-live="polite">Wijzigingshistoriek opvragen…</p>',
    '<div class="buurt-info-aantallen" hidden><div><strong data-nieuw>—</strong><span>nieuw waargenomen</span></div><div><strong data-gewijzigd>—</strong><span>gewijzigd</span></div><div><strong data-afgelopen>—</strong><span>niet meer in de bron</span></div></div>',
    '<p class="buurt-info-periode"></p>',
    '<p class="buurt-info-kader">Een dossier dat voor het eerst in ons archief verschijnt, is niet noodzakelijk toen gestart. Het ontbreken van een wijziging bewijst niet dat er geen werken zijn.</p>',
    '<details class="buurt-info-meer"><summary>Erfgoed, natuur en de ruimere omgeving</summary><p>Bekijk aanvullende informatie bij officiële kaartbeheerders. De externe kaarten openen afzonderlijk: zoek daar dezelfde straat opnieuw op.</p>',
    '<div class="buurt-info-links"><a href="https://geo.onroerenderfgoed.be/" target="_blank" rel="noopener noreferrer">Beschermd en geïnventariseerd erfgoed ↗</a><a href="https://www.geopunt.be/" target="_blank" rel="noopener noreferrer">Bodem, omgeving en kaarten ↗</a><a href="https://www.geopunt.be/hinder-in-kaart" target="_blank" rel="noopener noreferrer">Officiële hinderkaart ↗</a></div></details>'
  ].join("");
  plek.after(element);
  return element;
}
let gepland = 0;
function tekenLater() {
  cancelAnimationFrame(gepland);
  gepland = requestAnimationFrame(teken);
}
async function teken() {
  const element = paneel();
  if (!element) return;
  const parameter = new URLSearchParams(window.location.search).get("plek");
  if (!parameter) { element.hidden = true; return; }
  element.hidden = false;
  const status = element.querySelector(".buurt-info-toestand");
  const cijfers = element.querySelector(".buurt-info-aantallen");
  const periode = element.querySelector(".buurt-info-periode");
  status.textContent = "Straat en laatste waarnemingen nakijken…";
  status.hidden = false;
  cijfers.hidden = true;
  periode.textContent = "";
  const [index, radar] = await Promise.all([laadIndex(), laadRadar()]);
  if (parameter !== new URLSearchParams(window.location.search).get("plek")) return;
  const straat = index ? resolvePlaceParam(index, parameter) : null;
  if (!straat || straat.type !== "straat") { element.hidden = true; return; }
  // Een laag die niet actueel is, of een oudere radar: de laatste goede stand, zonder te zeggen dat iets faalt
  // (besluit van 18-10-2026, radarToestand). Zonder radar: leeg.
  const info = radarVoorStraat(radar, straat);
  const toestand = radarToestand(info);
  status.textContent = toestand.zin;
  status.hidden = !toestand.zin;
  if (!toestand.cijfers) return;
  const datum = new Intl.DateTimeFormat("nl-BE", { timeZone: "Europe/Brussels", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(info.ververst));
  periode.textContent = info.periodenoot + ". Laatste datacontrole: " + datum + ".";
  element.querySelector("[data-nieuw]").textContent = String(info.nieuw);
  element.querySelector("[data-gewijzigd]").textContent = String(info.gewijzigd);
  element.querySelector("[data-afgelopen]").textContent = String(info.afgelopen);
  cijfers.hidden = false;
}
window.addEventListener("public-agenda:view-change", tekenLater);
window.addEventListener("popstate", tekenLater);
tekenLater();
