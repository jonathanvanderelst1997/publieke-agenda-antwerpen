import assert from "node:assert/strict";
import test from "node:test";

import { mergeEvents, mergeKey } from "../lib/merge-events.mjs";

const base = {
  title: "Familiedag in Permeke",
  theme: "Activiteit",
  className: "activity",
  date: "2026-10-18",
  endDate: null,
  timeSlot: "11:00",
  timeText: "11 tot 16 uur",
  location: "Bib Permeke",
  postcodes: ["2060"],
  info: "",
  kind: "activity",
  reviewRequired: false,
};

const item = (id, fields = {}) => ({
  ...base,
  id,
  externalId: id,
  sourceUrl: `https://www.antwerpen.be/info/${id}`,
  retrievedAt: "2026-09-28T05:00:00.000Z",
  ...fields,
});

test("voorrang: district-kalender > district-nieuws > stad-uit > mail-district > mail-stad; alle links blijven", () => {
  const { items } = mergeEvents({
    "mail-stad": { scope: "stad", items: [item("mail-stad-1", { title: "familiedag in permeke" })] },
    "stad-uit": { scope: "stad", items: [item("uit-1", { sourceUrl: "https://www.uitinvlaanderen.be/agenda/e/x/1", inDistrict: true, noEventPage: true })] },
    "district-nieuws": { scope: "district", items: [item("news-1", { title: "Familiedag  in  Permeke" })] },
    "district-kalender": { scope: "district", items: [item("kal-1")] },
    "mail-district": { scope: "district", items: [item("mail-district-1")] },
  });
  assert.equal(items.length, 1);
  const [merged] = items;
  assert.equal(merged.id, "kal-1");
  assert.equal(merged.sourceId, "district-kalender");
  assert.equal(merged.scope, "district");
  assert.equal(merged.inDistrict, true);
  assert.equal(merged.link, "https://www.antwerpen.be/info/kal-1");
  assert.equal(merged.reviewRequired, undefined);
  assert.deepEqual(
    merged.sources.map((source) => source.sourceId),
    ["district-kalender", "district-nieuws", "stad-uit", "mail-district", "mail-stad"]
  );
  assert.deepEqual(
    merged.sources.map((source) => source.url),
    [
      "https://www.antwerpen.be/info/kal-1",
      "https://www.antwerpen.be/info/news-1",
      "https://www.uitinvlaanderen.be/agenda/e/x/1",
      "https://www.antwerpen.be/info/mail-district-1",
      "https://www.antwerpen.be/info/mail-stad-1",
    ]
  );
  assert.ok(merged.sources.every((source) => source.retrievedAt === "2026-09-28T05:00:00.000Z" && ["district", "stad"].includes(source.scope)));
});

test("een stad-item wordt district zodra een districtsbron bijdraagt; alleen stad blijft stad", () => {
  const onlyCity = mergeEvents({ "stad-uit": { scope: "stad", items: [item("uit-2", { inDistrict: false })] } }).items[0];
  assert.equal(onlyCity.scope, "stad");
  assert.equal(onlyCity.inDistrict, false);
  const mixed = mergeEvents({
    "stad-uit": { scope: "stad", items: [item("uit-3")] },
    "mail-district": { scope: "district", items: [item("mail-3")] },
  }).items[0];
  assert.equal(mixed.sourceId, "stad-uit");
  assert.equal(mixed.scope, "district");
});

test("zelfde sleutel maar verschillende, niet-lege postcodes: niet samengevoegd", () => {
  const { items } = mergeEvents({
    "district-kalender": { scope: "district", items: [item("kal-4", { postcodes: ["2000"], location: "Groenplaats" })] },
    "stad-uit": { scope: "stad", items: [item("uit-4", { postcodes: ["2100"], location: "Deurne" })] },
  });
  assert.equal(items.length, 2);
  // Zonder postcodes aan één kant is er geen conflict.
  const loose = mergeEvents({
    "district-kalender": { scope: "district", items: [item("kal-5", { postcodes: ["2000"] })] },
    "mail-stad": { scope: "stad", items: [item("mail-5", { postcodes: [] })] },
  });
  assert.equal(loose.items.length, 1);
});

test("een ander uur of een onbekend uur is een andere sleutel", () => {
  assert.notEqual(mergeKey(item("a")), mergeKey(item("b", { timeSlot: "14:00" })));
  assert.equal(mergeKey(item("c", { timeSlot: "Info" })), mergeKey(item("d", { timeSlot: "Uur volgt" })));
  assert.match(mergeKey(item("e", { timeSlot: "Info" })), /\|unknown$/);
});

test("een feed-item vervangt een handmatig item: hand-id in supersedes", () => {
  const hand = [
    { id: "familiedag-in-permeke-2026-10-18", title: "Familiedag in Permeke", date: "2026-10-18", timeSlot: "11:00", location: "Permeke" },
    { id: "iets-anders-2026-10-18", title: "Iets anders", date: "2026-10-18", timeSlot: "11:00" },
    { id: "familiedag-conflict", title: "Familiedag in Permeke", date: "2026-10-18", timeSlot: "11:00", postcodes: ["2000"] },
  ];
  const { items, supersedes } = mergeEvents({ "district-kalender": { scope: "district", items: [item("kal-6")] } }, hand);
  assert.equal(items.length, 1);
  assert.deepEqual(supersedes, ["familiedag-in-permeke-2026-10-18"]);
});

