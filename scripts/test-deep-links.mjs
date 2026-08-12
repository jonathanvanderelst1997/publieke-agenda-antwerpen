import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const index = await readFile(new URL('../site/index.html', import.meta.url), 'utf8')
const fallback = await readFile(new URL('../site/404.html', import.meta.url), 'utf8')
const source = await readFile(new URL('../site/agenda.js', import.meta.url), 'utf8')

assert.match(index, /href="\/styles\.css"/)
assert.match(index, /src="\/agenda\.js"/)
assert.match(fallback, /pathname\.match/)
assert.match(fallback, /decodeURIComponent/)
assert.match(fallback, /\?event=/)
assert.match(source, /requestedEventId/)
assert.match(source, /event-deep-link/)
assert.match(source, /history\.replaceState/)

const ids = [...source.matchAll(/^\s+"id":\s+"([^"]+)"/gm)].map((match) => match[1])
assert.ok(ids.length >= 100, `expected at least 100 source event IDs, got ${ids.length}`)
assert.equal(new Set(ids).size, ids.length, 'source event IDs must be unique')
assert.ok(ids.every((id) => !/[/?#]/.test(id)), 'event IDs must be URL-path safe')

console.log(JSON.stringify({
  sourceEventIds: ids.length,
  uniqueSourceEventIds: new Set(ids).size,
  routeForms: ['/event/:id', '/?event=:id', '#event=:id'],
  result: 'PASS',
}, null, 2))
