import fs from 'node:fs'
import assert from 'node:assert/strict'

const yaml = fs.readFileSync(new URL('../render.yaml', import.meta.url), 'utf8')
const required = [
  ['X-Frame-Options', 'DENY'],
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
]
for (const [name, value] of required) {
  assert(yaml.includes(`name: ${name}`), `render.yaml missing ${name}`)
  assert(yaml.includes(`value: ${value}`), `render.yaml missing expected ${name} value ${value}`)
}
const globalHeaderBlocks = (yaml.match(/- path: \/\*/g) || []).length
assert(globalHeaderBlocks >= required.length, 'required headers must apply to /*')
console.log('Render security-header config regression: ok')
