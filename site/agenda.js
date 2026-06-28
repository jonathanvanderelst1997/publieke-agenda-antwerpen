const agendaItems = [
  {
    id: "fasewissel-balansstraat",
    title: "Fasewissel heraanleg Balansstraat en Lange Elzenstraat",
    theme: "Werken",
    className: "works",
    date: "2026-06-28",
    dateLabel: "18 mei 2026, tot planning loopt door tot 2027",
    timeSlot: "Uur volgt",
    timeText: "",
    location: "Balansstraat, Lange Elzenstraat, Kielsevest en Desguinlei",
    info: "Fasewissel in de werfzone. Bekijk de publieke werkenpagina voor actuele fasering en hinder.",
    link: "https://www.antwerpen.be/nl/overzicht/district-antwerpen-1/openbare-werken",
  },
  {
    id: "kammenstraat-autovrij",
    title: "Kammenstraat autovrij tijdens soldenperiode",
    theme: "Werken",
    className: "works",
    date: "2026-06-28",
    dateLabel: "26 juni 2026, tot 13 juli 2026",
    timeSlot: "Uur volgt",
    timeText: "",
    location: "Kammenstraat en omliggende straten",
    info:
      "Kammenstraat is autovrij tijdens de soldenperiode. Laden en lossen kan na 19 uur en voor 11 uur. Raadpleeg Slim naar Antwerpen voor actuele bereikbaarheid.",
    link: "https://www.slimnaarantwerpen.be/",
  },
  {
    id: "gaston-burssenslaan-hanegraefstraat",
    title: "Nieuwe fase heraanleg Gaston Burssenslaan en Hanegraefstraat",
    theme: "Werken",
    className: "works",
    date: "2026-06-28",
    dateLabel: "week van 20 april 2026, tot bouwverlof juli 2026",
    timeSlot: "Uur volgt",
    timeText: "",
    location: "Gaston Burssenslaan, Hanegraefstraat en Waterhoenlaan",
    info: "De laatste fase loopt langer. Bekijk de publieke werkenpagina voor de actuele timing.",
    link: "https://www.antwerpen.be/nl/overzicht/district-antwerpen-1/openbare-werken",
  },
  {
    id: "schoolstraat-lange-ridderstraat",
    title: "Bevraging proefperiode schoolstraat Lange Ridderstraat",
    theme: "Werken",
    className: "works",
    date: "2026-06-28",
    dateLabel: "1 juni 2026, tot 28 juni 2026",
    timeSlot: "Uur volgt",
    timeText: "",
    location: "Lange Ridderstraat",
    info: "Ouders en buurtbewoners kunnen tot en met 28 juni 2026 feedback geven over de proefperiode van de schoolstraat.",
    link: "https://antwerpen.be/publiekeruimte",
  },
  {
    id: "halenstraat-schijnpoortweg",
    title: "Werken Halenstraat en Schijnpoortweg",
    theme: "Werken",
    className: "works",
    date: "2026-06-28",
    dateLabel: "20 april 2026, tot april 2027",
    timeSlot: "Uur volgt",
    timeText: "",
    location: "Halenstraat en Schijnpoortweg",
    info: "Langlopende werken tot april 2027. Bekijk de publieke werkenpagina voor actuele hinder en planning.",
    link: "https://www.antwerpen.be/nl/overzicht/district-antwerpen-1/openbare-werken",
  },
  {
    id: "antwerpen-danst",
    title: "Antwerpen Danst",
    theme: "Activiteit",
    className: "activity",
    date: "2026-06-30",
    dateLabel: "30 juni 2026, tot 27 augustus 2026",
    timeSlot: "18:30",
    timeText: "elke dinsdag 18.30 tot 20 uur en donderdag 20 tot 21.30 uur",
    location: "Waagnatie, Rijnkaai",
    info: "Gratis dansinitiaties in de Waagnatie, telkens op dinsdag en donderdag in juli en augustus.",
    link: "https://antwerpendanst.life/",
  },
  {
    id: "zomer-mee-harmoniepark",
    title: "Zomer Mee in Harmoniepark",
    theme: "Sport",
    className: "sport",
    date: "2026-07-01",
    dateLabel: "1 juli 2026",
    timeSlot: "13:00",
    timeText: "13 tot 17 uur",
    location: "Harmoniepark",
    info: "Gratis namiddag met sport, spel en zomeractiviteiten in het Harmoniepark.",
    link: "https://www.antwerpen.be/info/68107cf3eb02357caa7042e2/zomer-mee-in-het-harmoniepark",
  },
  {
    id: "15-van-het-galgenweel",
    title: "15 van het Galgenweel",
    theme: "Sport",
    className: "sport",
    date: "2026-07-05",
    dateLabel: "5 juli 2026",
    timeSlot: "11:00",
    timeText: "gezamenlijke start 11 uur; kidsrun start 15 uur",
    location: "Galgenweel, Linkeroever",
    info: "Loop rond het Galgenweel. Je kiest zelf hoeveel rondes je loopt; de ultieme afstand is 15 rondes van ongeveer 3,6 km.",
    link: "https://kraftmanchronotiming.be/15galgenweel-2/",
  },
  {
    id: "boogschieten-nachtegalenpark",
    title: "Gratis initiaties boogschieten",
    theme: "Activiteit",
    className: "activity",
    date: "2026-07-05",
    dateLabel: "5 juli 2026, tot 20 september 2026",
    timeSlot: "14:00",
    timeText: "zondagen vanaf 14 uur",
    location: "Nachtegalenpark, Floralienlaan",
    info: "Gratis initiaties boogschieten op meerdere zondagen in de zomer.",
    link: "https://nieuwsbrief.antwerpen.be/t/j-e-ydkthktd-hhtjvijdl-r/",
  },
  {
    id: "reanimatielessen",
    title: "Reanimatielessen",
    theme: "Activiteit",
    className: "activity",
    date: "2026-09-01",
    dateLabel: "september 2026",
    timeSlot: "Uur volgt",
    timeText: "",
    location: "District Antwerpen",
    info: "Vormingsmomenten rond reanimatie vanaf september.",
    link: "https://nieuwsbrief.antwerpen.be/t/j-e-ydhyiln-hhtjvijdl-r/",
  },
];

