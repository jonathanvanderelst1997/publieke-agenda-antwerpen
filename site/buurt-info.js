// Buurtinformatie per gekozen officiële straat: kleine 7-dagenradar en verwijzingen
// naar betrouwbare Vlaamse kaarten. Geen adres-/huisnummerregistratie op een server.
import { buildPlaceIndex, resolvePlaceParam } from "./place-core.js";
import { inJeBuurt, radarToestand, radarVoorStraat } from "./buurt-info-core.js";
import { itemPoint } from "./neighborhood-core.js";

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
let geoBelofte = null, wijkBelofte = null;
function laadGeo() {
  if (!geoBelofte) geoBelofte = laadJson("/geo/locaties.json").catch(() => null);
  return geoBelofte;
}
function laadWijkNamen() {
  if (!wijkBelofte) wijkBelofte = laadJson("/geo/wijken.geo.json")
    .then((doc) => new Map((doc?.features || []).map((f) => [f?.properties?.code, f?.properties?.naam]).filter(([code, naam]) => code && naam)))
    .catch(() => new Map());
  return wijkBelofte;
}
const datumKort = new Intl.DateTimeFormat("nl-BE", { timeZone: "Europe/Brussels", weekday: "short", day: "numeric", month: "short" });
const vandaagBrussel = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
// Eén lijst kaartjes, met textContent (nooit HTML uit de data).
function vulLijst(lijst, kaarten, { afstand = false } = {}) {
  lijst.replaceChildren(...kaarten.map((k) => {
    const li = document.createElement("li");
    const titel = k.link ? document.createElement("a") : document.createElement("strong");
    titel.textContent = k.title;
    if (k.link) {
      titel.href = k.link;
      if (/^https?:/.test(k.link)) { titel.target = "_blank"; titel.rel = "noopener noreferrer"; }
    }
    const meta = document.createElement("span");
    const datum = datumKort.format(new Date(`${k.date}T12:00:00Z`));
    meta.textContent = [k.endDate && k.endDate > k.date ? `${datum} → ${datumKort.format(new Date(`${k.endDate}T12:00:00Z`))}` : datum, k.location, afstand && k.afstand ? `± ${k.afstand} m` : ""].filter(Boolean).join(" · ");
    li.append(titel, meta);
    return li;
  }));
}
async function tekenBuurt(element, straat) {
  const blok = element.querySelector(".buurt-info-agenda");
  if (!blok) return;
  const [geo, wijkNamen] = await Promise.all([laadGeo(), laadWijkNamen()]);
  const items = Array.isArray(window.PUBLIC_AGENDA_PUBLIC_ITEMS) ? window.PUBLIC_AGENDA_PUBLIC_ITEMS : [];
  const wijk = (straat.wijken || []).map((code) => wijkNamen.get(code)).find(Boolean) || "";
  const { evenementen, nieuws } = inJeBuurt({ items, straat, wijk, punt: (item) => (geo ? itemPoint(item, geo) : null), vandaag: vandaagBrussel() });
  vulLijst(blok.querySelector("[data-buurt-evenementen]"), evenementen, { afstand: true });
  vulLijst(blok.querySelector("[data-buurt-nieuws]"), nieuws);
  blok.querySelector("[data-buurt-evenementen-leeg]").hidden = evenementen.length > 0;
  blok.querySelector("[data-buurt-nieuws-leeg]").hidden = nieuws.length > 0;
  blok.querySelector("[data-buurt-wijk]").textContent = wijk ? ` of de wijk ${wijk}` : "";
  blok.hidden = false;
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
    '<div class="buurt-info-agenda" hidden><h4>Evenementen en feesten in je buurt</h4><p class="buurt-info-uitleg">Van de publieke agenda, tot ongeveer 500 m rond de straat, de komende 60 dagen. Wat in de straat zelf gebeurt, staat in de lijst hieronder.</p><ul class="buurt-info-lijst" data-buurt-evenementen></ul><p class="buurt-info-leeg" data-buurt-evenementen-leeg>Nagekeken: de evenementen en feesten van de publieke agenda met een gekende plek tot ongeveer 500 m rond de straat.</p><h4>Nieuws uit je buurt</h4><p class="buurt-info-uitleg">Inspraak, infomomenten, projecten en nieuws van het district die de straat<span data-buurt-wijk></span> noemen.</p><ul class="buurt-info-lijst" data-buurt-nieuws></ul><p class="buurt-info-leeg" data-buurt-nieuws-leeg>Nagekeken: de projecten en het nieuws van het district op de publieke agenda.</p></div>',
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
let gepland = 0, reserve = 0, pogingen = 0;
// Zoals de plek zelf (site/place-view.js, schedule): requestAnimationFrame met een reserve na 400 ms, want een browser die
// het tekenen uitstelt (een tab op de achtergrond) liet dit blok anders weg. Staat de plek er nog niet, dan nog eens.
function tekenLater() {
  cancelAnimationFrame(gepland);
  clearTimeout(reserve);
  const eenmaal = () => { cancelAnimationFrame(gepland); clearTimeout(reserve); teken(); };
  gepland = requestAnimationFrame(eenmaal);
  reserve = setTimeout(eenmaal, 400);
}
async function teken() {
  const element = paneel();
  if (!element) {
    if (new URLSearchParams(window.location.search).get("plek") && pogingen < 20) { pogingen += 1; setTimeout(tekenLater, 500); }
    return;
  }
  pogingen = 0;
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
  tekenBuurt(element, straat).catch(() => {});
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
