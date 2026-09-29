(function(root){
  const clean=value=>String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();
  const TYPES=Object.freeze([
    Object.freeze({key:"neighborhood",label:"Buurt & straat"}),Object.freeze({key:"playstreet",label:"Speelstraat"}),
    Object.freeze({key:"market_fair",label:"Markt & foor"}),Object.freeze({key:"flea_braderie",label:"Rommelmarkt & braderie"}),
    Object.freeze({key:"parade",label:"Stoet & processie"}),Object.freeze({key:"sport",label:"Sport"}),
    Object.freeze({key:"culture",label:"Cultuur & festival"}),Object.freeze({key:"participation",label:"Participatie & info"}),
    Object.freeze({key:"public_meeting",label:"Openbare raad/commissie"}),Object.freeze({key:"shopping",label:"Koopzondag"}),
    Object.freeze({key:"family",label:"Familie & feest"}),Object.freeze({key:"commemoration",label:"Herdenking & viering"}),
    Object.freeze({key:"other",label:"Overig"}),
  ]);
  const LABELS=Object.freeze(Object.fromEntries(TYPES.map(type=>[type.key,type.label])));
  const text=item=>clean([item?.title,item?.info,item?.location,item?.kind,item?.theme].filter(Boolean).join(" · "));
  const has=(value,re)=>re.test(value);
  function classifyEventType(item={}){
    const source=String(item.sourceId||""),value=text(item);
    if(source==="district-vergaderingen"||has(value,/\b(districtsraad|raadscommissie|gemeenteraad|openbare vergadering|openbare zitting)\b/))return"public_meeting";
    if(has(value,/\bspeelstraat\b/))return"playstreet";
    if(has(value,/\b(buurtfeest|wijkfeest|straatfeest|pleinfeest|burenfeest|buurtbarbecue|straatbarbecue)\b/))return"neighborhood";
    if(source==="stad-koopzondagen"||has(value,/\bkoopzondag\b/))return"shopping";
    if(has(value,/\b(rommelmarkt|vlooienmarkt|garageverkoop|garagesale|braderie|brocante|brocantemarkt)\b/))return"flea_braderie";
    if(has(value,/\b(stoet|optocht|processie|parade|carnaval)\b/))return"parade";
    if(item.theme==="Sport"||has(value,/\b(sport|wedstrijd|criterium|stratenloop|loopwedstrijd|fietstocht|wieler|voetbal|basketbal|tennis|zwem)\b/))return"sport";
    if(has(value,/\b(participatie|inspraak|infomoment|infoavond|wijkoverleg|bewonersvergadering|hoorzitting|burgerbegroting|buurtmoment)\b/))return"participation";
    if(has(value,/\b(herdenking|herdenkings|plechtigheid|viering)\b/))return"commemoration";
    if(has(value,/\b(sinterklaas|halloween|familiedag|familiefeest|kinderfeest|paasfeest|kerstfeest|bingo)\b/))return"family";
    if(has(value,/\b(festival|concert|circus|theater|expo|tentoonstelling|film|dans|muziek|kunst|lezing|literatuur)\b/))return"culture";
    if(source==="stad-markten"||has(value,/\b(markt|jaarmarkt|kerstmarkt|kermis|foor)\b/))return"market_fair";
    return"other";
  }
  root.PublicAgendaEventTypes=Object.freeze({types:TYPES,labels:LABELS,classifyEventType,labelFor:key=>LABELS[key]||LABELS.other});
})(typeof window!=="undefined"?window:globalThis);
