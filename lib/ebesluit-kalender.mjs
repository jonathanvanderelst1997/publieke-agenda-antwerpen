// eBesluit zonder zoekfunctie: dezelfde zoekrijen, uit de maandlijst en de zittingspagina's.
//
// Waarom (23-10-2026). /zoeken van ebesluit.antwerpen.be geeft sinds 13-10-2026 HTTP 500 ("Systeem
// tijdelijk onbeschikbaar"), ook zonder parameters en ook in een gewone browser. Kleinere zoekpagina's
// helpen dus niet. De rest van de site werkt wel: de maandlijst /zittingen/lijst?month=&year= (die
// district-vergaderingen al leest, lib/ebesluit-meetings.mjs) en elke zittingspagina, met per
// agendapunt het id, de titel en of de inhoud gepubliceerd is. Daaruit komen hier rijen in dezelfde
// vorm als rowsFromSearch (plus de zittingsdatum, zoals zoekRijen in lib/ebesluit-evenementen.mjs),
// zodat de detailronde daarna niets anders doet dan voordien.
//
// Wat anders is dan zoeken, en waarom dat mag:
//   - alleen de organen waarvan de bronnen besluiten gebruiken (KALENDER_ORGANEN). Elk besluit in
//     evenement-besluiten.json en district-ebesluit.json kwam van een van die drie; een ander district
//     viel in de detailronde toch weg (needsDetail, soortVanTitel);
//   - een zoekterm moet in de titel staan. De detailronde beslist sowieso op de titel;
//   - geen zittingen meer dan KALENDER_DAGEN_VOORUIT na vandaag: daar staat nog geen agenda.
// Rustig: KALENDER_PAUZE_MS tussen twee verzoeken, en elke pagina hoogstens één keer per verversing
// (de cache wordt gedeeld door alle zoektermen van één bron).
//
// Puur op de `haal`-functie na: geen eigen netwerk, geen klok (vandaag wordt meegegeven).
import { addDaysIso, stripTags } from "./html-text.mjs";

export const EBESLUIT_KALENDER_BASE = "https://ebesluit.antwerpen.be";
export const KALENDER_ORGANEN = /^(?:college van burgemeester en schepenen|districtscollege antwerpen|districtsraad antwerpen)$/i;
export const KALENDER_DAGEN_VOORUIT = 14;
export const KALENDER_PAUZE_MS = 500;
// Een venster van een jaar is twaalf maandpagina's; meer dan dit is een vergissing in de aanroep.
export const KALENDER_MAX_MAANDEN = 24;

// stripTags ontcijfert ook de entiteiten en normaliseert de witruimte.
const tekst = (html = "") => stripTags(String(html));
const isoDag = (jaar, maand, dag) => `${jaar}-${String(maand).padStart(2, "0")}-${String(dag).padStart(2, "0")}`;

export function maandlijstUrl(jaar, maand) {
  return `${EBESLUIT_KALENDER_BASE}/zittingen/lijst?month=${String(maand).padStart(2, "0")}&year=${jaar}`;
}

// De kalendermaanden die een venster raakt: [[jaar, maand], ...].
export function maandenTussen(start, end) {
  const uit = [];
  let [jaar, maand] = start.slice(0, 7).split("-").map(Number);
  const [eindJaar, eindMaand] = end.slice(0, 7).split("-").map(Number);
  while ((jaar < eindJaar || (jaar === eindJaar && maand <= eindMaand)) && uit.length < KALENDER_MAX_MAANDEN) {
    uit.push([jaar, maand]);
    maand += 1;
    if (maand > 12) { maand = 1; jaar += 1; }
  }
  return uit;
}

