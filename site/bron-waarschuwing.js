// Publieke waarschuwing: brongezondheid staat los van een geslaagde dataverversing.
// Geen fetch, opslag of wijziging van bronitems.
(function (root) {
  "use strict";
  const inactive = new Set(["skipped_no_key", "disabled", "test_only"]);
  function samenvatting(bronnen) {
    if (!Array.isArray(bronnen) || !bronnen.length)
      return { kind: "unknown", total: 0, expired: 0, temporary: 0 };
    let expired = 0, temporary = 0;
    for (const entry of bronnen) {
      if (!entry || inactive.has(entry.fetchStatus) || entry.state === "inactive") continue;
      if (entry.state === "stale" || (entry.fetchStatus === "error" && !["fresh", "empty"].includes(entry.state)))
        expired++;
      else if (entry.fetchStatus === "error")
        temporary++;
    }
    return { kind: expired ? "expired" : temporary ? "temporary" : "ok", total: expired + temporary, expired, temporary };
  }
  root.PUBLIC_AGENDA_SOURCE_WARNING = Object.freeze({ samenvatting });
})(window);
