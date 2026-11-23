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
  const listeners = new Map()
  const cleanups = []
  const credentialCalls = []
  let structuredDeletionCalls = 0
  let credentialReads = 0
  let conn = { requestRejection: () => undefined }
  let account
  const ctx = {
    get(name) {
      if (name === 'connection') return conn
      if (name === 'deepseekAccount') return account
    },
    on(name, fn) { listeners.set(name, fn); return () => listeners.delete(name) },
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
    const manifest = JSON.parse(fs.readFileSync(path.join(testRoot, '..', 'package.json'), 'utf8'))
    assert.equal(config.version, manifest.version)
    assert.equal((await invoke('/dsh-whale/size.json', 'PUT', { scale: 2 }, { remoteAddress: '192.0.2.8' })).status, 403)
  })
  await t.test('account login reads bonus-only wallets even if the optional account state rejects', async () => {
    const wallet = { status: 'ready', value: [], bonusWallets: [{ currency: 'CNY', balance: '1.25' }] }
    account = {
      async getState() { throw new Error('unavailable') },
      async getBalance() { return wallet },
    }
    const readBalance = async () => JSON.parse((await invoke('/dsh-whale/balance.json?refresh=1', 'GET')).body)
    const ready = await readBalance()
    assert.equal(ready.ok, true)
    assert.equal(ready.balanceSource, 'account')
    assert.equal(ready.totalBalance, 1.25)
    assert.equal(ready.rechargeBalance, 0)
    assert.equal(ready.bonusBalance, 1.25)
    account.getState = async () => ({ status: 'signed-out' })
    account.getBalance = async () => null
    const signedOut = await readBalance()
    assert.equal(signedOut.ok, false)
    assert.match(signedOut.error, /未登录 DeepSeek 账号/)
    account = undefined
  })
  await t.test('tracks native and programmatic questions by session and call ID', async () => {
    const emit = (session, type, data) => listeners.get('session/event')({ id: session }, { type, data })
    const pending = async () => JSON.parse((await invoke('/dsh-whale/wait.json', 'GET')).body).pending
    emit('chat', 'tool/call', { name: 'ask_user_question', callId: 'ask' })
    emit('chat', 'tool/result', { message: { source: { callId: 'another' } } })
    assert.equal((await pending()).id, 'ask')
    emit('chat', 'tool/result', { message: { source: { callId: 'ask' } } })
    assert.equal(await pending(), null)
    emit('chat', 'tool/ptc-dispatch-start', { name: 'ask_user_question', callId: 'outer', subCallId: 'inner' })
    emit('other', 'turn/end', { turn: 1 })
    assert.equal((await pending()).id, 'inner')
    emit('chat', 'tool/ptc-dispatch', { name: 'ask_user_question', callId: 'outer', subCallId: 'inner' })
    assert.equal(await pending(), null)
  })
  await t.test('clears approval bubbles on a matching decision or session disposal', async () => {
    const emit = (id, type, data) => listeners.get('session/event')({ id }, { type, data })
    const dispose = id => listeners.get('session/disposed')({ id })
    const pending = async () => JSON.parse((await invoke('/dsh-whale/wait.json', 'GET')).body).pending
    emit('chat', 'approval/asked', { id: 'approval' })
    emit('chat', 'approval/policy', {})
    emit('other', 'approval/decided', { id: 'approval' })
    dispose('other')
    assert.equal((await pending()).id, 'approval')
    emit('chat', 'approval/decided', { id: 'approval' })
    assert.equal(await pending(), null)
    emit('chat', 'tool/call', { name: 'ask_user_question', callId: 'question' })
    dispose('chat')
    assert.equal(await pending(), null)
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
