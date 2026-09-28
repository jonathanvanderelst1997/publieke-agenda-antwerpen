// Controleert of een wijziging alleen agenda-data raakt ("data lane"): alleen dan mag een
// dagelijkse refresh zonder code-review live. Invoer: regels van `git diff --name-status -M0`.
// Puur: geen git, geen bestanden.

const STATUS_LETTERS = new Set(["A", "C", "D", "M", "R", "T"]);

function pathProblem(path) {
  if (!path) return "invalid_path";
  if (path.startsWith("/") || path.startsWith('"') || path.split("/").some((part) => part === ".." || part === "." || part === "")) {
    return "invalid_path";
  }
  return null;
}

// Geeft een lijst schendingen { code, status, path } terug; leeg betekent toegelaten.
export function checkDataLane(lines, spec) {
  const allowed = (spec?.allowed ?? []).map((pattern) => new RegExp(pattern));
  const deletableUnder = spec?.deletableUnder ?? [];
  const entries = (Array.isArray(lines) ? lines : String(lines ?? "").split(/\r?\n/))
    .map((line) => String(line).replace(/\s+$/, ""))
    .filter(Boolean);
  if (!entries.length) return [{ code: "empty_change", status: "", path: "" }];

  const violations = [];
  const checkPath = (status, path, deleting) => {
    const problem = pathProblem(path);
    if (problem) {
      violations.push({ code: problem, status, path: path ?? "" });
      return;
    }
    if (!allowed.some((pattern) => pattern.test(path))) violations.push({ code: "path_not_allowed", status, path });
    if (deleting && !deletableUnder.some((prefix) => path.startsWith(prefix))) violations.push({ code: "delete_not_allowed", status, path });
  };

  for (const entry of entries) {
    const parts = entry.split("\t");
    const status = parts[0] ?? "";
    const letter = status[0];
    if (!STATUS_LETTERS.has(letter) || !/^[ACDMRT]\d{0,3}$/.test(status)) {
      violations.push({ code: "unsupported_status", status, path: parts.slice(1).join(" ") });
      continue;
    }
    if (letter === "R") {
      if (parts.length !== 3) violations.push({ code: "invalid_line", status, path: parts.slice(1).join(" ") });
      else {
        checkPath(status, parts[1], true);
        checkPath(status, parts[2], false);
      }
      continue;
    }
    if (letter === "C") {
      if (parts.length !== 3) violations.push({ code: "invalid_line", status, path: parts.slice(1).join(" ") });
      else checkPath(status, parts[2], false);
      continue;
    }
    if (parts.length !== 2) {
      violations.push({ code: "invalid_line", status, path: parts.slice(1).join(" ") });
      continue;
    }
    checkPath(status, parts[1], letter === "D");
  }
  return violations;
}

export function formatViolation(violation) {
  return `${violation.code}\t${violation.status}\t${violation.path}`;
}
