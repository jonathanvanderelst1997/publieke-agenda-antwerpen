const clean=(value,max=160)=>String(value??"").replace(/\s+/g," ").trim().slice(0,max);
const iso=value=>Number.isFinite(Number(value))?new Date(Number(value)).toISOString():"";
const uniq=values=>[...new Set(values.map(value=>clean(value)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"nl"));

export function normalizeAsSignWork(row={}){
  const gipodId=Number(row.GipodID);
  if(!Number.isFinite(gipodId)||gipodId<=0)return null;
  if(clean(row.STATUS,50).toLowerCase()!=="goedgekeurd")return null;
  return{
    gipodId,
    company:clean(row.Bedrijf,120),
    dossierNumber:clean(row.DossierNummer,80),
    dossierType:clean(row.DossierType,80),
    workType:clean(row.WERF_TYPE,80),
    phaseId:clean(row.FASEID,80),
    phaseStatus:clean(row.Fasestatus,80),
    trafficImpact:clean(row.VerkeersImpact,160),
    dossierHindrance:clean(row.DossierHinder,160),
    start:iso(row.BEGINDATUM),
    end:iso(row.EINDDATUM),
  };
}

export function collectAsSignWorkSupplement(rows=[]){
  const grouped=new Map();
  for(const row of rows){
    const normalized=normalizeAsSignWork(row?.attributes||row?.properties||row);
    if(!normalized)continue;
    const list=grouped.get(normalized.gipodId)||[];
    list.push(normalized);
    grouped.set(normalized.gipodId,list);
  }
  const result=new Map();
  for(const[gipodId,phases]of grouped){
    phases.sort((a,b)=>String(a.start).localeCompare(String(b.start))||String(a.end).localeCompare(String(b.end))||a.phaseId.localeCompare(b.phaseId,"nl"));
    result.set(gipodId,{
      gipodId,
      companies:uniq(phases.map(item=>item.company)),
      dossierNumbers:uniq(phases.map(item=>item.dossierNumber)),
      dossierTypes:uniq(phases.map(item=>item.dossierType)),
      workTypes:uniq(phases.map(item=>item.workType)),
      phaseStatuses:uniq(phases.map(item=>item.phaseStatus)),
      trafficImpacts:uniq(phases.map(item=>item.trafficImpact)),
      dossierHindrances:uniq(phases.map(item=>item.dossierHindrance)),
      phases,
    });
  }
  return result;
}

export function attachAsSignWorkSupplement(items=[],rows=[],sourceLoaded=true){
  const byGipod=collectAsSignWorkSupplement(rows);
  return items.map(item=>({
    ...item,
    aSignSupplement:byGipod.get(Number(item.gipodId))||null,
    aSignSupplementSourceLoaded:sourceLoaded,
  }));
}
