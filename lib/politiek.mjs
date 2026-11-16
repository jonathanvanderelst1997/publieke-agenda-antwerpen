// Partijpolitiek herkennen: één lijst voor de kalenderfeeds (lib/kalenderfeed.mjs) en de persberichten van de stad
// (lib/stad-persberichten.mjs). Regel van de eigenaar: op de publieke agenda komt niets van N-VA en geen andere
// politiek. Een openbare zitting van de districtsraad is geen partijpolitiek: die toont de site als "Raad & commissies".
// Puur, zonder imports.

// Dezelfde partijnamen en -domeinen als de Gateway (src/publieke-agenda/afzenders.ts, PARTIJ_NAAM en PARTIJ_ADRES).
export const PARTIJ_NAAM = /\b(n-?va|vlaams belang|cd&v|open ?vld|pvda|ptb|les engag[eé]s)\b/i;
export const PARTIJ_DOMEIN = /(^|\.)(n-?va\.be|vlaamsbelang\.org|vooruit\.org|cdenv\.be|groen\.be|openvld\.be|pvda\.be|ptb\.be|mr\.be|ps\.be|lesengages\.be|ecolo\.be|defi\.eu|voltbelgie\.org|volteuropa\.org)$/i;
// Woorden die alleen over partijpolitiek gaan.
export const POLITIEK_WOORD = /\b(partijcongres|partijbureau|partijavond|partijfeest|verkiezingsdebat|verkiezingsmeeting|verkiezingscampagne|kiescampagne|lijsttrekker\w*|politiek café|politieke partij\w*)\b/i;
