// GIPOD-dossierhistoriek op uitdrukkelijk verzoek van de bezoeker.
// We gebruiken uitsluitend het al bestaande permanente, privacygeschoonde archief.
// De eerste waarneming is nooit een bewijs van de werkelijke startdatum.
const isDate = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const FORMAT = new Intl.DateTimeFormat("nl-BE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Brussels" });
const datum = (value) => isDate(value) ? FORMAT.format(new Date(value)) : "onbekend";
const idOk = (id) => /^work:[1-9]\d{0,15}$/.test(String(id));
export function analyseerWerkHistoriek(id, index, baseline, dagen) {
  if (!idOk(id) || !index || !baseline || !Array.isArray(dagen))
    return { gevonden: false, fout: true };
  const laag = baseline?.layers?.works;
  const inBaseline = Array.isArray(laag?.items) && laag.items.some((item) => item?.id === id);
  const baselineAt = inBaseline && isDate(laag?.observedAt) ? laag.observedAt : "";
  const events = dagen.flatMap((doc) => Array.isArray(doc?.events) ? doc.events : [])
    .filter((event) => event?.layer === "works" && event?.id === id && isDate(event?.observedAt) &&
      ["added", "changed", "removed"].includes(event?.type))
    .sort((a,b) => a.observedAt.localeCompare(b.observedAt));
  if (!inBaseline && !events.length) return { gevonden: false, fout: false, tot: index.lastObservedAt || "" };
  let eerste = baselineAt, sessieSinds = baselineAt, laatst = baselineAt, verwijderd = false, onderbrekingen = 0;
  for (const event of events) {
    if (!eerste) eerste = event.observedAt;
    laatst = event.observedAt;
    if (event.type === "removed") { verwijderd = true; sessieSinds = ""; onderbrekingen += 1; }
    else if (event.type === "added") { verwijderd = false; sessieSinds = event.observedAt; }
    else if (!verwijderd && !sessieSinds) { sessieSinds = event.observedAt; }
  }
  return { gevonden: true, fout: false, eerste, inBaseline, sessieSinds, laatst,
    wijzigingen: events.filter(event=>event.type==="changed").length,
    verschenen: events.filter(event=>event.type==="added").length,
    verdwenen: events.filter(event=>event.type==="removed").length,
    verwijderd, onderbrekingen, tot: index.lastObservedAt || "" };
}
export function samenvattingWerkHistoriek(v, { ingekort = false } = {}) {
  // Een onbruikbaar archief: niets, zonder te zeggen dat iets faalt (besluit van 18-10-2026).
  if (v.fout) return "";
  if (!v.gevonden) return "Dit dossier is niet teruggevonden in het geraadpleegde archief. Dat bewijst niet dat het niet bestond.";
  const eerste = v.inBaseline ? "Al aanwezig bij onze eerste archiefmeting op " : "Voor het eerst in ons archief gezien op ";
  const zinnen = [
    eerste + datum(v.eerste) + ".",
    String(v.wijzigingen) + " vastgelegde inhoudelijke " + (v.wijzigingen === 1 ? "wijziging" : "wijzigingen") + ".",
  ];
  if (v.verdwenen) zinnen.push(String(v.verdwenen) + " keer als verdwenen uit de bron geregistreerd.");
  if (v.verschenen) zinnen.push(String(v.verschenen) + " keer (opnieuw) als nieuw waargenomen.");
  if (v.verwijderd) zinnen.push("De laatste gebeurtenis voor dit dossier was een verwijdering uit de bron.");
  else if (v.sessieSinds && v.sessieSinds !== v.eerste) zinnen.push("Na een onderbreking opnieuw gezien vanaf " + datum(v.sessieSinds) + ".");
  if (isDate(v.tot)) zinnen.push("Laatste archiefmeting: " + datum(v.tot) + ".");
  if (ingekort) zinnen.push("Alleen de recentste 90 wijzigingsdagen zijn gelezen; de tussenliggende periode kan onvolledig zijn.");
  zinnen.push("De eerste waarneming is niet de echte startdatum van de werken.");
  return zinnen.join(" ");
}
async function json(url) {
  const reactie = await fetch(url, { headers: { Accept: "application/json" } });
  if (!reactie.ok) throw new Error("historiekbron niet bereikbaar");
  return reactie.json();
}
let archiefPromise;
async function laadArchief(onProgress) {
  // Groot, on-demand: geen bytes bij normaal browsen; een geslaagd verzoek wordt hergebruikt.
  const [index, baseline] = await Promise.all([json("/history/archive/index.json"), json("/history/archive/baseline.json")]);
  if (index?.schemaVersion !== 1 || baseline?.schemaVersion !== 1 || !Array.isArray(index.days)) throw Error("archiefvorm ongeldig");
  const gesorteerd = index.days.filter((dag) => /^\d{4}-\d{2}-\d{2}$/.test(dag?.date)).sort((a,b)=>a.date.localeCompare(b.date));
  const ingekort = gesorteerd.length > 90;
  const opTeHalen = gesorteerd.slice(-90);
  const dagen = [];
  for (let i = 0; i < opTeHalen.length; i += 4) {
    const segment = await Promise.all(opTeHalen.slice(i,i+4).map((d) => json("/history/archive/" + d.date + ".json")));
    dagen.push(...segment);
    onProgress?.(dagen.length, opTeHalen.length);
  }
  return { index, baseline, dagen, ingekort };
}
export async function werkHistoriekTekst(id, onProgress = () => {}) {
  if (!idOk(id)) throw Error("geen officieel GIPOD-werk-id");
  if (!archiefPromise) archiefPromise = laadArchief(onProgress).catch((error) => { archiefPromise = null; throw error; });
  const {index, baseline, dagen, ingekort} = await archiefPromise;
  return samenvattingWerkHistoriek(analyseerWerkHistoriek(id,index,baseline,dagen),{ingekort});
}
