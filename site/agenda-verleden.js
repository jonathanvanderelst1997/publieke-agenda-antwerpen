// Het verleden van de agenda op /verleden/ (besluit van de eigenaar van 3 november 2026: "alles wat ooit in agenda staat,
// publiek blijft staan, maar verdwijnt dan naar verleden").
//
// Leest site/verleden/maanden.json en per maand site/verleden/<JJJJ-MM>.json (lib/agenda-verleden.mjs) en toont elk
// agendapunt waarvan de laatste dag voorbij is, het nieuwste eerst, per dag, met een link naar zijn eigen pagina. Wat
// "voorbij" is, rekent de browser met de dag van vandaag in Brussel: na middernacht schuift een punt vanzelf van de
// agenda naar hier, ook vóór de volgende verversing. De markten van een dag staan samen op één regel.
//
// De parkeerverboden die de site zag (site/verleden/parkeerverboden/<JJJJ-MM>.json, lib/agenda-verleden.mjs) staan per
// dag van hun einde samen: "Parkeerverbod", de plaats met het exacte huisnummer en de periode, nooit de reden.
//
// De functies bovenaan zijn puur (tests/agenda-verleden.test.mjs); mountVerleden() hangt ze aan de pagina.

export const MARKT_BRON = "stad-markten";
const DAG = /^\d{4}-\d{2}-\d{2}$/;

export function laatsteDag(record) {
  return record.endDate && record.endDate > record.date ? record.endDate : record.date;
}

export function vandaagInBrussel(nu = new Date()) {
  const delen = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(nu)
      .map((deel) => [deel.type, deel.value])
  );
  return `${delen.year}-${delen.month}-${delen.day}`;
}

// Hoort dit record in het verleden van vandaag? Voorbij, en niet opgegaan in een ander punt.
export function inVerleden(record, vandaag) {
  if (!record || !DAG.test(String(record.date ?? "")) || !DAG.test(String(vandaag ?? ""))) return false;
  if (record.opgegaanIn) return false;
  return laatsteDag(record) < vandaag;
}

// Een parkeerverbod ({ id, location, start, end }) is voorbij na zijn laatste dag. Nooit een reden: die staat niet in
// het record, en deze pagina toont alleen "Parkeerverbod", de plaats en de periode.
export function parkeerInVerleden(record, vandaag) {
  return Boolean(record) && String(record.id ?? "").startsWith("parking:") && DAG.test(String(record.end ?? "")) && DAG.test(String(vandaag ?? "")) && record.end < vandaag;
}

export function inDistrict(record) {
  return record.scope !== "stad" || record.inDistrict === true;
}