test("dezelfde detailpagina of een titel die volledig in de andere staat: samengevoegd", () => {
  const { items } = mergeEvents({
    "district-kalender": {
      scope: "district",
      items: [
        item("kal-7", { title: "Halloween", date: "2026-10-31", timeSlot: "14:00", infoUrl: "https://www.antwerpen.be/nl/overzicht/district-antwerpen-1/jeugd/griezelfeest-bij-co-nova-op-halloween" }),
        item("kal-8", { title: "Verlangen naar verbinding", date: "2026-11-10", timeSlot: "14:00" }),
      ],
    },
    "district-nieuws": {
      scope: "district",
      items: [
        item("news-7", { title: "Griezelfeest bij CO Nova op Halloween", date: "2026-10-31", timeSlot: "14:00", sourceUrl: "https://www.antwerpen.be/info/6aa2b79da7e511fc8d43f114/griezelfeest-bij-co-nova-op-halloween" }),
        item("news-8", { title: "Voorstelling verlangen naar verbinding op 10 november", date: "2026-11-10", timeSlot: "14:00" }),
      ],
    },
  });
  assert.deepEqual(items.map((merged) => [merged.id, merged.sources.length]), [["kal-7", 2], ["kal-8", 2]]);
});

test("de uitvoer is deterministisch, ongeacht de volgorde van de invoer", () => {
  const sources = {
    "district-kalender": { scope: "district", items: [item("kal-9", { date: "2026-10-20" }), item("kal-10", { date: "2026-10-19", title: "Ander" })] },
    "stad-uit": { scope: "stad", items: [item("uit-9", { date: "2026-10-19", title: "Nog iets", timeSlot: "09:00", postcodes: ["2100"] })] },
  };
  const reversed = Object.fromEntries(
    Object.entries(sources)
      .reverse()
      .map(([key, value]) => [key, { ...value, items: [...value.items].reverse() }])
  );
  assert.deepEqual(mergeEvents(sources), mergeEvents(reversed));
  assert.deepEqual(mergeEvents(sources).items.map((merged) => merged.id), ["uit-9", "kal-10", "kal-9"]);
});

test("sameAs: een evenementendossier (district-asign-evenementen) wordt één item met het punt uit de kalender, ook bij een andere postcode", () => {
  const dossier = item("asign-ev-et2099000001-2026-10-18", {
    title: "Evenement in de Proefstraat — naam volgt",
    timeSlot: "Info",
    timeText: "",
    location: "Proefstraat en Voorbeeldlaan",
    postcodes: ["2000"],
    sourceUrl: "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/22",
    fasen: [{ naam: "Evenement", start: "2026-10-18", eind: "2026-10-18" }],
    straten: ["Proefstraat", "Voorbeeldlaan"],
    sameAs: ["kal-30"],
  });
  const buur = item("asign-ev-et2099000002-2026-10-18", { title: "Evenement in de Verre Straat — naam volgt", timeSlot: "Info", location: "Verre Straat", postcodes: ["2060"], sourceUrl: dossier.sourceUrl });
  const { items } = mergeEvents({
    "district-asign-evenementen": { scope: "district", items: [dossier, buur] },
    "district-kalender": { scope: "district", items: [item("kal-30", { title: "Proefcriterium", postcodes: ["2050"] })] },
  });
  assert.deepEqual(items.map((merged) => merged.id), ["kal-30", "asign-ev-et2099000002-2026-10-18"]);
  const [merged] = items;
  assert.equal(merged.title, "Proefcriterium");
  assert.deepEqual(merged.sources.map((source) => source.sourceId), ["district-kalender", "district-asign-evenementen"]);
  assert.deepEqual(merged.straten, ["Proefstraat", "Voorbeeldlaan"]);
  assert.deepEqual(merged.fasen, [{ naam: "Evenement", start: "2026-10-18", eind: "2026-10-18" }]);
  assert.equal("sameAs" in merged, false);
  assert.equal(items[1].sources.length, 1, "zonder sameAs, andere titel en andere straat: apart");
});

test("sameAs werkt in beide richtingen en de dossiers gaan vóór de besluiten van eBesluit", () => {
  const besluit = item("ebesluit-ev-2099-cbs-00001-2026-10-18", { title: "Proeffeest", sourceUrl: "https://ebesluit.antwerpen.be/zittingen/1/agendapunten/2" });
  const dossier = item("asign-ev-et2099000003-2026-10-18", { title: "Proeffeest", timeSlot: "Info", sourceUrl: "https://geodata.antwerpen.be/arcgissql/rest/services/P_ASign/ASign/MapServer/22", sameAs: [besluit.id] });
  const { items } = mergeEvents({
    "district-ebesluit-evenementen": { scope: "district", items: [besluit] },
    "district-asign-evenementen": { scope: "district", items: [dossier] },
  });
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].sources.map((source) => source.sourceId), ["district-asign-evenementen", "district-ebesluit-evenementen"]);
});