// De maandlijst: per zitting een link met het orgaan, de dag en het uur.
//   <a href="/zittingen/25.0902.1984.8754" class="meeting-detail" ...>
//     <span class="organ">districtscollege Antwerpen</span><span class="time">ma 12/10/2026 - 13:30</span>
export function zittingenUitLijst(html = "") {
  const zittingen = new Map();
  for (const match of String(html).matchAll(/<a\b[^>]*href="\/zittingen\/([0-9][0-9.]{4,40})"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const orgaan = tekst(match[2].match(/<span[^>]*class="[^"]*\borgan\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "");
    const tijd = tekst(match[2].match(/<span[^>]*class="[^"]*\btime\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "");
    const datum = tijd.match(/(\d{2})\/(\d{2})\/(20\d{2})\s*-\s*([0-2]\d:[0-5]\d)/);
    if (!orgaan || !datum) continue;
    zittingen.set(match[1], { zittingId: match[1], orgaan, datum: isoDag(Number(datum[3]), Number(datum[2]), Number(datum[1])), uur: datum[4] });
  }
  return [...zittingen.values()];
}

// De zittingspagina: per agendapunt een <li class="agendapage" data-meeting-item-id="...">. Gepubliceerd
// is een punt met een link naar zijn eigen pagina en zonder "not-published"; zo niet, dan staat alleen
// de titel er (een zitting die nog moet komen, of een punt dat niet openbaar wordt).
export function puntenUitZitting(html = "", zitting) {
  const rijen = [];
  const blokken = String(html).split(/(?=<li\b[^>]*\bdata-meeting-item-id=")/i).slice(1);
  for (const blok of blokken) {
    const id = blok.match(/^<li\b[^>]*\bdata-meeting-item-id="([^"]+)"/i)?.[1];
    const titel = blok.match(/<a\b[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    if (!id || !titel) continue;
    const eigenPagina = new RegExp(`href="/zittingen/[^"/]+/agendapunten/${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(titel[0]);
    const nietGepubliceerd = /class="[^"]*\bitem\b[^"]*\bnot-published\b/i.test(blok);
    rijen.push({
      id,
      meetingId: zitting.zittingId,
      published: eigenPagina && !nietGepubliceerd,
      title: tekst(titel[1]),
      organ: zitting.orgaan,
      zitting: zitting.datum,
    });
  }
  return rijen;
}

// Zoekt `trefwoord` in de titels van de agendapunten van de zittingen tussen start en end (ISO-dagen).
//   haal(url)  -> Promise<html>, met de eigen herkansingen van de bron; een fout breekt de zoekronde af;
//   cache      -> Map(url -> Promise<html>), gedeeld door de zoektermen van één verversing;
//   pauze(ms)  -> wacht tussen twee verzoeken die niet uit de cache komen.
// Geeft { rows, pages, complete }. Faalt een pagina, dan gooit dit: onvolledig is nooit "volledig".
export async function zoekViaKalender({ haal, trefwoord, start, end, vandaag, cache = new Map(), pauze = async () => {} }) {
  const tot = [end, addDaysIso(vandaag, KALENDER_DAGEN_VOORUIT)].sort()[0];
  if (start > tot) return { rows: [], pages: 0, complete: true };
  let pages = 0;
  const lees = async (url) => {
    if (!cache.has(url)) {
      if (cache.size) await pauze(KALENDER_PAUZE_MS);
      const belofte = haal(url);
      cache.set(url, belofte);
      // Een mislukte pagina blijft niet in de cache hangen: de volgende zoekterm probeert ze opnieuw.
      belofte.catch(() => cache.delete(url));
    }
    pages += 1;
    return cache.get(url);
  };
  const zoek = trefwoord.toLocaleLowerCase("nl");
  const rijen = new Map();
  for (const [jaar, maand] of maandenTussen(start, tot)) {
    const zittingen = zittingenUitLijst(await lees(maandlijstUrl(jaar, maand)))
      .filter((zitting) => KALENDER_ORGANEN.test(zitting.orgaan) && zitting.datum >= start && zitting.datum <= tot);
    for (const zitting of zittingen) {
      const html = await lees(`${EBESLUIT_KALENDER_BASE}/zittingen/${zitting.zittingId}`);
      for (const rij of puntenUitZitting(html, zitting)) {
        if (rij.title.toLocaleLowerCase("nl").includes(zoek)) rijen.set(`${rij.meetingId}|${rij.id}`, rij);
      }
    }
  }
  return { rows: [...rijen.values()], pages, complete: true };
}
