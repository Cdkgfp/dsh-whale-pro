import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequestGuard, cleanConfig, parseConfigJson, isSafeModelId, isLoopbackAddress, managedCredentialRef, assertSafeApiUrl } from '../lib/security.mjs'

const route = { path: '/dsh-whale/api-models.json' }
function request(method = 'POST', headers = {}, remoteAddress = '127.0.0.1') {
  return { method, headers: { host: 'localhost:3000', ...headers }, socket: { remoteAddress } }
}
function check(ctx, req = request(), options = {}, target = route) {
  const res = { writeHead(status, headers) { this.status = status; this.headers = headers }, end(body) { this.body = body } }
  const denied = createRequestGuard(ctx, { warn() {}, ...options })(req, res, target)
  return { denied, ...res }
}
const authorized = () => ({ get: () => ({ requestRejection: () => undefined }) })

test('missing, throwing, malformed, and disappearing host admission all fail closed', () => {
  for (const ctx of [{}, { get: () => ({}) }, { get() { throw new Error('lookup') } }, { get: () => ({ requestRejection() { throw new Error('auth') } }) }]) {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) assert.equal(check(ctx, request(method)).status, 503)
  }
  for (const code of [null, false, true, 0, 200, NaN, Promise.resolve(undefined), '401']) {
    assert.equal(check({ get: () => ({ requestRejection: () => code }) }).status, 503)
  }
  for (const code of [401, 403]) assert.equal(check({ get: () => ({ requestRejection: () => code }) }).status, code)
  let conn = { requestRejection: () => undefined }
  const guard = createRequestGuard({ get: () => conn }, { warn() {} })
  assert.equal(guard(request(), { writeHead() {}, end() {} }, route), false)
  conn = null
  let status
  assert.equal(guard(request(), { writeHead(code) { status = code }, end() {} }, route), true)
  assert.equal(status, 503)
})

test('writes require both a loopback connection and loopback Host, or authenticated explicit admin authority', () => {
  assert.equal(check(authorized()).denied, false)
  for (const address of ['::1', '::ffff:127.0.0.1', '0:0:0:0:0:ffff:7f00:1']) assert.equal(check(authorized(), request('POST', {}, address)).denied, false)
  for (const address of ['192.0.2.5', 'localhost', undefined]) assert.equal(check(authorized(), { ...request(), socket: { remoteAddress: address } }).status, 403)
  assert.equal(check(authorized(), request('POST', { host: 'admin.example:3000' })).status, 403)
  assert.equal(check(authorized(), request('POST', { host: 'admin.example:3000' }, '192.0.2.5'), { adminHosts: 'admin.example:3000' }).denied, false)
  assert.equal(check({}, request(), { adminHosts: 'localhost:3000' }).status, 503)
  assert.equal(check(authorized(), request('GET', { host: 'admin.example:3000' }, '192.0.2.5')).denied, false)
})

test('browser fence rejects cross-site, opaque, malformed, and mismatched origins', () => {
  for (const headers of [{ 'sec-fetch-site': 'cross-site' }, { origin: 'null' }, { origin: 'https://evil.example' }, { host: 'localhost:3000@evil.example' }, { host: ['localhost'] }, { host: '' }]) {
    assert.equal(check(authorized(), request('GET', headers)).status, 403)
  }
  assert.equal(check(authorized(), request('POST', { origin: 'http://localhost:3000' })).denied, false)
  // The host permits HTTPS at a reverse proxy while the upstream transport is HTTP.
  assert.equal(check(authorized(), request('POST', { host: 'localhost:443', origin: 'https://localhost' })).denied, false)
})

test('mutation-only routes refuse GET/HEAD before entering handlers', () => {
  for (const path of ['role-pin.json', 'role-delete.json', 'bubble-img-upload.json']) {
    for (const method of ['GET', 'HEAD', 'PATCH', 'DELETE', 'OPTIONS']) {
      const result = check(authorized(), request(method), {}, { path: '/dsh-whale/' + path })
      assert.equal(result.status, 405)
      assert.equal(result.headers.Allow, 'POST, PUT')
    }
  }
})

test('model IDs, recursive patches, and credential references cannot escape their scope', () => {
  for (const id of ['__proto__', 'constructor', 'prototype', '../x', '', 'a'.repeat(81)]) assert.equal(isSafeModelId(id), false)
  for (const id of ['deepseek', 'api_test-1']) assert.equal(isSafeModelId(id), true)
  const config = parseConfigJson('{"events":{"__proto__":{"polluted":true},"question":{"on":true}},"constructor":{"prototype":{"polluted":true}}}')
  assert.equal(Object.hasOwn(config, 'constructor'), false)
  assert.equal(Object.hasOwn(config.events, '__proto__'), false)
  assert.equal(config.events.question.on, true)
  assert.equal(({}).polluted, undefined)
  let deep = {}; for (let i = 0; i < 40; i++) deep = { value: deep }
  assert.throws(() => cleanConfig(deep), /层级/)
  const templates = { deepseek: { keyRef: 'DEEPSEEK_API_KEY' }, codex: { keyRef: '' } }
  for (const ref of ['DEEPSEEK_API_KEY', 'DSHW_MY_GATEWAY']) assert.equal(managedCredentialRef(ref, templates), true)
  for (const ref of ['OTHER_SECRET', 'client-connection/browser-session', '__proto__', 'DSHW_', 'DSHW_' + 'x'.repeat(60)]) assert.equal(managedCredentialRef(ref, templates), false)
})

test('API URL checks cover mapped IPv4, NAT64, metadata aliases, and unsafe schemes', () => {
  for (const url of ['file:///tmp/key', 'https://user:pass@example.com', 'http://metadata.google.internal./', 'http://169.254.169.254', 'http://0xA9FEA9FE', 'http://100.100.100.200', 'http://[::ffff:169.254.169.254]', 'http://[::ffff:100.100.100.200]', 'http://[64:ff9b::a9fe:a9fe]', 'http://[fe80::1]', 'http://[::]']) assert.throws(() => assertSafeApiUrl(url), undefined, url)
  for (const url of ['https://api.deepseek.com/user/balance', 'http://127.0.0.1:11434/v1', 'http://192.168.1.5/v1', 'http://[::1]:11434']) assert.doesNotThrow(() => assertSafeApiUrl(url))
  assert.equal(isLoopbackAddress('127.0.0.1.evil.example'), false)
})
