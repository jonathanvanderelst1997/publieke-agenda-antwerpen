// De statische pagina van één agendapunt (site/event/<id>/index.html), gebouwd uit een record van het verleden van
// de agenda (lib/agenda-verleden.mjs). Puur: geen bestanden, geen klok.
//
// Stand van de pagina:
// - "actueel": het punt staat in de agenda. Precies de pagina van vóór 3 november 2026 (een verversing herschrijft
//   dus geen enkele bestaande pagina van een komend punt).
// - "voorbij": de laatste dag is voorbij. Een korte regel bovenaan, en de knop gaat naar het verleden in plaats van
//   naar de agenda (daar staat het niet meer).
// - "weg": het punt verdween uit de agenda vóór zijn laatste dag. De pagina blijft, met de datum waarop het voor het
//   laatst in de agenda stond; geen reden (die kennen we niet zeker, en een storing hoort een bezoeker niet te zien,
//   besluit van 18-10-2026).
// - "opgegaan": hetzelfde punt staat nu onder een andere id (een andere bron of een nieuwe id van de bron); de pagina
//   blijft en wijst ernaar.
import { eventpaginaZin } from "../site/onbekend-zinnen.js";

export const PUBLIEKE_ORIGIN = "https://mijn-publieke-agenda-voor-district.onrender.com";

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function jsonForHtml(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
export function datumTekst(iso) {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[3])} ${MAANDEN[Number(m[2]) - 1]} ${m[1]}` : "";
}

export function eventpaginaUrl(id) {
  return `${PUBLIEKE_ORIGIN}/event/${encodeURIComponent(id)}/`;
}

// Waar de knop van een voorbij punt naartoe gaat: het verleden, op de maand van zijn laatste dag.
export function verledenHref(record, maand) {
  return `/verleden/?maand=${encodeURIComponent(maand)}#${encodeURIComponent(record.id)}`;
}

function bronnenHtml(record) {
  return (Array.isArray(record.bronnen) ? record.bronnen : [])
    .map((bron) => `<li><a href="${escapeHtml(bron.url)}" target="_blank" rel="noreferrer">${escapeHtml(bron.label)}</a></li>`)
    .join("\n            ");
}

// Een pagina van vóór september 2026 had soms geen bronnenlijst of naamsvermelding: die blijven dan weg in plaats van
// leeg. Een actuele pagina blijft precies zoals ze was.
function bronnenEnAttributie(record, stand) {
  const lijst = `        <ul class="event-sources" aria-label="Bronnen">
            ${bronnenHtml(record)}
        </ul>`;
  const attributie = `        <p class="event-attribution">${escapeHtml(record.attributie)}</p>`;
  if (stand === "actueel") return `${lijst}\n${attributie}`;
  return [record.bronnen?.length ? lijst : "", record.attributie ? attributie : ""].filter(Boolean).join("\n");
}

// Een regel bovenaan voor een punt dat niet (meer) in de agenda staat. Leeg bij "actueel".
function standRegel(record, stand, { opgegaanInTitel = "" } = {}) {
  const sinds = datumTekst(record.weg);
  if (stand === "opgegaan") {
    const titel = opgegaanInTitel && opgegaanInTitel !== record.title ? ` (${escapeHtml(opgegaanInTitel)})` : "";
    return `<p class="event-verleden">Dit agendapunt staat nu op <a href="/event/${encodeURIComponent(record.opgegaanIn)}/">een andere pagina</a>${titel}.</p>`;
  }
  if (stand === "weg") {
    return `<p class="event-verleden">Staat sinds ${escapeHtml(sinds)} niet meer in de agenda. Kijk bij de bron hieronder voor de laatste stand.</p>`;
  }
  if (stand === "voorbij") {
    return record.weg
      ? `<p class="event-verleden">Voorbij. Stond sinds ${escapeHtml(sinds)} niet meer in de agenda en staat nu in het <a href="/verleden/">verleden</a>.</p>`
      : `<p class="event-verleden">Voorbij. Dit agendapunt staat nu in het <a href="/verleden/">verleden</a> van de agenda.</p>`;
  }
  return "";
}

