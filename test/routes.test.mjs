import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PassThrough } from 'node:stream'

test('registered backend routes enforce admission before data access and preserve authorized settings', async (t) => {
  const testRoot = path.dirname(fileURLToPath(import.meta.url))
  const tempRoot = fs.mkdtempSync(path.join(testRoot, '.runtime-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = tempRoot
  const { default: plugin } = await import('../lib/index.js')
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  t.after(() => {
    const relative = path.relative(testRoot, tempRoot)
    assert.match(relative, /^\.runtime-[^\\/]+$/)
    fs.rmSync(tempRoot, { recursive: true, force: true })
  })
  const routes = new Map()
  const cleanups = []
  const credentialCalls = []
  let structuredDeletionCalls = 0
  let credentialReads = 0
  let conn = { requestRejection: () => undefined }
  const ctx = {
    get(name) { return name === 'connection' ? conn : null },
    on() { return () => {} },
    effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
    inject(names, fn) { fn(ctx) },
    credentials: {
      async resolve() { credentialReads++; return null },
      async set(ref, value) { credentialCalls.push({ action: 'set', ref, value }) },
      async unset(ref) { credentialCalls.push({ action: 'unset', ref }) },
      async deleteRecord() { structuredDeletionCalls++; throw new Error('must never use structured-record deletion') },
    },
    webServer: { register(route) { routes.set(route.path, route); return () => {} }, tapIndex() { return () => {} } },
  }
  plugin.apply(ctx)
  t.after(() => { for (const dispose of cleanups.reverse()) dispose() })
  async function invoke(routePath, method, input, { host = 'localhost:3000', remoteAddress = '127.0.0.1' } = {}) {
    const req = new PassThrough()
    Object.assign(req, { method, url: routePath, headers: { host, 'content-type': 'application/json' }, socket: { remoteAddress } })
    const res = { writeHead(status, headers) { this.status = status; this.headers = headers }, end(body) { this.body = body } }
    const pending = routes.get(routePath.split('?')[0]).handler(req, res)
    req.end(input === undefined ? undefined : JSON.stringify(input))
    await pending
    return res
  }
  await t.test('every registered route refuses missing host authentication, even with trusted-looking Host', async () => {
    assert.equal(routes.size, 26)
    const filesBefore = fs.readdirSync(tempRoot)
    conn = {}
    for (const routePath of routes.keys()) {
      for (const method of ['GET', 'POST', 'PUT']) assert.equal((await invoke(routePath, method, { action: 'set-key', keyRef: 'DEEPSEEK_API_KEY', keyValue: 'FAKE' })).status, 503, `${method} ${routePath}`)
    }
    assert.equal(credentialReads, 0)
    assert.equal(credentialCalls.length, 0)
    assert.deepEqual(fs.readdirSync(tempRoot), filesBefore)
    conn = { requestRejection: () => 401 }
    assert.equal((await invoke('/dsh-whale/api-models.json', 'POST', { action: 'set-key' })).status, 401)
    conn = { requestRejection: () => undefined }
  })
  await t.test('authenticated local settings still save and read back', async () => {
    assert.equal((await invoke('/dsh-whale/size.json', 'PUT', { scale: 1.25, sound: false })).status, 200)
    const config = JSON.parse((await invoke('/dsh-whale/size.json', 'GET')).body)
    assert.equal(config.scale, 1.25)
    assert.equal(config.sound, false)
    assert.equal(config.version, '0.4.4')
    assert.equal((await invoke('/dsh-whale/size.json', 'PUT', { scale: 2 }, { remoteAddress: '192.0.2.8' })).status, 403)
  })
  await t.test('GET cannot delete or pin resources', async () => {
    for (const routePath of ['/dsh-whale/role-pin.json', '/dsh-whale/role-delete.json', '/dsh-whale/bubble-img-upload.json']) assert.equal((await invoke(routePath, 'GET', { id: 'role_test', action: 'delete' })).status, 405)
  })
  await t.test('credential writes are scoped and structured records cannot be deleted', async () => {
    const api = '/dsh-whale/api-models.json'
    for (const ref of ['OTHER_SECRET', 'client-connection/browser-session', '__proto__']) {
      for (const action of ['set-key', 'delete-key']) assert.equal((await invoke(api, 'POST', { action, keyRef: ref, keyValue: 'FAKE' })).status, 400)
    }
    assert.equal(credentialCalls.length, 0)
    for (const ref of ['DEEPSEEK_API_KEY', 'DSHW_TEST_API_KEY']) {
      assert.equal((await invoke(api, 'POST', { action: 'set-key', keyRef: ref, keyValue: 'FAKE' })).status, 200)
      assert.equal((await invoke(api, 'POST', { action: 'delete-key', keyRef: ref })).status, 200)
    }
    assert.equal(credentialCalls.length, 4)
    const unset = ctx.credentials.unset
    delete ctx.credentials.unset
    assert.equal((await invoke(api, 'POST', { action: 'delete-key', keyRef: 'DEEPSEEK_API_KEY' })).status, 400)
    assert.equal(structuredDeletionCalls, 0)
    ctx.credentials.unset = unset
    const builtin = await invoke(api, 'POST', { model: { id: 'deepseek', provider: 'deepseek', keyRef: 'DEEPSEEK_API_KEY' }, keyValue: 'FAKE_BUILTIN' })
    assert.equal(builtin.status, 200)
    assert.equal(JSON.parse(builtin.body).id, 'deepseek')
    assert.equal(credentialCalls.at(-1).ref, 'DEEPSEEK_API_KEY')
  })
  await t.test('unsafe model IDs and provider names are rejected without prototype mutation', async () => {
    const api = '/dsh-whale/api-models.json'
    for (const id of ['__proto__', 'constructor', 'prototype', 'unknown-model']) {
      const response = await invoke(api, 'POST', { action: 'model-settings', id, alert: { injectedProbe: true } })
      assert.equal(response.status, 400)
      assert.equal(({}).alert, undefined)
    }
    for (const provider of ['__proto__', 'constructor']) assert.equal((await invoke(api, 'POST', { model: { provider, keyRef: 'DSHW_TEST' } })).status, 400)
    assert.equal((await invoke(api, 'POST', { model: { id: '__proto__', provider: 'custom', keyRef: 'DSHW_TEST' } })).status, 400)
    const response = await invoke(api, 'POST', { model: { id: 'api_test', provider: 'custom', keyRef: 'DSHW_TEST', balance: { url: 'http://127.0.0.1:11434/balance', json: { remaining: 'balance' } }, allowCustomHost: true } })
    assert.equal(response.status, 200)
    assert.equal((await invoke(api, 'POST', { action: 'model-settings', id: 'api_test', alert: { on: false } })).status, 200)
    const ledger = JSON.parse(fs.readFileSync(path.join(tempRoot, '.dshw-usage.json'), 'utf8'))
    assert.equal(ledger.settings.models.api_test.alert.on, false)
    assert.equal(fs.existsSync(path.join(testRoot, '..', 'undefined.dshw-usage.json')), false)
  })
})