const themeOrder = ["Werken", "Sport", "Activiteit"];
let enabledThemes = new Set(themeOrder);
let openId = "";

function formatDateTitle(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("nl-BE", { weekday: "long", day: "numeric", month: "long" }).format(
    new Date(year, month - 1, day)
  );
}

function formatDateSummary(iso, count) {
  const [year, month, day] = iso.split("-").map(Number);
  const label = new Intl.DateTimeFormat("nl-BE", { month: "short" }).format(new Date(year, month - 1, day));
  return `${day} ${label} - ${count} punt${count === 1 ? "" : "en"}`;
}

function byDate(items) {
  return items.reduce((groups, item) => {
    groups[item.date] = [...(groups[item.date] || []), item];
    return groups;
  }, {});
}

function renderControls() {
  const root = document.getElementById("theme-controls");
  root.innerHTML = "";

  const allActive = themeOrder.every((theme) => enabledThemes.has(theme));
  const allButton = document.createElement("button");
  allButton.type = "button";
  allButton.className = allActive ? "active" : "";
  allButton.textContent = allActive ? "Alles uit" : "Alles aan";
  allButton.addEventListener("click", () => {
    enabledThemes = allActive ? new Set() : new Set(themeOrder);
    render();
  });
  root.appendChild(allButton);

  themeOrder.forEach((theme) => {
    const sample = agendaItems.find((item) => item.theme === theme);
    const button = document.createElement("button");
    button.type = "button";
    button.className = enabledThemes.has(theme) ? "active" : "";
    button.innerHTML = `<span class="theme-dot" style="--accent: ${accentForClass(sample?.className || "activity")}"></span>${theme}`;
    button.addEventListener("click", () => {
      if (enabledThemes.has(theme)) {
        enabledThemes.delete(theme);
      } else {
        enabledThemes.add(theme);
      }
      render();
    });
    root.appendChild(button);
  });
}

function accentForClass(className) {
  if (className === "works") return "#1f7a5a";
  if (className === "sport") return "#6c5a9b";
  return "#246b9f";
}

function eventTemplate(item) {
  const open = openId === item.id;
  return `
    <article class="event ${item.className} ${open ? "open" : ""}" id="${item.id}">
      <div class="time">
        <strong>${item.timeSlot}</strong>
        ${item.timeText ? `<span>${item.timeText}</span>` : ""}
      </div>
      <div class="event-card">
        <button type="button" class="event-toggle" data-id="${item.id}" aria-expanded="${open ? "true" : "false"}">
          <span class="theme-label">${item.theme}</span>
          <strong>${item.title}</strong>
          <span class="chevron">${open ? "^" : "v"}</span>
        </button>
        <div class="meta">
          ${item.location ? `<span>${item.location}</span>` : ""}
          ${item.dateLabel ? `<span>${item.dateLabel}</span>` : ""}
        </div>
        <div class="details">
          <p>${item.info}</p>
          <dl>
            <div><dt>Wanneer</dt><dd>${item.dateLabel}</dd></div>
            ${item.timeText ? `<div><dt>Uur</dt><dd>${item.timeText}</dd></div>` : ""}
            ${item.location ? `<div><dt>Waar</dt><dd>${item.location}</dd></div>` : ""}
          </dl>
          ${item.link ? `<a href="${item.link}" target="_blank" rel="noreferrer">Meer info</a>` : ""}
        </div>
      </div>
    </article>
  `;
}

function renderList(items) {
  const root = document.getElementById("agenda-list");
  if (!items.length) {
    root.innerHTML = `<p class="empty">Geen actuele agenda-items binnen deze filter.</p>`;
    return;
  }

  const groups = byDate(items);
  root.innerHTML = Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dateItems]) => `
      <section class="day-block">
        <header>
          <h2>${formatDateTitle(date)}</h2>
          <p>${formatDateSummary(date, dateItems.length)}</p>
        </header>
        <div class="event-list">
          ${dateItems
            .sort((a, b) => a.timeSlot.localeCompare(b.timeSlot) || a.title.localeCompare(b.title))
            .map(eventTemplate)
            .join("")}
        </div>
      </section>
    `)
    .join("");

  root.querySelectorAll(".event-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.id;
      openId = openId === id ? "" : id;
      render();
      document.getElementById(id)?.scrollIntoView({ block: "nearest" });
    });
  });
}

function renderCounts(items) {
  document.getElementById("agenda-count-value").textContent = String(items.length);
  const works = items.filter((item) => item.theme === "Werken").length;
  const other = items.length - works;
  document.getElementById("agenda-count-detail").textContent = `${other} activiteiten/sport, ${works} werken.`;
}

function render() {
  const visible = agendaItems.filter((item) => enabledThemes.has(item.theme));
  renderControls();
  renderCounts(visible);
  renderList(visible);
}

render();
