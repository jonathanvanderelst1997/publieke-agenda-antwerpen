// Restpunten uit de hertest van de samenvoeging (claude/agenda-integratie). Elke toets faalt op main
// en slaagt hier. Alle gegevens zijn verzonnen (Proefstraat, Voorbeeldlaan ...).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { KIND_GROUPS } from "../site/place-core.js";

const css = (naam) => fs.readFileSync(new URL(`../site/${naam}`, import.meta.url), "utf8");

// ---------- 2. contrast van het getal op de onderwerpchips ----------
// Een kleine rekenaar voor de CSS-variabelen van agenda-uitgaan.css en de chipregels van place-view.css:
// var() met terugval, color-mix(in srgb, ...) en #hex met alfa (over de chipkleur gelegd).
const uitgaan = css("agenda-uitgaan.css"), plek = css("place-view.css");
const blok = (tekst, kop) => {
  const i = tekst.indexOf(kop);
  assert.ok(i >= 0, `regel ${kop} ontbreekt`);
  const s = tekst.indexOf("{", i);
  return tekst.slice(s + 1, tekst.indexOf("}", s));
};
const declaraties = (tekst) => Object.fromEntries([...tekst.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const regel = (sel) => {
  const m = plek.match(new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `regel ${sel} ontbreekt in place-view.css`);
  return declaraties(m[1]);
};
function kleur(waarde, vars) {
  const v = String(waarde).trim();
  const vm = v.match(/^var\((--[\w-]+)(?:,\s*(.+))?\)$/);
  if (vm) return vars[vm[1]] !== undefined ? kleur(vars[vm[1]], vars) : kleur(vm[2], vars);
  const mix = v.match(/^color-mix\(in srgb,\s*(.+?)\s+(\d+)%,\s*(.+)\)$/);
  if (mix) {
    const a = kleur(mix[1], vars), b = kleur(mix[3], vars), p = Number(mix[2]) / 100;
    return [0, 1, 2].map((i) => a[i] * p + b[i] * (1 - p)).concat(1);
  }
  const h = v.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  assert.ok(h, `kleur niet te lezen: ${v}`);
  const lang = h.length <= 4 ? [...h].map((c) => c + c).join("") : h;
  const [r, g, b, a = 255] = lang.match(/../g).map((x) => parseInt(x, 16));
  return [r, g, b, a / 255];
}
const over = (voor, achter) => [0, 1, 2].map((i) => voor[i] * voor[3] + achter[i] * (1 - voor[3])).concat(1);
const lum = (c) => {
  const k = c.slice(0, 3).map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("2. het getal op een onderwerpchip haalt minstens 4,5:1, voor elke soort, gekozen of niet, licht en donker", () => {
  const thema = {
    licht: declaraties(blok(uitgaan, ":root {")),
    donker: { ...declaraties(blok(uitgaan, ":root {")), ...declaraties(blok(uitgaan, ':root[data-theme="dark"] {')) },
  };
  const catDonker = declaraties(blok(uitgaan, ':root[data-theme="dark"] :is([class*="cat-"]) {'));
  const chip = regel(".pv-chip"), gekozen = regel('.pv-chip[aria-pressed="true"]'), nul = regel('.pv-chip-zero[aria-pressed="true"]');
  const getal = regel(".pv-chip-n"), getalNul = regel('.pv-chip-zero[aria-pressed="true"] .pv-chip-n'), getalUit = regel('.pv-chip[aria-pressed="false"] .pv-chip-n');
  const uitkomsten = [];
  for (const g of KIND_GROUPS) {
    for (const [naam, basis] of Object.entries(thema)) {
      const vars = { ...basis, ...declaraties(blok(uitgaan, `.cat-${g.cat} {`)), ...(naam === "donker" ? catDonker : {}) };
      const pagina = kleur(vars["--pa-bg"], vars);
      // De kleur van het getal hangt niet af van het aantal cijfers: ook "7" moet dit halen.
      const staten = {
        gekozen: [gekozen, getal], "gekozen, 0": [nul, getalNul], "niet gekozen": [chip, getalUit],
      };
      for (const [staat, [c, n]] of Object.entries(staten)) {
        const chipAchter = over(kleur(c.background, vars), pagina);
        const achter = over(kleur(n.background, vars), chipAchter);
        const voor = kleur(n.color || c.color, vars);
        const r = contrast(voor, achter);
        uitkomsten.push(`${g.key} ${naam} ${staat}: ${r.toFixed(2)}`);
        assert.ok(r >= 4.5, `${g.label}, ${naam}, ${staat}: ${r.toFixed(2)}:1 (minstens 4,5:1)`);
      }
    }
  }
  assert.equal(uitkomsten.length, KIND_GROUPS.length * 2 * 3);
});

// ---------- 3. privacy: een reeks huisnummers is nooit één huisnummer ----------
// De hertest zag "Proefstraat nr. 13" op een kaart, terwijl de beheerder "13 tem 15" schreef. Regel, zoals
// elders op de site: één los huisnummer kan een woning zijn en valt weg (alleen de straat); een reeks
// blijft als reeks, in elke schrijfwijze. Ook de regel "Volgens de beheerder" toont geen adressen.
test("3. een reeks huisnummers in elke schrijfwijze wordt een reeks; één los nummer valt weg, alleen de straat", async () => {
  const ku = await import("../site/kaart-uitleg.js");
  const werk = (title) => ({
    gipodId: 90000901, title, status: "In uitvoering", start: "2026-05-02T05:00:00Z", end: "2026-11-02T16:00:00Z",
    owner: "Voorbeeldnet", ownerGroup: "Andere", workTypes: [], occupancyTypes: ["Telecom"],
    streets: [{ id: "1", name: "Proefstraat", postcode: "2018" }], hindrance: null,
  });
  const kaart = (title) => ku.werkKaartje(werk(title), { vandaag: "2026-10-10" });
  const waar = (k) => Object.fromEntries(k.regels).Waar;
  for (const reeks of ["13 tem 15", "13 t.e.m. 15", "13 tot en met 15", "13 t/m 15", "13 tot 15", "13-15", "13 – 15", "13 → 15", "13 en 15"]) {
    const k = kaart(`2018 Antwerpen - (Antwerpen) - Proefstraat ${reeks}. Voorbeeldplein 70 tem Voorbeeldstraat 2. Doorsteek Voorbeeldlaan. Voorbeeldstraat 48. - werken aan nutsleiding - 109m.`);
    assert.match(k.titel, /in de Proefstraat nr\. 13–15 tot 2 november/, reeks);
    assert.match(waar(k), /^Proefstraat, nr\. 13–15 \(omschrijving van de beheerder\)$/, reeks);
    assert.doesNotMatch([k.titel, k.samenvatting, waar(k)].join(" "), /nr\. 13(?!–)|Voorbeeldstraat \d|Voorbeeldplein \d/, reeks);
  }
  // Een opsomming wordt de hele reeks.
  assert.match(kaart("Proefstraat 13, 15 en 17 - werken aan nutsleiding").titel, /Proefstraat nr\. 13–17 /);
  // Eén los huisnummer: alleen de straat, en de kaart zegt waarom.
  const los = kaart("2018 Antwerpen - Proefstraat 12 - werken aan nutsleiding");
  assert.doesNotMatch([los.titel, los.samenvatting, waar(los)].join(" "), /nr\. 12|\b12\b/);
  assert.match(waar(los), /^Proefstraat \(huisnummer weggelaten: één adres kan een woning zijn\)$/);
  // Ook een los nummer uit het adressenregister of uit een oudere verversing wordt niet bewaard of getoond.
  assert.equal(ku.werkFeiten(werk("Werk in openbaar domein"), { huisnummers: "nr. 8", huisnummerBron: "register" }).huisnummers, "");
  assert.equal(ku.werkFeiten(werk("Werk in openbaar domein"), { huisnummers: "nr. 8–14", huisnummerBron: "register" }).huisnummers, "nr. 8–14");
  // Een getal na een komma dat geen huisnummer is, maakt geen reeks; een postcode ook niet.
  assert.equal(ku.huisnummersUitTekst("Proefstraat 12, 3 dagen", "Proefstraat"), "nr. 12");
  assert.equal(ku.huisnummersUitTekst("Proefstraat 13, 2000 Antwerpen", "Proefstraat"), "nr. 13");
});