export function bouwEventpagina(record, { stand = "actueel", maand = "", opgegaanInTitel = "" } = {}) {
  const canonical = eventpaginaUrl(record.id);
  const destination = stand === "actueel" ? `/?event=${encodeURIComponent(record.id)}` : stand === "opgegaan" ? `/event/${encodeURIComponent(record.opgegaanIn)}/` : verledenHref(record, maand);
  const knop = stand === "actueel" ? "Bekijk in de volledige agenda" : stand === "opgegaan" ? "Bekijk het agendapunt" : "Bekijk in het verleden";
  const title = escapeHtml(record.title);
  const description = escapeHtml(record.info || `${record.title} in District Antwerpen.`);
  const dateText = escapeHtml(record.dateLabel || record.date);
  // Zonder uur of plaats: dat zeggen (onbekend-zinnen.js), geen belofte dat de officiële bron het wel heeft, en
  // "niet in de bron" alleen bij een bron die er nooit een geeft (eventpaginaZin). Een uur in timeSlot ("14:00") is
  // wel een uur.
  const timeText = escapeHtml(record.timeText || (/^\d{2}:\d{2}$/.test(String(record.timeSlot || "")) ? record.timeSlot : eventpaginaZin("uur", record.sourceId)));
  const location = escapeHtml(record.location || eventpaginaZin("plaats", record.sourceId));
  const sourcePublisher = escapeHtml(record.sourcePublisher || "Publieke organisator");
  const eventJson = jsonForHtml({
    "@context": "https://schema.org",
    "@type": "Event",
    name: record.title,
    startDate: record.date,
    description: record.info || undefined,
    endDate: record.endDate || undefined,
    location: record.location ? { "@type": "Place", name: record.location } : undefined,
    url: canonical,
    inLanguage: "nl-BE",
  });
  const regel = standRegel(record, stand, { opgegaanInTitel });
  return `<!doctype html>
<html lang="nl-BE">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="index,follow" />
    <meta name="description" content="${description}" />
    <meta name="referrer" content="strict-origin-when-cross-origin" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="nl_BE" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${canonical}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <link rel="canonical" href="${canonical}" />
    <link rel="stylesheet" href="/styles.css" />
    <script type="application/ld+json">${eventJson}</script>
    <title>${title} | Publieke agenda District Antwerpen</title>
  </head>
  <body>
    <main class="event-page">
      <a href="/">← Terug naar de publieke agenda</a>
      <article class="event-summary">${regel ? `\n        ${regel}` : ""}
        <h1>${title}</h1>
        <p>${description}</p>
        <dl>
          <div><dt>Wanneer</dt><dd>${dateText}</dd></div>
          <div><dt>Uur</dt><dd>${timeText}</dd></div>
          <div><dt>Waar</dt><dd>${location}</dd></div>
          <div><dt>Bron</dt><dd>${sourcePublisher}</dd></div>
        </dl>
        <div class="event-actions">
          <a href="${escapeHtml(destination)}">${knop}</a>
        </div>
${bronnenEnAttributie(record, stand)}
      </article>
    </main>
  </body>
</html>
`;
}

// ---- terug lezen ----
// Een eerder gebouwde pagina terug als record (voor het eenmalige herstel uit de git-geschiedenis,
// scripts/herstel-verleden.mjs). Leest alleen wat de pagina publiek toonde.

export function unescapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

const tekstUit = (html) => unescapeHtml(String(html ?? "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

export function leesEventpagina(html) {
  const ld = String(html).match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!ld) return null;
  let json;
  try {
    json = JSON.parse(ld[1]);
  } catch {
    return null;
  }
  const dd = (label) => {
    const m = String(html).match(new RegExp(`<dt>${label}</dt><dd>([\\s\\S]*?)</dd>`));
    return m ? tekstUit(m[1]) : "";
  };
  const h1 = String(html).match(/<h1>([\s\S]*?)<\/h1>/);
  // De bronnen: de lijst "event-sources", of op een pagina van augustus en september 2026 de externe links naast de knop.
  const bronnenBlok = String(html).match(/<ul class="event-sources"[^>]*>([\s\S]*?)<\/ul>/)
    ?? String(html).match(/<div class="event-actions">([\s\S]*?)<\/div>/);
  const bronnen = bronnenBlok
    ? [...bronnenBlok[1].matchAll(/<a href="(https:[^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({ url: unescapeHtml(m[1]), label: tekstUit(m[2]) }))
    : [];
  const attributie = String(html).match(/<p class="event-attribution">([\s\S]*?)<\/p>/);
  return {
    title: h1 ? tekstUit(h1[1]) : String(json.name ?? ""),
    info: typeof json.description === "string" ? json.description : "",
    date: String(json.startDate ?? ""),
    endDate: typeof json.endDate === "string" && json.endDate ? json.endDate : null,
    dateLabel: dd("Wanneer"),
    timeText: dd("Uur"),
    location: json.location && typeof json.location.name === "string" ? json.location.name : "",
    sourcePublisher: dd("Bron"),
    bronnen,
    attributie: attributie ? tekstUit(attributie[1]) : "",
  };
}
