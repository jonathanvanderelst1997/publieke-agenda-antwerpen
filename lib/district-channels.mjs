// De nieuwskanalen van de 9 andere districten van de stad Antwerpen (district Antwerpen zelf zit in
// lib/district-news-parser.mjs). Bron: de districtspagina's en de publieke portaal-API van
// antwerpen.be (/api/portaal/channel/<id>), nagekeken op 2026-09-28. Borsbeek is een district sinds
// 1 januari 2025. Vaste tabel in code: een data-refresh kan geen kanaal of host toevoegen.

function channel(key, label, channelId, slug, postcodes) {
  return Object.freeze({
    key,
    label,
    channelId,
    slug,
    postcodes: Object.freeze([...postcodes]),
    url: `https://www.antwerpen.be/nl/overzicht/${slug}`,
  });
}

export const DISTRICT_CHANNELS = Object.freeze([
  channel("berchem", "Berchem", "535a1b88e8f17c8415000009", "district-berchem-1", ["2600"]),
  channel("berendrecht-zandvliet-lillo", "Berendrecht-Zandvliet-Lillo", "535a1b9a53ee1fc06300000e", "district-berendrecht-zandvliet-lillo", ["2040"]),
  channel("borgerhout", "Borgerhout", "535a1bdce8f17c841500000a", "district-borgerhout", ["2140"]),
  channel("borsbeek", "Borsbeek", "663891728175964d16d11c40", "district-borsbeek", ["2150"]),
  channel("deurne", "Deurne", "535a1cfe53ee1fc06300000f", "district-deurne-1", ["2100"]),
  channel("ekeren", "Ekeren", "535a1d1ae8f17c841500000b", "district-ekeren-1", ["2180"]),
  channel("hoboken", "Hoboken", "535a1d23e8f17c841500000c", "district-hoboken-1", ["2660"]),
  channel("merksem", "Merksem", "535a1d2fe8f17c841500000d", "district-merksem-1", ["2170"]),
  channel("wilrijk", "Wilrijk", "535a1d39e8f17c841500000e", "district-wilrijk-1", ["2610"]),
]);

export function channelApiUrl(channelId,{start=0,limit=25}={}) {
  const params=new URLSearchParams({contentType:"10",start:String(start),limit:String(limit)});
  return `https://www.antwerpen.be/api/portaal/channel/${channelId}?${params}`;
}

// De terugvallocatie als een artikel zelf geen plaats noemt: eerlijk over wat we weten.
export function fallbackLocationFor(channelEntry) {
  return { location: `District ${channelEntry.label}, locatie via de officiële bron`, postcodes: [...channelEntry.postcodes] };
}
