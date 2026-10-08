// Beschrijft de werkelijke actie van de knop Alle onderwerpen.
// Een gekozen straat start met alle soorten; zonder straat betekent terugkeer naar de uitgaansselectie.
export function allesFilterActie(aantalActief, totaal, gekozenPlek) {
  if (aantalActief < totaal) return "Alle onderwerpen tonen";
  return gekozenPlek ? "Alle onderwerpen verbergen" : "Terug naar uitgaan";
}
