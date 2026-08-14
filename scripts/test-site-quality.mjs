import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const index = await readFile(new URL("../site/index.html", import.meta.url), "utf8");
const source = await readFile(new URL("../site/agenda.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../site/styles.css", import.meta.url), "utf8");
const renderConfig = await readFile(new URL("../render.yaml", import.meta.url), "utf8");

assert.match(index, /<html lang="nl-BE">/);
assert.match(index, /<main id="main-content"/);
assert.match(index, /name="description"/);
assert.match(index, /property="og:title"/);
assert.match(index, /name="twitter:card"/);
assert.match(index, /application\/ld\+json/);
assert.match(source, /setAttribute\("aria-pressed"/);
assert.match(source, /aria-controls="details-/);
assert.match(source, /aria-hidden="true"/);
assert.match(styles, /--accent: #8b5a11/);
assert.doesNotMatch(styles, /--accent: #b7791f/);
assert.doesNotMatch(styles, /#667789/);
assert.match(renderConfig, /name: X-Frame-Options\s+value: DENY/);
assert.match(renderConfig, /name: Referrer-Policy\s+value: strict-origin-when-cross-origin/);

console.log("Site quality contract passed: metadata, a11y state, contrast and declared headers.");
