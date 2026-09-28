import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import vm from 'node:vm'

const index = await readFile(new URL('../site/index.html', import.meta.url), 'utf8')
const fallback = await readFile(new URL('../site/404.html', import.meta.url), 'utf8')
const source = await readFile(new URL('../site/agenda.js', import.meta.url), 'utf8')
const manifest = JSON.parse(await readFile(new URL('../site/public-agenda-manifest.json', import.meta.url), 'utf8'))

assert.match(index, /href="\/styles\.css"/)
assert.match(index, /src="\/agenda\.js"/)
assert.match(index, /src="\/agenda-ics\.js"/)
assert.match(index, /src="\/agenda-feed\.js"/)
assert.match(index, /name="referrer" content="strict-origin-when-cross-origin"/)
assert.match(index, /property="og:title"/)
assert.match(index, /application\/ld\+json/)
assert.match(index, /class="skip-link"/)
assert.match(fallback, /pathname\.match/)
assert.match(fallback, /decodeURIComponent/)
assert.match(fallback, /\?event=/)
assert.match(source, /requestedEventId/)
assert.match(source, /event-deep-link/)
assert.match(source, /history\.replaceState/)
assert.match(source, /event-calendar/)

const ids = [...source.matchAll(/^\s+"id":\s+"([^"]+)"/gm)].map((match) => match[1])
assert.ok(ids.length >= 100, `expected at least 100 source event IDs, got ${ids.length}`)
assert.equal(new Set(ids).size, ids.length, 'source event IDs must be unique')
assert.ok(ids.every((id) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)), 'event IDs must be URL-path safe slugs')

// Ids uit de automatische bronnen (site/agenda-feed.js) zijn even geldig als letterlijke ids.
const feedUrl = new URL('../site/agenda-feed.js', import.meta.url)
const feedContext = { window: {} }
if (existsSync(feedUrl)) vm.runInNewContext(await readFile(feedUrl, 'utf8'), feedContext, { timeout: 1_000 })
const feedIds = (feedContext.window.PUBLIC_AGENDA_FEED?.items ?? []).map((item) => item.id)
assert.equal(new Set(feedIds).size, feedIds.length, 'feed event IDs must be unique')
assert.ok(feedIds.every((id) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)), 'feed event IDs must be URL-path safe slugs')
assert.ok(feedIds.every((id) => !ids.includes(id)), 'feed IDs must not collide with literal IDs')
const knownIds = new Set([...ids, ...feedIds])

const eventPageRoot = new URL('../site/event/', import.meta.url)
const eventPageDirs = (await readdir(eventPageRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
assert.equal(eventPageDirs.length, manifest.eventPageCount, 'one static HTTP-200 route must exist per public event with an event page')
assert.ok(manifest.eventPageCount <= manifest.count)
for (const id of eventPageDirs) {
  assert.ok(knownIds.has(id), `generated event page has unknown source id: ${id}`)
  const page = await readFile(new URL(`../site/event/${id}/index.html`, import.meta.url), 'utf8')
  assert.match(page, new RegExp(`\\?event=${id}`))
  assert.match(page, new RegExp(`/event/${id}/`))
  assert.match(page, /property="og:title"/)
  assert.match(page, /application\/ld\+json/)
  assert.doesNotMatch(page, /window\.location\.replace/)
}

const robots = await readFile(new URL('../site/robots.txt', import.meta.url), 'utf8')
const sitemap = await readFile(new URL('../site/sitemap.xml', import.meta.url), 'utf8')
assert.match(robots, /Sitemap: https:\/\/mijn-publieke-agenda-voor-district\.onrender\.com\/sitemap\.xml/)
assert.equal((sitemap.match(/<url>/g) ?? []).length, manifest.eventPageCount + 1)
assert.match(source, /aria-pressed/)
assert.match(source, /aria-controls/)
assert.match(source, /aria-hidden="true"/)

console.log(JSON.stringify({
  sourceEventIds: ids.length,
  uniqueSourceEventIds: new Set(ids).size,
  feedEventIds: feedIds.length,
  staticEventPages: eventPageDirs.length,
  routeForms: ['/event/:id', '/?event=:id', '#event=:id'],
  result: 'PASS',
}, null, 2))
