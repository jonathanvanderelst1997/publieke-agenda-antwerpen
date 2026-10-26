// De al bestaande radar registreert waarnemingen, nooit de echte start van een werk.
// Dit is een kleine, zuivere adapter voor één officiële straat.
const isDate = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const n = (value) => Number.isSafeInteger(value) && value >= 0 && value < 100000 ? value : 0;
export function radarVoorStraat(radar, straat, { nu = Date.now() } = {}) {
  if (!radar || typeof radar !== "object" || !radar.straten || !Array.isArray(radar.runs) ||
      !straat || !straat.id || !straat.name || !straat.postcode || !isDate(radar.ververst)) {
    return { status: "onbeschikbaar", nieuw: null, gewijzigd: null, afgelopen: null, ververst: "", periodenoot: "" };
  }
  const lagen = radar.lagen && typeof radar.lagen === "object" ? Object.values(radar.lagen) : [];
  const gezond = lagen.length >= 2 && lagen.every((laag) => laag?.status === "ok");
  const verlopen = nu - Date.parse(radar.ververst) > 26 * 3600 * 1000 || Date.parse(radar.ververst) - nu > 3600 * 1000;
  const status = !gezond ? "gedeeltelijk" : verlopen ? "verouderd" : "ok";
  const sleutel = [straat.id, straat.name, straat.postcode].join("|");
  let nieuw = 0, gewijzigd = 0, afgelopen = 0;
  for (const telling of Array.isArray(radar.straten[sleutel]) ? radar.straten[sleutel] : []) {
    if (!Array.isArray(telling) || !Number.isInteger(telling[0]) || !isDate(radar.runs[telling[0]])) continue;
    nieuw += n(telling[1]);
    gewijzigd += n(telling[2]);
    afgelopen += n(telling[3]);
  }
  const ingekort = radar.ingekort === true;
  let periodenoot = "Waargenomen wijzigingen in de laatste 7 dagen";
  if (ingekort) {
    const eerste = radar.runs.filter(isDate).sort()[0];
    periodenoot = eerste ? "Waargenomen wijzigingen vanaf " + eerste.slice(0, 10) + " (radar ingekort)" : "Alleen beschikbare waarnemingen (radar ingekort)";
  }
  return { status, nieuw, gewijzigd, afgelopen, ververst: radar.ververst, periodenoot };
}
// Wat de buurtinfo toont (besluit van de eigenaar van 18-10-2026: "niemand moet weten als er iets faalt, de
// momentopname blijft wel goed"). Is een laag niet actueel (`gedeeltelijk`) of de radar ouder dan 26 uur
// (`verouderd`), dan gewoon de laatste goede stand, met dezelfde zin en dezelfde getallen; de status blijft intern.
// Zonder bruikbare radar (`onbeschikbaar`): leeg, zonder zin en zonder getallen.
export function radarToestand(info) {
  if (!info || info.status === "onbeschikbaar") return { zin: "", cijfers: false };
  return {
    zin: info.nieuw + info.gewijzigd + info.afgelopen
      ? "Dit zijn waargenomen wijzigingen, niet de werkelijke start- of einddatum van de maatregelen."
      : "Geen wijzigingen geregistreerd in het beschikbare radarvenster; dat zegt niets over bestaande werken.",
    cijfers: true,
  };
}
