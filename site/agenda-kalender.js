// De knoppen "Kopieer link" op /kalender/ (site/kalender/index.html). Zonder JavaScript blijven ze verborgen: de link van
// de hoofdagenda staat dan in het tekstvak, en "Volg" werkt zonder.
(function kopieerKnoppen() {
  const MELDING_MS = 2500;

  async function kopieer(link) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(link);
      return true;
    }
    return false;
  }

  for (const knop of document.querySelectorAll("[data-kalender-kopieer]")) {
    const link = knop.getAttribute("data-kalender-kopieer") || "";
    if (!/^https:\/\/[^\s"'<>]+\.ics$/.test(link)) continue;
    const tekst = knop.textContent;
    knop.hidden = false;
    knop.addEventListener("click", async () => {
      let gelukt = false;
      try {
        gelukt = await kopieer(link);
      } catch {
        gelukt = false;
      }
      if (!gelukt) {
        // Geen klembord (een oude browser of geen toestemming): de link om zelf te kopiëren.
        window.prompt("Kopieer deze link en plak hem in je agenda:", link);
        return;
      }
      knop.textContent = "Gekopieerd";
      knop.classList.add("kalender-gekopieerd");
      window.setTimeout(() => {
        knop.textContent = tekst;
        knop.classList.remove("kalender-gekopieerd");
      }, MELDING_MS);
    });
  }

  // Een tik in het tekstvak selecteert de hele link.
  for (const veld of document.querySelectorAll(".kalender-link input")) {
    veld.addEventListener("focus", () => veld.select());
  }
})();