const vouw = (tekst) => String(tekst ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Filter: alleen district Antwerpen (een stadsitem dat in het district ligt, telt mee), en een zoekterm in titel of plaats.
export function filterVerleden(records, { vandaag, alleenDistrict = true, zoek = "" } = {}) {
  const term = vouw(zoek).trim();
  return records.filter((record) => inVerleden(record, vandaag)
    && (!alleenDistrict || inDistrict(record))
    && (!term || vouw(`${record.title} ${record.location} ${record.dateLabel}`).includes(term)));
}

export function filterParkeer(records, { vandaag, zoek = "" } = {}) {
  const term = vouw(zoek).trim();
  return records.filter((record) => parkeerInVerleden(record, vandaag) && (!term || vouw(`parkeerverbod ${record.location}`).includes(term)));
}

// Per laatste dag, het nieuwste eerst; per dag de markten en de parkeerverboden apart.
export function perDag(records, parkeerverboden = []) {
  const dagen = new Map();
  const groep = (dag) => {
    if (!dagen.has(dag)) dagen.set(dag, { dag, punten: [], markten: [], parkeerverboden: [] });
    return dagen.get(dag);
  };
  for (const record of records) (record.sourceId === MARKT_BRON ? groep(laatsteDag(record)).markten : groep(laatsteDag(record)).punten).push(record);
  for (const record of parkeerverboden) groep(record.end).parkeerverboden.push(record);
  return [...dagen.values()]
    .sort((a, b) => b.dag.localeCompare(a.dag))
    .map((g) => ({
      ...g,
      punten: g.punten.sort((a, b) => String(a.timeSlot).localeCompare(String(b.timeSlot)) || a.title.localeCompare(b.title, "nl")),
      markten: g.markten.sort((a, b) => a.title.localeCompare(b.title, "nl")),
      parkeerverboden: g.parkeerverboden.sort((a, b) => a.location.localeCompare(b.location, "nl") || a.id.localeCompare(b.id)),
    }));
}

// De maanden om te laden, het nieuwste eerst: alleen tot en met deze maand (een latere maand heeft niets voorbij), met
// agendapunten of parkeerverboden.
export function maandenTotNu(index, vandaag) {
  const nu = String(vandaag).slice(0, 7);
  const metIets = (lijst) => (Array.isArray(lijst) ? lijst : []).filter((entry) => /^\d{4}-\d{2}$/.test(String(entry?.maand)) && entry.maand <= nu && entry.aantal > 0).map((entry) => entry.maand);
  return [...new Set([...metIets(index?.maanden), ...metIets(index?.parkeerverboden)])].sort((a, b) => b.localeCompare(a));
}

export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const MAANDNAAM = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const metHoofdletter = (tekst) => (tekst ? tekst[0].toUpperCase() + tekst.slice(1) : tekst);

export function maandTitel(maand) {
  const [jaar, nummer] = String(maand).split("-").map(Number);
  return `${MAANDNAAM[nummer - 1] ?? ""} ${jaar}`;
}

export function dagTitel(dag) {
  const [jaar, maand, nummer] = String(dag).split("-").map(Number);
  return metHoofdletter(new Intl.DateTimeFormat("nl-BE", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(jaar, maand - 1, nummer)));
}

const eventHref = (record) => `/event/${encodeURIComponent(record.id)}/`;

function puntTemplate(record) {
  const meta = [
    record.dateLabel && record.endDate && record.endDate > record.date ? record.dateLabel : "",
    record.timeText && /\d/.test(record.timeText) ? record.timeText : "",
    record.location,
  ].filter(Boolean);
  return `<li class="verleden-punt" id="${esc(record.id)}">
      <a href="${esc(eventHref(record))}"><strong>${esc(record.title)}</strong></a>
      ${meta.length ? `<span class="verleden-meta">${esc(meta.join(" · "))}</span>` : ""}
      <span class="verleden-badges">${record.theme ? `<span>${esc(record.theme)}</span>` : ""}${record.scope === "stad" ? `<span>${inDistrict(record) ? "Stad Antwerpen, in district Antwerpen" : "Stad Antwerpen"}</span>` : `<span>District Antwerpen</span>`}${record.weg ? `<span>stond sinds ${esc(korteDatum(record.weg))} niet meer in de agenda</span>` : ""}</span>
    </li>`;
}

function korteDatum(dag) {
  const [jaar, maand, nummer] = String(dag).split("-").map(Number);
  return `${nummer} ${MAANDNAAM[maand - 1] ?? ""} ${jaar}`;
}

function marktenTemplate(markten) {
  if (!markten.length) return "";
  return `<li class="verleden-punt verleden-markten" id="markten-${esc(laatsteDag(markten[0]))}">
      <strong>🧺 ${markten.length === 1 ? "1 markt" : `${markten.length} markten`}</strong>
      <span class="verleden-meta">${markten.map((markt) => `<a id="${esc(markt.id)}" href="${esc(eventHref(markt))}">${esc(markt.title)}</a>`).join(" · ")}</span>
    </li>`;
}

function periodeTekst(start, end) {
  return start === end ? korteDatum(end) : `${korteDatum(start)} tot ${korteDatum(end)}`;
}

// De parkeerverboden van een dag: één regel, open te klappen; elk als "Parkeerverbod", de plaats en de periode.
function parkeerTemplate(parkeerverboden) {
  if (!parkeerverboden.length) return "";
  return `<li class="verleden-punt verleden-parkeer">
      <details>
        <summary><strong>🅿️ ${parkeerverboden.length === 1 ? "1 parkeerverbod" : `${parkeerverboden.length} parkeerverboden`}</strong> liepen af</summary>
        <ul>${parkeerverboden.map((record) => `<li id="${esc(record.id)}">Parkeerverbod · ${esc(record.location)} · ${esc(periodeTekst(record.start, record.end))}${record.weg ? ` · stond sinds ${esc(korteDatum(record.weg))} niet meer in A-Sign` : ""}</li>`).join("")}</ul>
      </details>
    </li>`;
}

export function verledenHtml(groepen) {
  if (!groepen.length) return `<p class="verleden-leeg">Binnen deze keuze staat er (nog) niets in het verleden.</p>`;
  let maand = "";
  return groepen.map((groep) => {
    const kop = groep.dag.slice(0, 7) !== maand ? `<h2 class="verleden-maand">${esc(metHoofdletter(maandTitel((maand = groep.dag.slice(0, 7)))))}</h2>` : "";
    return `${kop}<section class="verleden-dag" aria-label="${esc(dagTitel(groep.dag))}">
      <h3>${esc(dagTitel(groep.dag))}</h3>
      <ul>${groep.punten.map(puntTemplate).join("")}${marktenTemplate(groep.markten)}${parkeerTemplate(groep.parkeerverboden ?? [])}</ul>
    </section>`;
  }).join("");
}

// ---- de pagina ----

export async function mountVerleden({ root = document, fetchJson = (url) => fetch(url, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))), nu = new Date() } = {}) {
  const lijst = root.querySelector("[data-verleden-lijst]");
  const meer = root.querySelector("[data-verleden-meer]");
  const status = root.querySelector("[data-verleden-status]");
  const zoekVeld = root.querySelector("[data-verleden-zoek]");
  const stadVeld = root.querySelector("[data-verleden-stad]");
  const parkeerVeld = root.querySelector("[data-verleden-parkeer]");
  if (!lijst) return;
  const vandaag = vandaagInBrussel(nu);
  const url = new URL(window.location.href);
  const doelMaand = /^\d{4}-\d{2}$/.test(url.searchParams.get("maand") ?? "") ? url.searchParams.get("maand") : "";
  let doelId = "";
  try {
    doelId = decodeURIComponent(url.hash.replace(/^#/, ""));
  } catch {
    doelId = "";
  }

  let index;
  try {
    index = await fetchJson("/verleden/maanden.json");
  } catch {
    status.textContent = "Het verleden kon nu niet geladen worden. Probeer het later opnieuw.";
    return;
  }
  const maanden = maandenTotNu(index, vandaag);
  const metAgenda = new Set((index?.maanden ?? []).filter((entry) => entry.aantal > 0).map((entry) => entry.maand));
  const metParkeer = new Set((index?.parkeerverboden ?? []).filter((entry) => entry.aantal > 0).map((entry) => entry.maand));
  const geladen = [];
  const parkeer = [];
  let volgende = 0;
  const laadMaand = async () => {
    const maand = maanden[volgende];
    volgende += 1;
    const [agenda, verboden] = await Promise.all([
      metAgenda.has(maand) ? fetchJson(`/verleden/${maand}.json`).catch(() => null) : null,
      metParkeer.has(maand) ? fetchJson(`/verleden/parkeerverboden/${maand}.json`).catch(() => null) : null,
    ]);
    /* een maand die niet laadt, slaat de pagina over; de volgende knop probeert de rest */
    if (Array.isArray(agenda?.items)) geladen.push(...agenda.items);
    if (Array.isArray(verboden?.items)) parkeer.push(...verboden.items);
  };
  const teken = () => {
    const records = filterVerleden(geladen, { vandaag, alleenDistrict: !stadVeld?.checked, zoek: zoekVeld?.value ?? "" });
    const verboden = parkeerVeld && !parkeerVeld.checked ? [] : filterParkeer(parkeer, { vandaag, zoek: zoekVeld?.value ?? "" });
    lijst.innerHTML = verledenHtml(perDag(records, verboden));
    const vanaf = volgende < maanden.length ? maandTitel(maanden[volgende - 1] ?? "") : "";
    status.textContent = `${records.length} voorbije ${records.length === 1 ? "punt" : "punten"}${verboden.length ? ` en ${verboden.length} ${verboden.length === 1 ? "parkeerverbod" : "parkeerverboden"}` : ""}${vanaf ? ` sinds het begin van ${vanaf}` : ""}${stadVeld?.checked ? "" : " in district Antwerpen"}.${vanaf ? " Oudere maanden laden met de knop onderaan." : ""}`;
    if (meer) {
      meer.hidden = volgende >= maanden.length;
      if (!meer.hidden) meer.textContent = `Toon ${maandTitel(maanden[volgende])}`;
    }
  };

  // Eerst de nieuwste maanden, tot er genoeg staat (of tot de maand uit de link van een eventpagina).
  while (volgende < maanden.length && (filterVerleden(geladen, { vandaag }).length < 40 || (doelMaand && maanden[volgende - 1] > doelMaand))) {
    await laadMaand();
  }
  const doel = doelId ? geladen.find((record) => record.id === doelId) : null;
  if (doel && stadVeld && !inDistrict(doel)) stadVeld.checked = true;
  teken();
  if (doel) {
    const plek = root.getElementById?.(doelId) ?? root.querySelector(`[id="${CSS.escape(doelId)}"]`);
    plek?.classList.add("verleden-doel");
    plek?.scrollIntoView({ block: "center" });
  }

  meer?.addEventListener("click", async () => {
    meer.disabled = true;
    await laadMaand();
    meer.disabled = false;
    teken();
  });
  zoekVeld?.addEventListener("input", teken);
  stadVeld?.addEventListener("change", teken);
  parkeerVeld?.addEventListener("change", teken);
}

if (typeof document !== "undefined" && document.querySelector?.("[data-verleden-lijst]")) {
  mountVerleden().catch(() => {});
}
