// Proef voor de overstap van ubuntu-latest naar Ubuntu 26.04 (19 oktober tot 19 november 2026).
// Daar zijn date (Rust-coreutils), jq (1.8) en bash (5.3) andere versies, en refresh.yml leunt op
// precies die drie: date -u -d op de ISO-tijden van de bronnen, jq voor de datalijst en de
// binding, bash voor de databaantoets. De proefjob ubuntu-26.04-proef in .github/workflows/ci.yml
// draait dit script; refresh.yml zelf verandert niet.
//
//   node scripts/refresh-droog.mjs gereedschap
//     Versies van de image en vaste uitkomsten, volledig offline: date -u -d op de vormen die de
//     bronnen schrijven, TZ=Europe/Brussels, de jq-programma's, sort/tail van de opruimstap,
//     base64 -w0 en de databaantoets (letterlijk uit refresh.yml) op goede en foute wijzigingen.
//
//   node scripts/refresh-droog.mjs verversing
//     Een droge verversing: de run-stappen van refresh.yml, letterlijk uit het bestand gelezen en
//     in dezelfde volgorde uitgevoerd. Lezen van het netwerk mag (de bronnen, de live agenda);
//     schrijven niet: git push, git ls-remote en gh vangt een stub op, de job alarm draait niet.
//     DROOG_ZONDER_OPHALEN=1 slaat het ophalen over en maakt een kleine, verzonnen datawijziging
//     (generatedAt) zodat de rest van de keten toch iets te doen heeft. Zo zet een datatak-PR geen
//     tweede verversing in gang.
//
//   node scripts/refresh-droog.mjs breuken
//     Na de andere stappen in dezelfde job: zet de breuken (die gereedschap en verversing in
//     $RUNNER_TEMP/droog-breuken.txt of DROOG_BREUKEN schreven, plus de stappen die faalden volgens
//     STAPPEN = toJSON(steps)) als JSON-lijst in de output "lijst" van de stap.
//
//   node scripts/refresh-droog.mjs oordeel
//     Vergelijkt de breuken van 26.04 (PROEF) met die van de controle op 24.04 (CONTROLE). Alleen
//     wat op 26.04 breekt en op 24.04 niet, ligt aan 26.04 ("echt"). Wat op beide breekt, ligt aan
//     de live data of de code, niet aan de overstap.
//
// Exitcode 1 bij een breuk: een stap die moet slagen faalt, of een uitkomst wijkt af. Een stap die
// faalt door de toestand van de bronnen of de live site (bronstatus, versheid) is geen breuk.
//
// Op macOS geeft "gereedschap" BREUK: date, sort, base64 en sha256sum zijn daar BSD-versies of
// ontbreken. Dat zegt niets over Ubuntu; draai het op Linux (of in een Ubuntu-container).
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isMainModule } from "../lib/fetch-util.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WERKSTROOM = ".github/workflows/refresh.yml";

// ---------- de werkstroom lezen ----------

