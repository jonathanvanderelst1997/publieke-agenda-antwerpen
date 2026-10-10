function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return false;
  // Een onmogelijke dag (2026-13-01) is ongeldig, geen uitzondering.
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function evaluateStalePolicy({
  classification,
  classificationAsOf,
  verificationState,
  officialPublic,
  canonicalSourceUrl,
  sourceRetrievedAt,
  recheckDueOn,
}) {
  if (!validDate(classificationAsOf)) return { status: "blocked_invalid_as_of", publishEligible: false, failClosed: true };
  if (classification === "expired") return { status: "expired_not_public", publishEligible: false, failClosed: true };
  if (classification === "review_required") return { status: "blocked_review_required", publishEligible: false, failClosed: true };
  if (!["current", "future"].includes(classification)) return { status: "blocked_unknown_classification", publishEligible: false, failClosed: true };
  if (verificationState !== "verified" || officialPublic !== true) {
    return { status: "blocked_unverified_source", publishEligible: false, failClosed: true };
  }
  if (!/^https:\/\//i.test(canonicalSourceUrl ?? "")) {
    return { status: "blocked_invalid_source_url", publishEligible: false, failClosed: true };
  }
  if (!validDate(String(sourceRetrievedAt ?? "").slice(0, 10))) {
    return { status: "blocked_missing_or_invalid_retrieval", publishEligible: false, failClosed: true };
  }
  if (!validDate(recheckDueOn)) {
    return { status: "blocked_missing_or_invalid_recheck_due", publishEligible: false, failClosed: true };
  }
  if (classificationAsOf > recheckDueOn) return { status: "stale_blocked", publishEligible: false, failClosed: true };
  return { status: "fresh_verified", publishEligible: true, failClosed: false };
}

// ---------- lege bron ----------
// Een bron die antwoordt maar al EMPTY_SOURCE_DAYS kalenderdagen op rij niets komends levert
// (0 items, of alleen items die voorbij zijn), heet "leeg": een oranje melding, geen fout. Zo'n bron
// is echt leeg (de stad zet er niets in) of stilletjes stuk; in geen van beide gevallen klopt "ok".
// De teller loopt via `emptySince` in site/sources/refresh-status.json: de eerste dag van de huidige
// reeks dagen zonder komend item. scripts/refresh-fetch.mjs neemt die dag over van de vorige status.
// De teller telt kalenderdagen, geen verversingen: valt een ochtend uit, dan is een bron al na 2 echte
// verversingen "leeg". Dat is bewust: een gemiste ochtend maakt een lege bron niet minder leeg.
export const EMPTY_SOURCE_DAYS = 3;

// Aantal kalenderdagen van `from` tot en met `to` (beide JJJJ-MM-DD).
function daysInclusive(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

// De eerste dag zonder komend item, of null zodra er weer iets komt. Een ongeldige of toekomstige
// vorige dag telt niet: dan begint de reeks vandaag.
export function nextEmptySince({ previousEmptySince = null, upcoming, today }) {
  if (!validDate(today)) return null;
  if (Number.isInteger(upcoming) && upcoming > 0) return null;
  return validDate(previousEmptySince) && previousEmptySince <= today ? previousEmptySince : today;
}

// "leeg" vanaf de derde dag op rij zonder komend item, anders "ok".
export function contentStatusOf({ emptySince, today }) {
  if (!validDate(emptySince) || !validDate(today) || emptySince > today) return "ok";
  return daysInclusive(emptySince, today) >= EMPTY_SOURCE_DAYS ? "leeg" : "ok";
}
