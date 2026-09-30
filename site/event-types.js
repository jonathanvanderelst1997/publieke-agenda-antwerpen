(function(root){
  const clean=v=>String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();
  const TYPES=Object.freeze([
    {key:"neighborhood",label:"Buurt & straat"},{key:"playstreet",label:"Speelstraat"},
    {key:"market_fair",label:"Markt & foor"},{key:"flea_braderie",label:"Rommelmarkt & braderie"},
    {key:"parade",label:"Stoet & processie"},{key:"demonstration",label:"Manifestatie & betoging"},
    {key:"sport",label:"Sport"},{key:"learning",label:"Workshop & vorming"},
    {key:"social",label:"Ontmoeting & welzijn"},{key:"green_action",label:"Groen & buurtactie"},
    {key:"culture",label:"Cultuur & festival"},{key:"participation",label:"Participatie & info"},
    {key:"public_meeting",label:"Openbare raad/commissie"},{key:"shopping",label:"Koopzondag"},
    {key:"family",label:"Familie & feest"},{key:"commemoration",label:"Herdenking & viering"},
    {key:"other",label:"Overig"}
  ].map(Object.freeze));
  const LABELS=Object.freeze(Object.fromEntries(TYPES.map(x=>[x.key,x.label])));
  const text=i=>clean([i?.title,i?.info,i?.location,i?.kind,i?.theme].filter(Boolean).join(" · "));
  const has=(v,r)=>r.test(v);
  function classifyEventType(i={}){
    const s=String(i.sourceId||""),v=text(i);
    if(s==="district-vergaderingen"||has(v,/\b(districtsraad|raadscommissie|gemeenteraad|openbare vergadering|openbare zitting)\b/))return"public_meeting";
    if(has(v,/\bspeelstraat\b/))return"playstreet";
    if(has(v,/\b(buurtfeest|wijkfeest|straatfeest|pleinfeest|burenfeest|buurt\s*barbecue|straat\s*barbecue|buurt\s*picknick|buren\s*picknick|straat\s*picknick)\b/))return"neighborhood";
    if(s==="stad-koopzondagen"||has(v,/\bkoopzondag\b/))return"shopping";
    if(has(v,/\b(rommelmarkt|vlooienmarkt|garageverkoop|garagesale|braderie|brocante|brocantemarkt)\b/))return"flea_braderie";
    if(has(v,/\b(stoet|optocht|processie|parade|carnaval(?:stoet)?)\b/))return"parade";
    if(has(v,/\b(betoging|protest(?:actie)?|manifestatie|staking|vakbondsactie|klimaatmars|vredesmars)\b/))return"demonstration";
    if(i.theme==="Sport"||has(v,/\b(sport|wedstrijd|criterium|stratenloop|loopwedstrijd|fietstocht|wieler|voetbal|basketbal|tennis|zwem)\b/))return"sport";
    if(has(v,/\b(workshop|vorming|cursus|infosessie|tabletcafe|tabletcafé)\b/))return"learning";
    if(has(v,/\b(praatcafe|praatcafé|seniorenklap|dementiecafe|dementiecafé|ontmoetingsmoment|koffieklets)\b/))return"social";
    if(has(v,/\b(vergroen(?:ing)?|groeidag|plantactie|boomplant(?:actie)?|opruimactie|zwerfvuilactie|buurtgroen)\b/))return"green_action";
    if(has(v,/\b(participatie|inspraak|infomoment|infoavond|wijkoverleg|bewonersvergadering|hoorzitting|burgerbegroting|buurtmoment|vliegend college)\b/))return"participation";
    if(has(v,/\b(herdenking|herdenkings|plechtigheid|viering)\b/))return"commemoration";
    if(has(v,/\b(sinterklaas|halloween|familiedag|familiefeest|kinderfeest|paasfeest|kerstfeest|winterfeest|bingo)\b/))return"family";
    if(has(v,/\b(?:[a-z0-9-]*(?:festival|concert|theater|expo|tentoonstelling|kunstendag)|circus|film|dans|muziek|kunst|lezing|literatuur|poezie|poëzie|dichter|auteur|voorstelling)\b/))return"culture";
    if(s==="stad-markten"||has(v,/\b(markt|jaarmarkt|kerstmarkt|kermis|foor)\b/))return"market_fair";
    return"other";
  }
  root.PublicAgendaEventTypes=Object.freeze({types:TYPES,labels:LABELS,classifyEventType,labelFor:k=>LABELS[k]||LABELS.other});
})(typeof window!=="undefined"?window:globalThis);