const zonderCommentaar = (waarde) => {
  const v = waarde.trim();
  if (/^".*"$/.test(v) || /^'.*'$/.test(v)) return v.slice(1, -1);
  return v.replace(/\s+#.*$/, "");
};

/**
 * Leest de jobs en stappen van een werkstroom in de vorm die deze repo gebruikt: twee spaties per
 * niveau, stappen als lijst onder "steps:", run als blok (|) of op één regel. Geen volledige YAML;
 * wat het niet kent, laat het liggen.
 */
export function leesWerkstroom(tekst) {
  const regels = tekst.split(/\r?\n/);
  const start = regels.indexOf("jobs:");
  if (start < 0) throw new Error("geen 'jobs:' in de werkstroom");
  const jobs = new Map();
  let job = null;
  let stap = null;
  let inSteps = false;
  const inspring = (regel) => regel.match(/^ */)[0].length;
  const kind = (vanaf, minimum) => {
    // Regels van een kindblok: leeg, of dieper ingesprongen dan `minimum`.
    const uit = [];
    let j = vanaf;
    while (j < regels.length && (regels[j].trim() === "" || inspring(regels[j]) > minimum)) uit.push(regels[j++]);
    while (uit.length && uit[uit.length - 1].trim() === "") { uit.pop(); j -= 1; }
    return { uit, volgende: j };
  };
  const stapSleutel = (sleutel, waarde, i) => {
    if (sleutel === "run" && /^\|-?\s*$/.test(waarde.trim())) {
      const { uit, volgende } = kind(i + 1, 8);
      const diepte = Math.min(...uit.filter((r) => r.trim()).map(inspring));
      stap.run = uit.map((r) => r.slice(diepte)).join("\n") + "\n";
      return volgende;
    }
    if (sleutel === "env" || sleutel === "with") {
      const { uit, volgende } = kind(i + 1, 8);
      const map = {};
      for (const r of uit) {
        const m = r.match(/^ {10}([A-Za-z0-9_-]+):\s*(.*)$/);
        if (m) map[m[1]] = zonderCommentaar(m[2]);
      }
      stap[sleutel] = map;
      return volgende;
    }
    if (sleutel === "run") stap.run = zonderCommentaar(waarde) + "\n";
    else if (sleutel === "continue-on-error") stap.continueOnError = zonderCommentaar(waarde) === "true";
    else stap[sleutel] = zonderCommentaar(waarde);
    return i + 1;
  };
  for (let i = start + 1; i < regels.length;) {
    const regel = regels[i];
    if (regel.trim() === "" || /^\s*#/.test(regel)) { i += 1; continue; }
    if (/^\S/.test(regel)) break;
    const jobKop = regel.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (jobKop) {
      job = { naam: jobKop[1], steps: [] };
      jobs.set(job.naam, job);
      inSteps = false;
      stap = null;
      i += 1;
      continue;
    }
    if (/^ {4}steps:\s*$/.test(regel)) { inSteps = true; i += 1; continue; }
    if (/^ {4}\S/.test(regel)) { inSteps = false; i += 1; continue; }
    if (inSteps && job) {
      const nieuw = regel.match(/^ {6}- ([A-Za-z_-]+):(.*)$/);
      if (nieuw) {
        stap = {};
        job.steps.push(stap);
        i = stapSleutel(nieuw[1], nieuw[2], i);
        continue;
      }
      const sleutel = regel.match(/^ {8}([A-Za-z_-]+):(.*)$/);
      if (sleutel && stap) { i = stapSleutel(sleutel[1], sleutel[2], i); continue; }
    }
    i += 1;
  }
  return jobs;
}

/** De databaantoets zoals hij letterlijk in een run-blok staat (tussen de markeringen). */
export function databaantoets(run) {
  const begin = run.indexOf("# >>> databaantoets");
  const einde = run.indexOf("# <<< databaantoets");
  if (begin < 0 || einde < begin) throw new Error("databaantoets niet gevonden");
  return run.slice(begin, einde + "# <<< databaantoets".length) + "\n";
}

// ---------- uitvoeren ----------

const neutraal = (regel) => `  | ${regel.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "?")}`;

/** Voert een opdracht uit, toont de uitvoer ingesprongen (zo wordt geen regel een ::opdracht::). */
function voerUit(opdracht, args, { cwd = rootDir, env = process.env, invoer, stil = false } = {}) {
  return new Promise((resolve) => {
    const kind = spawn(opdracht, args, { cwd, env, stdio: [invoer === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    let uitvoer = "";
    let rest = "";
    const lees = (stuk) => {
      const tekst = stuk.toString("utf8");
      if (uitvoer.length < 4 * 1024 * 1024) uitvoer += tekst;
      if (stil) return;
      const delen = (rest + tekst).split("\n");
      rest = delen.pop();
      for (const deel of delen) console.log(neutraal(deel));
    };
    kind.stdout.on("data", lees);
    kind.stderr.on("data", lees);
    if (invoer !== undefined) {
      kind.stdin.on("error", () => {});
      kind.stdin.end(invoer);
    }
    let klaar = false;
    const einde = (code) => {
      if (klaar) return;
      klaar = true;
      if (rest && !stil) console.log(neutraal(rest));
      resolve({ code: code ?? 1, uitvoer });
    };
    kind.on("error", (fout) => { uitvoer += String(fout.message); einde(127); });
    kind.on("close", einde);
  });
}

const bashUit = (script, args = [], opties = {}) => voerUit("bash", ["-c", script, "_", ...args], { stil: true, ...opties });

// ---------- gereedschap: versies en vaste uitkomsten ----------

const epoch = (iso) => String(Math.floor(Date.parse(iso) / 1000));

// Acht verzonnen datatakken. De opruimstap houdt de vijf nieuwste (datum, dan run-id als getal).
// Op 20261006 staan run 9 en run 37448371340: alfabetisch zou 9 blijven staan, numeriek niet.
export const DATATAKKEN = [
  "data/refresh-20261001-36846807454",
  "data/refresh-20261005-300",
  "data/refresh-20261006-9",
  "data/refresh-20261006-37448371340",
  "data/refresh-20261007-1",
  "data/refresh-20261008-37804153000",
  "data/refresh-20261009-37878696244",
  "data/refresh-20261010-38020180028",
  "data/refresh-oud",
];
export const OPGERUIMD = ["data/refresh-20261006-9", "data/refresh-20261005-300", "data/refresh-20261001-36846807454"];

export function vasteControles(werkstroom) {
  const publiceer = werkstroom.get("publish-branch")?.steps.find((s) => s.name === "Patch toepassen en de datalijst opnieuw toetsen");
  const lane = publiceer?.run ? databaantoets(publiceer.run) : null;
  const tak = (naam, i) => `${String(i).padStart(40, "0")}\trefs/heads/${naam}`;
  const opruimLijst = DATATAKKEN.map(tak).join("\n") + "\n";
  // Letterlijk de pijplijn van cleanup_old_branches in refresh.yml, met de lijst op stdin.
  const opruimScript = `while read -r _ ref; do
  name=\${ref#refs/heads/}
  if [[ $name =~ ^data/refresh-([0-9]{8})-([0-9]+)$ ]]; then
    echo "\${BASH_REMATCH[1]} \${BASH_REMATCH[2]} \${name}"
  fi
done | sort -k1,1nr -k2,2nr | tail -n +6 | while read -r _ _ old; do echo "$old"; done`;
  const laneZaak = (changes, raw) => ({ changes, raw });
  const laneZaken = {
    goed: laneZaak("M\tsite/sources/refresh-status.json\nD\tsite/event/oud-2026-01-01/index.html\n", ":100644 100644 aaa bbb M\tsite/sources/refresh-status.json\n:100644 000000 aaa 000 D\tsite/event/oud-2026-01-01/index.html\n"),
    hernoeming: laneZaak("R100\tsite/event/a-2026-01-01/index.html\tsite/event/b-2026-01-01/index.html\n", ":100644 100644 aaa aaa R100\tsite/event/a-2026-01-01/index.html\tsite/event/b-2026-01-01/index.html\n"),
    code: laneZaak("M\t.github/workflows/ci.yml\n", ":100644 100644 aaa bbb M\t.github/workflows/ci.yml\n"),
    modus: laneZaak("M\tsite/sources/refresh-status.json\n", ":100644 100755 aaa bbb M\tsite/sources/refresh-status.json\n"),
    wissen: laneZaak("D\tsite/sources/refresh-status.json\n", ":100644 000000 aaa 000 D\tsite/sources/refresh-status.json\n"),
    leeg: laneZaak("", ""),
  };
  const binding = "M\tsite/a.json\nR100\tsite/event/x/index.html\tsite/event/y/index.html\nD\tsite/event/z/index.html\n";
  const bindingVerwacht = [
    { path: "site/a.json", status: "M" },
    { path: "site/event/x/index.html", status: "D" },
    { path: "site/event/y/index.html", status: "A" },
    { path: "site/event/z/index.html", status: "D" },
  ];
  const status = JSON.stringify({ sources: [
    { sourceId: "a", fetchStatus: "ok", retrievedAt: "2026-10-10T03:20:07.107Z", maxAgeHours: 48 },
    { sourceId: "b", fetchStatus: "error", retrievedAt: null, errorCode: "http_503" },
  ] });
  const dateRe = "^[0-9]{4}-[0-9]{2}-[0-9]{2}([T ][0-9:.]+(Z|[+-][0-9]{2}:?[0-9]{2})?)?$";
  const nu = () => Math.floor(Date.now() / 1000);
  /** @type {{naam: string, script: string, args?: string[], invoer?: string, verwacht: (r: {code: number, uitvoer: string}) => true | string, soort?: string}[]} */
  return [
    ...["2026-10-10T03:22:17.338Z", "2026-10-10T03:22:17Z", "2026-10-10T05:22:17+02:00"].map((iso) => ({
      naam: `date -u -d "${iso}" +%s`,
      script: 'date -u -d "$1" +%s',
      args: [iso],
      verwacht: ({ code, uitvoer }) => (code === 0 && uitvoer.trim() === epoch(iso)) || `verwacht ${epoch(iso)}`,
    })),
    {
      naam: "date -u -d op geen datum faalt",
      script: 'date -u -d "geen-datum" +%s',
      verwacht: ({ code }) => code !== 0 || "verwacht een fout (refresh.yml leest een mislukking als 'niet leesbaar')",
    },
    {
      naam: "date +%s en date -u +%s zijn nu",
      script: "echo $(date +%s) $(date -u +%s)",
      verwacht: ({ code, uitvoer }) => {
        const [a, b] = uitvoer.trim().split(/\s+/).map(Number);
        return (code === 0 && Math.abs(a - nu()) < 300 && Math.abs(b - nu()) < 300) || "geen huidige epoch";
      },
    },
    {
      naam: "TZ=Europe/Brussels: 22.30 UTC in de zomer is de volgende dag",
      script: 'TZ=Europe/Brussels date -d "2026-10-09T22:30:00Z" +%Y%m%d',
      verwacht: ({ code, uitvoer }) => (code === 0 && uitvoer.trim() === "20261010") || "verwacht 20261010",
    },
    {
      naam: "TZ=Europe/Brussels: oudejaar 23.30 UTC is 00.30 (wintertijd)",
      script: "TZ=Europe/Brussels date -d \"2026-12-31T23:30:00Z\" '+%Y-%m-%d %H:%M'",
      verwacht: ({ code, uitvoer }) => (code === 0 && uitvoer.trim() === "2027-01-01 00:30") || "verwacht 2027-01-01 00:30",
    },
    {
      naam: "TZ=Europe/Brussels date +%Y%m%d is acht cijfers",
      script: "TZ=Europe/Brussels date +%Y%m%d",
      verwacht: ({ code, uitvoer }) => (code === 0 && /^[0-9]{8}$/.test(uitvoer.trim())) || "geen JJJJMMDD",
    },
    {
      naam: "base64 -w0 van de git-aanmelding",
      script: "printf 'x-access-token:%s' abc | base64 -w0",
      verwacht: ({ code, uitvoer }) => (code === 0 && uitvoer === Buffer.from("x-access-token:abc").toString("base64")) || "andere base64",
    },
    {
      // De job gitleaks haalt gitleaks op met "echo '<sha>  <bestand>' | sha256sum -c -".
      naam: "sha256sum -c - (gitleaks ophalen)",
      script: 'printf "verzonnen inhoud\\n" > "$1/sum.txt"; echo "$2  $1/sum.txt" | sha256sum -c - && ! echo "$3  $1/sum.txt" | sha256sum -c - 2>/dev/null && echo ok',
      args: ["$TMP", createHash("sha256").update("verzonnen inhoud\n").digest("hex"), "0".repeat(64)],
      verwacht: ({ code, uitvoer }) => (code === 0 && /: OK\n/.test(uitvoer) && uitvoer.trim().endsWith("ok")) || "verwacht OK voor de juiste som en een fout voor een verkeerde",
    },
    {
      naam: "wc -l < bestand",
      script: 'printf "a\\nb\\nc\\n" > "$1/wc.txt"; wc -l < "$1/wc.txt"',
      args: ["$TMP"],
      soort: "cosmetisch",
      verwacht: ({ code, uitvoer }) => (code === 0 && uitvoer === "3\n") || "verwacht precies '3' (alleen de tekst in het logboek)",
    },
    {
      naam: "opruimen: sort -k1,1nr -k2,2nr | tail -n +6",
      script: opruimScript,
      invoer: opruimLijst,
      verwacht: ({ code, uitvoer }) => (code === 0 && uitvoer.trim().split("\n").join(",") === OPGERUIMD.join(",")) || `verwacht ${OPGERUIMD.join(", ")}`,
    },
    {
      naam: "bash: =~ met BASH_REMATCH",
      script: 'n=data/refresh-20261010-38020180028; [[ $n =~ ^data/refresh-([0-9]{8})-([0-9]+)$ ]] && echo "${BASH_REMATCH[1]} ${BASH_REMATCH[2]}"',
      verwacht: ({ code, uitvoer }) => (code === 0 && uitvoer.trim() === "20261010 38020180028") || "andere BASH_REMATCH",
    },
    {
      naam: "bash: datumpatroon van de datacommit",
      script: `date_re='${dateRe}'; for v in 2026-10-10 2026-10-10T03:22:17.338Z 2026-10-10T05:22:17+02:00; do [[ $v =~ $date_re ]] || exit 1; done; [[ geen =~ $date_re ]] && exit 1; echo ok`,
      verwacht: ({ code, uitvoer }) => (code === 0 && uitvoer.trim() === "ok") || "datumpatroon gedraagt zich anders",
    },
    {
      naam: "jq -er '.generatedAt | strings'",
      script: "printf '%s' '{\"generatedAt\":\"2026-10-10T03:22:17.338Z\"}' | jq -er '.generatedAt | strings'; printf '%s' '{}' | jq -er '.generatedAt | strings' >/dev/null && exit 9; exit 0",
      verwacht: ({ code, uitvoer }) => (code === 0 && uitvoer.trim() === "2026-10-10T03:22:17.338Z") || "jq -e leest generatedAt anders",
    },
    {
      naam: "jq -e: npm-scripts aanwezig in package.json",
      script: 'jq -e --arg s refresh \'.scripts[$s] | type == "string"\' package.json >/dev/null && ! jq -e --arg s bestaat-niet \'.scripts[$s] | type == "string"\' package.json >/dev/null && echo ok',
      verwacht: ({ code, uitvoer }) => (code === 0 && uitvoer.trim() === "ok") || "jq -e op package.json anders",
    },
    {
      naam: "jq -Rn: bestandenlijst van de binding",
      script: `jq -Rn '[inputs | select(length > 0) | split("\\t")
             | if (.[0] | startswith("R"))
               then {path: .[1], status: "D"}, {path: .[2], status: "A"}
               else {path: .[1], status: .[0]} end]'`,
      invoer: binding,
      verwacht: ({ code, uitvoer }) => {
        try { return (code === 0 && JSON.stringify(JSON.parse(uitvoer)) === JSON.stringify(bindingVerwacht)) || "andere lijst"; } catch { return "geen JSON"; }
      },
    },
    {
      naam: "jq -n --argjson --slurpfile: binding met groot run-id",
      script: `printf '%s' '[{"path":"site/a.json","status":"M"}]' > "$1/files.json"
jq -n --arg repository o/r --argjson run_id 38020180028 --argjson run_attempt 1 --arg base_sha b --arg head_sha h --arg branch t \\
  --slurpfile files "$1/files.json" --arg generated_at 2026-10-10T03:22:17.338Z \\
  '{repository: $repository, run_id: $run_id, run_attempt: $run_attempt, base_sha: $base_sha, head_sha: $head_sha, branch: $branch, files: $files[0], generated_at: $generated_at}'`,
      args: ["$TMP"],
      verwacht: ({ code, uitvoer }) => {
        try {
          const b = JSON.parse(uitvoer);
          return (code === 0 && b.run_id === 38020180028 && /"run_id": 38020180028,/.test(uitvoer) && b.files.length === 1 && b.files[0].path === "site/a.json") || "andere binding";
        } catch { return "geen JSON"; }
      },
    },
    {
      naam: "jq @tsv met //-standaardwaarden (bronstatus)",
      script: `jq -r '.sources[] | [(.sourceId // "?" | tostring), (.fetchStatus // "?" | tostring), (.retrievedAt // "-" | tostring), (.errorCode // "-" | tostring), (.maxAgeHours // 48 | tostring)] | @tsv'`,
      invoer: status,
      verwacht: ({ code, uitvoer }) => (code === 0 && uitvoer === "a\tok\t2026-10-10T03:20:07.107Z\t-\t48\nb\terror\t-\thttp_503\t48\n") || "andere TSV",
    },
    {
      naam: "jq -e: bronnen zijn een niet-lege lijst van objecten",
      script: `jq -e '.sources | type == "array" and length > 0 and all(.[]; type == "object")' >/dev/null && echo ok`,
      invoer: status,
      verwacht: ({ code, uitvoer }) => (code === 0 && uitvoer.trim() === "ok") || "jq -e all() anders",
    },
    ...(lane
      ? Object.entries(laneZaken).map(([naam, zaak]) => ({
          naam: `databaantoets uit refresh.yml: ${naam}`,
          script: `set -euo pipefail\n${lane}\nprintf '%s' "$2" > "$1/changes.txt"; printf '%s' "$3" > "$1/raw.txt"\nlane_check lib/data-lane-paths.json "$1/changes.txt" "$1/raw.txt"`,
          args: ["$TMP", zaak.changes, zaak.raw],
          verwacht: ({ code, uitvoer }) => {
            const moet = { goed: 0, hernoeming: 0 }[naam] ?? 1;
            if (code !== moet) return `exitcode ${code}, verwacht ${moet}`;
            if (naam === "code" && !uitvoer.includes("AFGEWEZEN M .github/workflows/ci.yml")) return "reden ontbreekt";
            if (naam === "modus" && !uitvoer.includes("modus-100755")) return "reden ontbreekt";
            return true;
          },
        }))
      : [{ naam: "databaantoets uit refresh.yml", script: "exit 1", verwacht: () => "niet gevonden in refresh.yml" }]),
  ];
}

const VERSIES = [
  ["image", ". /etc/os-release 2>/dev/null && echo \"$PRETTY_NAME\""],
  ["bash", "bash --version | head -n 1"],
  ["jq", "jq --version"],
  ["date", "date --version | head -n 1; readlink -f \"$(command -v date)\""],
  ["gnudate", "command -v gnudate >/dev/null && gnudate --version | head -n 1 || echo afwezig"],
  ["sort", "sort --version | head -n 1"],
  ["tail", "tail --version | head -n 1"],
  ["base64", "base64 --version | head -n 1"],
  ["wc", "wc --version | head -n 1"],
  ["sha256sum", "sha256sum --version | head -n 1"],
  ["tar", "tar --version | head -n 1"],
  ["git", "git --version"],
  ["curl", "curl --version | head -n 1"],
  ["node", "node --version; npm --version"],
];

/** Een waarschuwing vooraf als dit niet op Linux draait: dan zegt BREUK niets over Ubuntu. */
export function platformWaarschuwing(platform = process.platform) {
  if (platform === "linux") return null;
  const waar = platform === "darwin" ? "macOS (BSD-versies van date, sort en base64; geen sha256sum)" : platform;
  return `Let op: dit draait op ${waar}, niet op Linux. Een BREUK hieronder zegt dan niets over Ubuntu 26.04; draai het op Linux of in een Ubuntu-container.`;
}

// Waar de breuken van een job staan: DROOG_BREUKEN, of in Actions een vast bestand in RUNNER_TEMP
// (dat deelt elke stap van dezelfde job). Lokaal nergens.
const breukenBestand = (env = process.env) =>
  env.DROOG_BREUKEN || (env.GITHUB_ACTIONS === "true" && env.RUNNER_TEMP ? path.join(env.RUNNER_TEMP, "droog-breuken.txt") : null);

/** Schrijft een breuk weg voor de stap "breuken", één per regel. */
function bewaarBreuk(soort, wat) {
  const bestand = breukenBestand();
  if (!bestand) return;
  fs.appendFileSync(bestand, `${soort}: ${String(wat).replace(/[\r\n]+/g, " ")}\n`);
}

async function gereedschap() {
  const werkstroom = leesWerkstroom(fs.readFileSync(path.join(rootDir, WERKSTROOM), "utf8"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "refresh-droog-"));
  const rijen = [];
  try {
    const waarschuwing = platformWaarschuwing();
    if (waarschuwing) console.log(waarschuwing);
    console.log("Gereedschap op deze image:");
    for (const [naam, script] of VERSIES) {
      const { uitvoer } = await bashUit(script);
      const tekst = uitvoer.trim().split("\n").join(" | ");
      console.log(neutraal(`${naam}: ${tekst}`));
      rijen.push(["versie", naam, tekst]);
    }
    console.log("Vaste uitkomsten:");
    let breuken = 0;
    for (const controle of vasteControles(werkstroom)) {
      const args = (controle.args ?? []).map((a) => (a === "$TMP" ? tmp : a));
      const r = await bashUit(controle.script, args, { invoer: controle.invoer });
      const oordeel = controle.verwacht(r);
      const ok = oordeel === true;
      const soort = ok ? "ok" : controle.soort === "cosmetisch" ? "let op" : "BREUK";
      if (soort === "BREUK") { breuken += 1; bewaarBreuk("gereedschap", controle.naam); }
      console.log(neutraal(`${soort.padEnd(6)} ${controle.naam}${ok ? "" : `: ${oordeel}; kreeg code ${r.code}, ${JSON.stringify(r.uitvoer.slice(0, 300))}`}`));
      rijen.push([soort, controle.naam, ok ? "" : String(oordeel)]);
    }
    schrijfSamenvatting("Ubuntu-proef: gereedschap en vaste uitkomsten", rijen);
    if (breuken) console.log(`::error title=Ubuntu-proef::${breuken} vaste uitkomst(en) wijken af op deze image; zie de regels met BREUK.`);
    else console.log("Alle vaste uitkomsten kloppen op deze image.");
    return breuken ? 1 : 0;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function schrijfSamenvatting(kop, rijen) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const cel = (t) => String(t).replace(/[|\n`]/g, " ");
  const tekst = [`### ${kop}`, "", "| Uitkomst | Wat | Toelichting |", "| --- | --- | --- |", ...rijen.map((r) => `| ${r.map(cel).join(" | ")} |`), ""].join("\n");
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, tekst + "\n");
}

// ---------- verversing: refresh.yml droog ----------

// De jobs in de volgorde van een echte run. alarm schrijft een issue en draait nooit droog.
export const DROGE_JOBS = ["al-vers", "refresh", "publish-branch", "source-health", "freshness"];

// Stappen die mogen falen door de toestand van de bronnen of de live site, met het teken van een
// echte breuk in hun uitvoer (dan ligt het aan date, jq of bash en niet aan de bron).
export const VERWACHTING = {
  "refresh/Bronstatus (meldt, blokkeert niet)": { magFalen: true },
  "source-health/Elke bron gezond": { magFalen: true, breuk: /zonder leesbare retrievedAt|onbekende fetchStatus|bevat geen bronnen/ },
  "al-vers/Live agenda jonger dan 20 uur?": { breuk: null, letOp: /niet te lezen/ },
  "freshness/Live agenda niet ouder dan 48 uur": { magFalen: true, breuk: /geen leesbare generatedAt/ },
};
const ZONDER_OPHALEN_MAG_FALEN = new Set(["refresh/Data vers, publiek en binnen het schema"]);
const OPHALEN = "refresh/Bronnen ophalen en opnieuw opbouwen";

/** Waarden voor ${{ ... }} in de env van een stap; de rest wordt leeg (zoals een ontbrekende variabele). */
export function droogEnv(sleutel, waarde, context) {
  if (!String(waarde).includes("${{")) return String(waarde);
  const gekend = {
    REASON: "droog",
    GH_TOKEN: "droog-geen-token",
    RUN_ID: context.runId,
    RUN_ATTEMPT: "1",
    BASE_SHA: context.baseSha,
  };
  return gekend[sleutel] ?? "";
}

export function maakStubs(map, echteGit) {
  fs.mkdirSync(map, { recursive: true });
  const lijst = DATATAKKEN.map((naam, i) => `${String(i).padStart(40, "0")}\trefs/heads/${naam}`).join("\\n");
  fs.writeFileSync(path.join(map, "git"), `#!/usr/bin/env bash
# Droge verversing: wat naar het netwerk schrijft of de remote vraagt, wordt alleen gemeld.
# Eerst de globale opties van git overslaan (-C pad, -c k=v, --git-dir pad, --bare ...), dan pas
# het subcommando bekijken: anders gaat "git -C . push" langs de stub naar de echte remote.
sub=""
i=1
while [ "$i" -le "$#" ]; do
  a="\${!i}"
  case "$a" in
    -C|-c|--git-dir|--work-tree|--namespace|--config-env|--attr-source) i=$((i + 2)) ;;
    -*) i=$((i + 1)) ;;
    *) sub="$a"; break ;;
  esac
done
case "$sub" in
  push) echo "DROOG: git $* (niet uitgevoerd)" >&2; exit 0 ;;
  ls-remote)
    case " $* " in
      *" --exit-code "*) echo "DROOG: git ls-remote --exit-code: tak bestaat niet" >&2; exit 2 ;;
    esac
    printf '${lijst}\\n'; exit 0 ;;
  fetch|pull|clone) echo "DROOG: git $sub overgeslagen" >&2; exit 0 ;;
esac
exec "${echteGit}" "$@"
`, { mode: 0o755 });
  fs.writeFileSync(path.join(map, "gh"), "#!/usr/bin/env bash\necho \"DROOG: gh $* (niet uitgevoerd)\" >&2\nexit 0\n", { mode: 0o755 });
}

// De git-instellingen van de droge run (GIT_CONFIG_GLOBAL). Een tweede slot naast de stub: gaat
// een push er toch langs (een vorm die de stub niet kent), dan wijst de URL naar een schema dat
// niet bestaat en faalt de push zonder het netwerk te raken.
export const DROOG_GITCONFIG = [
  '[url "droog-geen-push://"]',
  ...["https://", "http://", "ssh://", "git://", "git@"].map((voor) => `\tpushInsteadOf = ${voor}`),
  "",
].join("\n");

async function verversing() {
  const werkstroom = leesWerkstroom(fs.readFileSync(path.join(rootDir, WERKSTROOM), "utf8"));
  const zonderOphalen = process.env.DROOG_ZONDER_OPHALEN === "1";
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "refresh-droog-"));
  const echteGit = spawnSync("bash", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  const stubs = path.join(tmp, "stubs");
  maakStubs(stubs, echteGit);
  const droogConfig = path.join(tmp, "gitconfig");
  fs.writeFileSync(droogConfig, DROOG_GITCONFIG);
  const baseSha = spawnSync(echteGit, ["rev-parse", "HEAD"], { cwd: rootDir, encoding: "utf8" }).stdout.trim();
  const context = { runId: /^[0-9]+$/.test(process.env.GITHUB_RUN_ID ?? "") ? process.env.GITHUB_RUN_ID : "1", baseSha };
  const artefacten = path.join(tmp, "artefacten");
  const publiceerMap = path.join(tmp, "publiceer");
  const rijen = [];
  let breuken = 0;
  const noteer = (soort, wat, toelichting = "") => {
    if (soort === "BREUK") { breuken += 1; bewaarBreuk("verversing", wat); }
    rijen.push([soort, wat, toelichting]);
    console.log(`${soort === "BREUK" ? "BREUK" : soort}: ${wat}${toelichting ? ` (${toelichting})` : ""}`);
  };
  const uitkomsten = {};
  try {
    for (const jobNaam of DROGE_JOBS) {
      const job = werkstroom.get(jobNaam);
      if (!job) { noteer("BREUK", `job ${jobNaam}`, "staat niet meer in refresh.yml; pas scripts/refresh-droog.mjs aan"); continue; }
      if (jobNaam === "publish-branch" && uitkomsten["refresh/diff"]?.changed !== "true") {
        noteer("overgeslagen", "publish-branch", "refresh meldde geen wijziging");
        continue;
      }
      const runnerTemp = path.join(tmp, "runner", jobNaam);
      fs.mkdirSync(runnerTemp, { recursive: true });
      let cwd = rootDir;
      console.log(`\n=== job ${jobNaam} ===`);
      for (const stap of job.steps) {
        const sleutel = `${jobNaam}/${stap.name ?? stap.uses ?? "?"}`;
        if (stap.uses) {
          const actie = stap.uses.split("@")[0];
          if (actie === "actions/checkout" && jobNaam === "publish-branch") {
            await voerUit(echteGit, ["worktree", "add", "--detach", publiceerMap, baseSha], { stil: true });
            cwd = publiceerMap;
            noteer("nagebootst", sleutel, "schone kopie van de basiscommit (git worktree)");
          } else if (actie === "actions/upload-artifact") {
            const naam = stap.with?.name ?? "artefact";
            const bron = String(stap.with?.path ?? "").replace("${{ runner.temp }}", runnerTemp);
            const doel = path.join(artefacten, naam);
            fs.mkdirSync(doel, { recursive: true });
            if (fs.existsSync(bron)) fs.cpSync(bron, fs.statSync(bron).isDirectory() ? doel : path.join(doel, path.basename(bron)), { recursive: true });
            else noteer("BREUK", sleutel, `${naam}: pad bestaat niet`);
            noteer("nagebootst", sleutel, `${naam} lokaal bewaard, niet opgeladen`);
          } else if (actie === "actions/download-artifact") {
            const naam = stap.with?.name ?? "artefact";
            const doel = String(stap.with?.path ?? "").replace("${{ runner.temp }}", runnerTemp);
            if (fs.existsSync(path.join(artefacten, naam))) fs.cpSync(path.join(artefacten, naam), doel, { recursive: true });
            else noteer("BREUK", sleutel, `${naam} ontbreekt`);
            noteer("nagebootst", sleutel, `${naam} lokaal gekopieerd`);
          } else {
            noteer("al gedaan", sleutel, "de proefjob deed deze stap zelf");
          }
          continue;
        }
        if (!stap.run) { noteer("overgeslagen", sleutel, "geen run en geen uses"); continue; }
        if (stap.run.includes("${{")) { noteer("BREUK", sleutel, "het run-blok bevat ${{ }}; dat kan dit script niet droog draaien"); continue; }
        if (sleutel === OPHALEN && zonderOphalen) {
          // Een datatak-PR: de verversing liep net. Een kleine, verzonnen wijziging laat de rest
          // van de keten (datalijst, patch, commit, binding) toch draaien.
          const status = path.join(rootDir, "site/sources/refresh-status.json");
          const tekst = fs.readFileSync(status, "utf8");
          fs.writeFileSync(status, tekst.replace(/("generatedAt":\s*")[^"]+(")/, `$1${new Date().toISOString()}$2`));
          noteer("nagebootst", sleutel, "DROOG_ZONDER_OPHALEN: alleen generatedAt verzet, geen netwerk");
          continue;
        }
        const uitvoerBestand = path.join(runnerTemp, `output-${randomBytes(4).toString("hex")}`);
        fs.writeFileSync(uitvoerBestand, "");
        const env = {
          ...process.env,
          PATH: `${stubs}${path.delimiter}${process.env.PATH}`,
          GIT_CONFIG_GLOBAL: droogConfig,
          GIT_CONFIG_NOSYSTEM: "1",
          GITHUB_REF: "refs/heads/main",
          GITHUB_EVENT_NAME: "workflow_dispatch",
          GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY || "jonathanvanderelst1997/publieke-agenda-antwerpen",
          GITHUB_OUTPUT: uitvoerBestand,
          GITHUB_STEP_SUMMARY: path.join(runnerTemp, "summary.md"),
          RUNNER_TEMP: runnerTemp,
        };
        for (const [k, v] of Object.entries(stap.env ?? {})) env[k] = droogEnv(k, v, context);
        const script = path.join(tmp, `stap-${randomBytes(4).toString("hex")}.sh`);
        fs.writeFileSync(script, stap.run);
        console.log(`--- ${stap.name}`);
        const { code, uitvoer } = await voerUit("bash", ["-e", script], { cwd, env });
        const outputs = Object.fromEntries(fs.readFileSync(uitvoerBestand, "utf8").split("\n").filter((r) => r.includes("=")).map((r) => [r.slice(0, r.indexOf("=")), r.slice(r.indexOf("=") + 1)]));
        if (stap.id === "diff") uitkomsten["refresh/diff"] = outputs;
        uitkomsten[sleutel] = { code, uitvoer };
        const v = VERWACHTING[sleutel] ?? {};
        const magFalen = stap.continueOnError || v.magFalen || (zonderOphalen && ZONDER_OPHALEN_MAG_FALEN.has(sleutel));
        if (v.breuk && v.breuk.test(uitvoer)) noteer("BREUK", sleutel, `uitvoer wijst op date/jq/bash: ${v.breuk.source}`);
        else if (code === 0) noteer(v.letOp?.test(uitvoer) ? "let op" : "ok", sleutel, v.letOp?.test(uitvoer) ? "live agenda niet te lezen (netwerk of date)" : "");
        else if (magFalen) noteer("faalt (mag)", sleutel, `code ${code}: toestand van de bronnen of de live site`);
        else noteer("BREUK", sleutel, `code ${code}`);
      }
    }
    const commitStap = rijen.find((r) => r[1] === "publish-branch/Eén datacommit op een eigen tak");
    if (commitStap?.[0] === "ok") {
      // De opruimstap kreeg de verzonnen takkenlijst van de stub: de drie oudste moeten weg.
      const opgeruimd = [...uitkomsten["publish-branch/Eén datacommit op een eigen tak"].uitvoer.matchAll(/^Opgeruimd: (\S+)$/gm)].map((m) => m[1]);
      const juist = opgeruimd.join(",") === OPGERUIMD.join(",");
      noteer(juist ? "ok" : "BREUK", "opruimen van oude datatakken (sort/tail)", juist ? "de drie oudste" : `kreeg ${opgeruimd.join(", ") || "niets"}`);
      const binding = path.join(artefacten, "data-lane-binding", "data-lane-binding.json");
      try {
        const b = JSON.parse(fs.readFileSync(binding, "utf8"));
        const ok = b.base_sha === baseSha && /^[0-9a-f]{40}$/.test(b.head_sha) && /^data\/refresh-[0-9]{8}-[0-9]+$/.test(b.branch) && Array.isArray(b.files) && b.files.length > 0;
        noteer(ok ? "ok" : "BREUK", "binding (data-lane-binding.json)", ok ? `${b.files.length} bestand(en)` : "onvolledige binding");
      } catch {
        noteer("BREUK", "binding (data-lane-binding.json)", "ontbreekt of is geen JSON");
      }
    }
  } finally {
    if (fs.existsSync(publiceerMap)) spawnSync(echteGit, ["worktree", "remove", "--force", publiceerMap], { cwd: rootDir });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  schrijfSamenvatting(`Ubuntu-proef: droge verversing${zonderOphalen ? " (zonder ophalen)" : ""}`, rijen);
  if (breuken) console.log(`::error title=Ubuntu-proef::Droge verversing: ${breuken} breuk(en); zie de regels met BREUK.`);
  else console.log("Droge verversing zonder breuk.");
  return breuken ? 1 : 0;
}

// ---------- breuken doorgeven en het oordeel ----------

/**
 * De breuken van één job als lijst: de regels uit DROOG_BREUKEN, plus "stap: <id>" voor een stap
 * die faalde zonder zelf iets te noteren (npm ci, npm run check, een script dat crashte).
 */
export function verzamelBreuken(regels, stappen) {
  const lijst = [...new Set(String(regels ?? "").split("\n").map((r) => r.trim()).filter(Boolean))];
  for (const [id, stap] of Object.entries(stappen ?? {})) {
    if (stap?.outcome !== "failure") continue;
    if (lijst.some((r) => r.startsWith(`${id}: `))) continue;
    lijst.push(`stap: ${id}`);
  }
  return lijst;
}

function breukenStap(env = process.env) {
  let regels = "";
  const bestand = breukenBestand(env);
  try { regels = bestand ? fs.readFileSync(bestand, "utf8") : ""; } catch { regels = ""; }
  let stappen = {};
  try { stappen = JSON.parse(env.STAPPEN || "{}"); } catch { stappen = {}; }
  const lijst = verzamelBreuken(regels, stappen);
  console.log(lijst.length ? `${lijst.length} breuk(en) in deze job:` : "Geen breuken in deze job.");
  for (const r of lijst) console.log(neutraal(r));
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `lijst=${JSON.stringify(lijst)}\n`);
  return 0;
}

const leesLijst = (tekst) => {
  try {
    const v = JSON.parse(tekst);
    return Array.isArray(v) ? v.map(String) : null;
  } catch {
    return null;
  }
};

/**
 * Het oordeel over 26.04. proef en controle zijn de JSON-lijsten uit de stap "breuken" (of leeg
 * als die job geen uitkomst gaf). De controle op 24.04 draait alleen als de proef iets vond.
 * Geeft { echt, ookOp2404, zonderControle, onbekend }.
 */
export function oordeel({ proef, controle }) {
  const p = leesLijst(proef ?? "");
  if (!p) return { echt: [], ookOp2404: [], zonderControle: false, onbekend: true };
  const c = leesLijst(controle ?? "");
  if (!p.length) return { echt: [], ookOp2404: [], zonderControle: false, onbekend: false };
  if (!c) return { echt: p, ookOp2404: [], zonderControle: true, onbekend: false };
  const opControle = new Set(c);
  return { echt: p.filter((b) => !opControle.has(b)), ookOp2404: p.filter((b) => opControle.has(b)), zonderControle: false, onbekend: false };
}

function oordeelStap(env = process.env) {
  const o = oordeel({ proef: env.PROEF, controle: env.CONTROLE });
  const rijen = [];
  if (o.onbekend) {
    console.log("::error title=Ubuntu-proef::Geen uitkomst van ubuntu-26.04-proef (de job startte niet of stopte vroeg). Bekijk die job.");
    rijen.push(["onbekend", "ubuntu-26.04-proef", "geen uitkomst"]);
  } else {
    for (const b of o.echt) { console.log(neutraal(`BREUK op 26.04${o.zonderControle ? " (geen controle)" : ", niet op 24.04"}: ${b}`)); rijen.push(["BREUK", b, o.zonderControle ? "geen controle op 24.04" : "alleen op 26.04"]); }
    for (const b of o.ookOp2404) { console.log(neutraal(`ook op 24.04 (ligt niet aan 26.04): ${b}`)); rijen.push(["ook op 24.04", b, "live data of code, niet de overstap"]); }
    if (o.echt.length) console.log(`::error title=Ubuntu-proef::${o.echt.length} breuk(en) die alleen op 26.04 optreden. Zie docs/UBUNTU_2604.md.`);
    else console.log(o.ookOp2404.length ? "Geen breuk door 26.04; wat faalt, faalt ook op 24.04." : "Geen breuk op 26.04.");
  }
  schrijfSamenvatting("Ubuntu-proef: oordeel (26.04 tegen 24.04)", rijen);
  const echt = o.onbekend ? "onbekend" : String(o.echt.length);
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `echt=${echt}\n`);
  return echt === "0" ? 0 : 1;
}

// ---------- runners: nooit self-hosted ----------

// GitHub-gehoste labels: gratis voor een publieke repo, en een verse machine per job. Al de rest is
// self-hosted (zoals de Mac van de eigenaar) of een eigen, betaalde runnergroep.
export const GEHOST_LABEL = /^(?:ubuntu-slim|(?:ubuntu|windows|macos)-(?:latest|[0-9]+(?:\.[0-9]+)?)(?:-(?:arm|arm64|intel|large|xlarge))?)$/;

const WAAROM = "deze repo is publiek: elke fork kan een PR openen, en die code zou dan op die machine draaien (bv. de Mac van de eigenaar)";

const kaal = (waarde) => waarde.trim().replace(/^(["'])(.*)\1$/, "$2");
const scalaire = (waarde) => {
  const v = waarde.replace(/(^|\s)#.*$/, "").trim();
  if (/^\[.*\]$/.test(v)) return v.slice(1, -1).split(",").map(kaal).filter(Boolean);
  return v ? [kaal(v)] : [];
};

/** Waarden van matrix.<sleutel> in een jobblok: "sleutel: [a, b]", een lijst eronder, of include. */
function matrixWaarden(blok, sleutel) {
  const start = blok.findIndex((r) => /^\s+matrix:\s*$/.test(r));
  if (start < 0) return null;
  const waarden = [];
  for (let i = start + 1; i < blok.length; i += 1) {
    const m = blok[i].match(new RegExp(`^(\\s+)(?:- )?${sleutel}:\\s*(.*)$`));
    if (!m) continue;
    if (m[2].trim()) { waarden.push(...scalaire(m[2])); continue; }
    for (let j = i + 1; j < blok.length && /^\s+- /.test(blok[j]) && blok[j].match(/^\s*/)[0].length > m[1].length; j += 1) {
      waarden.push(...scalaire(blok[j].replace(/^\s+- /, "")));
    }
  }
  return waarden.length ? waarden : null;
}

/**
 * Fouten in de runners van een werkstroom: self-hosted, een eigen label of een runnergroep.
 * GitHub-gehoste labels mogen allemaal (ubuntu-*, macos-*, windows-*), ook vastgezet
 * (ubuntu-24.04) en via ${{ matrix.x }} als de matrix alleen zulke labels heeft.
 */
export function runnerFouten(tekst) {
  const regels = tekst.split(/\r?\n/);
  const fouten = [];
  regels.forEach((r, i) => {
    if (/self-hosted/.test(r.replace(/(^|\s)#.*$/, ""))) fouten.push(`regel ${i + 1}: self-hosted; ${WAAROM}`);
  });
  const start = regels.indexOf("jobs:");
  if (start < 0) return fouten;
  const jobs = [];
  for (let i = start + 1; i < regels.length; i += 1) {
    const kop = regels[i].match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (kop) jobs.push({ naam: kop[1], van: i + 1 });
    else if (/^\S/.test(regels[i])) break;
  }
  jobs.forEach((job, k) => {
    const tot = k + 1 < jobs.length ? jobs[k + 1].van - 1 : regels.length;
    const blok = regels.slice(job.van, tot);
    const i = blok.findIndex((r) => /^ {4}runs-on:/.test(r));
    if (i < 0) return; // een herbruikbare werkstroom (uses:) heeft geen runs-on
    const waarde = blok[i].replace(/^ {4}runs-on:/, "");
    let labels = scalaire(waarde);
    if (!labels.length) {
      // Blokvorm: group/labels of een lijst.
      for (let j = i + 1; j < blok.length && /^ {6}/.test(blok[j]); j += 1) {
        const r = blok[j].trim();
        if (/^group:/.test(r)) fouten.push(`${job.naam}: runnergroep "${scalaire(r.slice(6)).join(",")}" (eigen runners); ${WAAROM}`);
        else if (/^labels:/.test(r)) labels.push(...scalaire(r.slice(7)));
        else if (/^- /.test(r)) labels.push(...scalaire(r.slice(2)));
      }
    }
    const uit = [];
    for (const label of labels) {
      const expr = label.match(/^\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}$/);
      if (expr) {
        const waarden = matrixWaarden(blok, expr[1]);
        if (!waarden) fouten.push(`${job.naam}: runs-on ${label} niet na te gaan; zet de labels als lijst in strategy.matrix.${expr[1]}`);
        else uit.push(...waarden);
      } else if (/\$\{\{/.test(label)) {
        fouten.push(`${job.naam}: runs-on ${label} niet na te gaan; gebruik een vast GitHub-label of matrix.<sleutel> met een lijst`);
      } else uit.push(label);
    }
    for (const label of uit) {
      if (label === "self-hosted") continue; // al gemeld hierboven
      if (!GEHOST_LABEL.test(label)) fouten.push(`${job.naam}: label "${label}" is geen GitHub-gehoste runner (ubuntu-*, macos-*, windows-*); ${WAAROM}`);
    }
  });
  return fouten;
}

export async function main(argv = process.argv.slice(2)) {
  if (argv[0] === "gereedschap" && argv.length === 1) return gereedschap();
  if (argv[0] === "verversing" && argv.length === 1) return verversing();
  if (argv[0] === "breuken" && argv.length === 1) return breukenStap();
  if (argv[0] === "oordeel" && argv.length === 1) return oordeelStap();
  console.error("Gebruik: node scripts/refresh-droog.mjs gereedschap | verversing | breuken | oordeel");
  return 2;
}

if (isMainModule(import.meta.url)) process.exitCode = await main();
