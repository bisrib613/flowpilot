// Explicit live check; never part of normal offline tests or frontend bundles.
const fs = require('node:fs')
const assert = require('node:assert/strict')

async function main() {
  const source = fs.readFileSync('src-tauri/src/name_generator.rs', 'utf8')
  const key = process.env.BEHIND_THE_NAME_API_KEY?.trim()
  const endpoint = source.match(/client\.get\("([^"]+)"\)/)?.[1]
  if (!key) {
    console.log('Behind the Name live check SKIPPED: BEHIND_THE_NAME_API_KEY is not configured.')
    return
  }
  assert.ok(endpoint, 'Native API endpoint missing')
  const url = new URL(endpoint)
  assert.equal(url.origin, 'https://www.behindthename.com')
  url.searchParams.set('key', key)
  url.searchParams.set('usage', 'ins')
  url.searchParams.set('number', '2')
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) })
  assert.ok(response.ok, `Provider returned HTTP ${response.status}`)
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    assert.ok(size <= 8192, 'Provider response too large')
    chunks.push(chunk)
  }
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  const names = Array.isArray(payload) ? payload : payload.names
  assert.ok(Array.isArray(names) && names.length > 0 && names.length <= 6, 'No valid names array returned')
  const name = names.map(part => {
    assert.equal(typeof part, 'string', 'Invalid name component')
    return part.trim().replace(/\s+/g, ' ')
  }).join(' ')
  assert.ok(/^[\p{L} '\-’]+$/u.test(name) && [...name].length <= 100, 'Unexpected name format')
  console.log(`Behind the Name live check passed: HTTP ${response.status}; Indonesian name: ${name}`)
}
main().catch(error => {
  // Fetch error messages can include the full credential-bearing URL. Emit only
  // our own assertion message, never the request, response body, or error stack.
  console.error(error.code === 'ERR_ASSERTION' ? error.message : `Live API check failed (${error.name || 'Error'})`)
  process.exitCode = 1
})
