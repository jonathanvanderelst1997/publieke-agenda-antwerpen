// Interne dekkingsmeter voor de publieke agenda. Toont wat de bronnen nu kennen,
// niet of een maand volledig is. Geen netwerk, opslag, persoonsdata of publicatie.
const ISO_DAG = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

function geldigeDag(value) {
  if (typeof value !== "string" || !ISO_DAG.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function maandOp(start, offset) {
  const year = Number(start.slice(0, 4));
  const month = Number(start.slice(5, 7));
  return new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 7);
}

// Meerdaagse evenementen tellen in elke maand waarin ze actief zijn. Weekmarkten
// tellen apart zodat honderden marktdagen de gaten in het activiteitenaanbod niet maskeren.
export function meetVooruitblikPerMaand(items, peildag, aantalMaanden = 12) {
  if (!geldigeDag(peildag) || !Number.isInteger(aantalMaanden) || aantalMaanden < 1 || aantalMaanden > 24) {
    return { peildag, maanden: [] };
  }
  const maanden = Array.from({ length: aantalMaanden }, (_, i) => ({
    maand: maandOp(peildag, i), totaal: 0, zonderMarkten: 0,
    district: 0, stad: 0, bronnen: 0,
  }));
  const perMaandBronnen = maanden.map(() => new Set());
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || !geldigeDag(item.date)) continue;
    const eind = item.endDate ?? item.date;
    if (!geldigeDag(eind) || eind < item.date || eind < peildag) continue;
    for (let i = 0; i < maanden.length; i += 1) {
      const startMaand = `${maanden[i].maand}-01`;
      const volgendeMaand = `${maandOp(peildag, i + 1)}-01`;
      if (item.date >= volgendeMaand || eind < startMaand) continue;
      maanden[i].totaal += 1;
      if (item.sourceId !== "stad-markten") maanden[i].zonderMarkten += 1;
      if (item.scope === "district") maanden[i].district += 1;
      if (item.scope === "stad") maanden[i].stad += 1;
      if (typeof item.sourceId === "string" && item.sourceId) perMaandBronnen[i].add(item.sourceId);
    }
  }
  for (let i = 0; i < maanden.length; i += 1) maanden[i].bronnen = perMaandBronnen[i].size;
  return { peildag, maanden };
}
