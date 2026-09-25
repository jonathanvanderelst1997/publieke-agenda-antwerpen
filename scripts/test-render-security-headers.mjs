import fs from 'node:fs'
import assert from 'node:assert/strict'

const yaml = fs.readFileSync(new URL('../render.yaml', import.meta.url), 'utf8')
const required = new Map([
  ['X-Frame-Options', 'DENY'],
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
])

const lines = yaml.split(/\r?\n/)
const blocks = []
let current = null
for (const rawLine of lines) {
  const line = rawLine.trim()
  const pathMatch = line.match(/^- path:\s*(.+)$/)
  if (pathMatch) {
    if (current) blocks.push(current)
    current = { path: pathMatch[1].trim(), name: null, value: null }
    continue
  }
  if (!current) continue
  const nameMatch = line.match(/^name:\s*(.+)$/)
  const valueMatch = line.match(/^value:\s*(.+)$/)
  if (nameMatch) current.name = nameMatch[1].trim()
  if (valueMatch) current.value = valueMatch[1].trim()
}
if (current) blocks.push(current)

for (const [name, value] of required) {
  const matches = blocks.filter((block) => block.name === name)
  assert.equal(matches.length, 1, `${name} must appear in exactly one parsed header block`)
  assert.equal(matches[0].path, '/*', `${name} must apply to /*`)
  assert.equal(matches[0].value, value, `${name} must equal ${value}`)
}

const globalNamedHeaders = blocks.filter((block) => block.path === '/*' && block.name)
const duplicates = globalNamedHeaders
  .map((block) => block.name)
  .filter((name, index, all) => all.indexOf(name) !== index)
assert.deepEqual(duplicates, [], `duplicate global header blocks: ${duplicates.join(', ')}`)

console.log(`Render security-header config regression: ok (${required.size} exact global headers)`)
