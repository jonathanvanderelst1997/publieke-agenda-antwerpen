// Zwaar rekenwerk in stappen. Het werk is een generator die na elk stuk (bv. één feature) `yield`
// doet:
// - voerUit draait alles in één keer (node, toetsen, de dataverversing);
// - voerUitInStappen geeft in de browser na ongeveer `budgetMs` de pagina even lucht, zodat tikken
//   en scrollen blijven werken terwijl duizenden A-Sign-features verwerkt worden. Het resultaat is
//   precies hetzelfde.
export function voerUit(werk) {
  let stap = werk.next();
  while (!stap.done) stap = werk.next();
  return stap.value;
}

const vrijgeven = () => (typeof globalThis.scheduler?.yield === "function"
  ? globalThis.scheduler.yield()
  : new Promise((ok) => setTimeout(ok, 0)));

export async function voerUitInStappen(werk, { budgetMs = 40, pauze = vrijgeven, nu = () => performance.now() } = {}) {
  let start = nu();
  let stap = werk.next();
  while (!stap.done) {
    if (nu() - start >= budgetMs) {
      await pauze();
      start = nu();
    }
    stap = werk.next();
  }
  return stap.value;
}
