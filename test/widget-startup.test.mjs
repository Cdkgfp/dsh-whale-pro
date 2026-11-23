import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const widget = readFileSync(new URL('../assets/whale-widget.js', import.meta.url), 'utf8')
const noop = () => {}

class Element {
  children = []
  style = { setProperty: noop }
  classList = { add: noop, remove: noop, toggle: noop, contains: () => false }
  dataset = {}
  value = ''
  addEventListener() {}
  setAttribute() {}
  querySelector() { return null }
  querySelectorAll() { return [] }
  get options() { return this.children }
  get firstChild() { return this.children[0] }
  get isConnected() { return this.parentNode?.isConnected ?? false }
  getBoundingClientRect() { return { width: 150, height: 150, left: 600, right: 750, top: 400 } }
  appendChild(node) { return this.insertBefore(node, null) }
  insertBefore(node, before) {
    node.parentNode?.removeChild(node)
    this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, node)
    node.parentNode = this
    return node
  }
  removeChild(node) {
    this.children.splice(this.children.indexOf(node), 1)
    node.parentNode = null
    return node
  }
}

for (const delay of [0, 180000]) {
  test(`mounts one balance panel when the composer appears after ${delay} ms`, async () => {
    const body = new Element()
    Object.defineProperty(body, 'isConnected', { value: true })
    const chatRoot = new Element()
    let composerReady = delay === 0
    chatRoot.querySelector = selector => composerReady && selector === '[data-composer-input]' ? {} : null
    const document = {
      body,
      head: new Element(),
      documentElement: new Element(),
      addEventListener: noop,
      createElement: () => new Element(),
      getElementById: id => id === 'root' ? chatRoot : null,
      querySelector: selector => body.children.find(el => '.' + el.className === selector) ?? null,
      querySelectorAll: () => [],
    }
    const intervals = new Map()
    const observers = new Set()
    let now = 0
    const sandbox = {
      document, console,
      innerWidth: 1024, innerHeight: 768,
      navigator: {}, localStorage: { getItem: () => null, setItem: noop },
      addEventListener: noop, setTimeout: noop, clearTimeout: noop,
      Date: class extends Date { static now() { return now } },
      MutationObserver: class {
        constructor(callback) { this.callback = callback }
        observe() { observers.add(this) }
        disconnect() { observers.delete(this) }
      },
      setInterval(fn, ms) { intervals.set(fn, ms); return fn },
      clearInterval: fn => intervals.delete(fn),
      fetch: async url => url === '/dsh-whale/balance.json'
        ? { ok: true, json: async () => ({ ok: true, totalBalance: 42.5, currency: 'CNY' }) }
        : new Promise(noop),
    }
    sandbox.window = sandbox
    runInNewContext(widget, sandbox)
    if (!composerReady) {
      for (now = 250; now <= delay; now += 250) {
        for (const [fn, ms] of intervals) if (now % ms === 0) fn()
      }
      assert.equal(body.children.length, 0)
      composerReady = true
      now = delay + 500
      for (const observer of [...observers]) observer.callback()
    }
    await new Promise(resolve => setImmediate(resolve))
    runInNewContext(widget, sandbox)
    const panels = body.children.filter(el => el.id === 'dshwv-compact-panel')
    assert.equal(panels.length, 1)
    assert.equal(panels[0].style.display, 'block')
    const footer = panels[0].children.find(el => el.className === 'dshwv-compact-foot')
    assert.equal(footer.firstChild.children[1].textContent, '¥42.50')
    sandbox.__dshwCompactPanelSetVisible(false)
    assert.equal(panels[0].style.display, 'none')
    assert.equal(sandbox.__dshwCompactPanelToggle(), true)
    assert.equal(panels[0].style.display, 'block')
  })
}
