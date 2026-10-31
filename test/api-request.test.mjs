import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import http from 'node:http'
import { createSafeLookup, createApiFetcher } from '../lib/api-request.mjs'

const lookup = (fn, host, options = {}) => new Promise((resolve, reject) => fn(host, options, (error, address, family) => error ? reject(error) : resolve({ address, family })))

test('DNS answers are checked and the validated addresses are pinned to the socket lookup', async () => {
  let calls = 0
  const safe = createSafeLookup(async () => { calls++; return [{ address: '192.168.1.2', family: 4 }, { address: '::1', family: 6 }] })
  assert.deepEqual(await lookup(safe, 'gateway.example'), { address: '192.168.1.2', family: 4 })
  assert.equal(calls, 1)
  assert.equal((await lookup(safe, 'gateway.example', { all: true })).address.length, 2)
  for (const address of ['169.254.169.254', '100.100.100.200', '::ffff:169.254.169.254']) {
    const blocked = createSafeLookup(async () => [{ address: '192.0.2.1', family: 4 }, { address, family: address.includes(':') ? 6 : 4 }])
    await assert.rejects(lookup(blocked, 'alias.example'))
  }
})

function transport(status, body, record) {
  return (url, options, onResponse) => {
    record.push({ url, options })
    const req = new EventEmitter()
    req.destroy = () => {}
    req.end = (requestBody) => {
      record.at(-1).body = requestBody
      queueMicrotask(() => {
        const res = new PassThrough()
        res.statusCode = status
        onResponse(res)
        if (!res.destroyed) res.end(body)
      })
    }
    return req
  }
}
test('API transport preserves request content and JSON response, and disables socket reuse', async () => {
  const calls = []
  const fetch = createApiFetcher({ httpsRequest: transport(200, '{"remaining":42}', calls) })
  const res = await fetch('https://gateway.example/balance', { method: 'POST', headers: { Authorization: 'Bearer FAKE' }, body: '{"id":1}' })
  assert.equal(res.ok, true)
  assert.deepEqual(await res.json(), { remaining: 42 })
  assert.equal(calls[0].options.agent, false)
  assert.equal(typeof calls[0].options.lookup, 'function')
  assert.equal(calls[0].body, '{"id":1}')
})
test('redirects and oversized responses are rejected without a follow-up request', async () => {
  for (const status of [301, 302, 307, 308]) {
    const calls = []
    const fetch = createApiFetcher({ httpsRequest: transport(status, '', calls) })
    await assert.rejects(fetch('https://gateway.example'), /重定向/)
    assert.equal(calls.length, 1)
  }
  const fetch = createApiFetcher({ httpRequest: transport(200, Buffer.alloc(2 * 1024 * 1024 + 1), []) })
  await assert.rejects(fetch('http://127.0.0.1'), /响应过大/)
})

test('real loopback HTTP keeps local gateways working and uses the validated DNS answer', async (t) => {
  const requests = []
  const server = http.createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    requests.push({ url: req.url, authorization: req.headers.authorization, body })
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/must-not-follow' })
      res.end()
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"remaining":12}')
    }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  t.after(() => new Promise((resolve) => server.close(resolve)))
  let resolutions = 0
  const fetch = createApiFetcher({ resolve: async () => { resolutions++; return [{ address: '127.0.0.1', family: 4 }] } })
  const base = 'http://gateway.test:' + server.address().port
  const result = await fetch(base + '/balance', { method: 'POST', headers: { Authorization: 'Bearer FAKE_ONLY' }, body: '{"account":"test"}' })
  assert.deepEqual(await result.json(), { remaining: 12 })
  assert.equal(resolutions, 1)
  assert.deepEqual(requests[0], { url: '/balance', authorization: 'Bearer FAKE_ONLY', body: '{"account":"test"}' })
  await assert.rejects(fetch(base + '/redirect'), /重定向/)
  assert.equal(requests.length, 2)
  assert.equal(requests.some((req) => req.url === '/must-not-follow'), false)
})
