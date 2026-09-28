export function normalizeDecisionTitle(value=""){return String(value??"").replace(/\s+/g," ").trim()}
export function classifyCivicDecisionTitle(value=""){
  const title=normalizeDecisionTitle(value),t=title.toLowerCase();
  if(!title)return{category:"other",publishCandidate:false};
  if(t.includes("speelstraat")||t.includes("speelstraten")){
    if(t.includes("weigering"))return{category:"play_street_refusal",publishCandidate:false};
    if(t.includes("wijziging aanvullend verkeersreglement")||(t.includes("reglement")&&t.includes("wijzig")))return{category:"play_street_rule",publishCandidate:false};
    if((t.includes("aanvraag speelstraten")||t.includes("aanvragen speelstraten")||t.includes("speelstraten"))&&t.includes("goedkeuring"))return{category:"play_street_approval",publishCandidate:true};
    return{category:"play_street_other",publishCandidate:false};
  }
  if((t.includes("kermis")||t.includes("foor"))&&t.includes("goedkeuring"))return{category:"fair_calendar_candidate",publishCandidate:true};
  if(t.includes("markt")&&(t.includes("feestdag")||t.includes("afwijk")||t.includes("regeling"))&&t.includes("goedkeuring"))return{category:"market_exception_candidate",publishCandidate:true};
  return{category:"other",publishCandidate:false};
}
