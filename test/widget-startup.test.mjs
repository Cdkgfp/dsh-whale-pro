import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const widget = readFileSync(new URL('../assets/whale-widget.js', import.meta.url), 'utf8')
const noop = () => {}

class Element extends EventTarget {
  children = []
  style = { setProperty: noop }
  classes = new Set()
  classList = {
    add: name => this.classes.add(name),
    remove: name => this.classes.delete(name),
    toggle: (name, on = !this.classes.has(name)) => {
      if (on) this.classes.add(name)
      else this.classes.delete(name)
      return on
    },
    contains: name => this.classes.has(name) || (this.className || '').split(' ').includes(name),
  }
  dataset = {}
  value = ''
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

function mountWidget({ delay = 0, storage = new Map(), responses = {} } = {}) {
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
  const timeouts = new Map()
  const intervals = new Map()
  const observers = new Set()
  const windowEvents = new EventTarget()
  let now = 0
  const sandbox = {
    document, console,
    innerWidth: 1024, innerHeight: 768,
    navigator: {}, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    setTimeout(fn, ms) { const id = Symbol(); timeouts.set(id, { fn, ms }); return id },
    clearTimeout: id => timeouts.delete(id),
    Date: class extends Date { static now() { return now } },
    MutationObserver: class {
      constructor(callback) { this.callback = callback }
      observe() { observers.add(this) }
      disconnect() { observers.delete(this) }
    },
    setInterval(fn, ms) { intervals.set(fn, ms); return fn },
    clearInterval: fn => intervals.delete(fn),
    fetch: async url => {
      const payload = responses[url]?.() ?? (url === '/dsh-whale/balance.json' ? { ok: true, totalBalance: 42.5, currency: 'CNY' } : undefined)
      return payload ? { ok: true, json: async () => payload } : new Promise(noop)
    },
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
  return {
    body, sandbox, windowEvents, timeouts,
    advance(ms) { now += ms },
    runIntervals(period) { for (const [fn, ms] of intervals) if (ms === period) fn() },
    fireTimeout(delay) {
      const timer = [...timeouts].find(([, timeout]) => timeout.ms === delay)
      assert.ok(timer, `expected a ${delay} ms timeout`)
      timeouts.delete(timer[0])
      timer[1].fn()
    },
  }
}

const settle = () => new Promise(resolve => setImmediate(resolve))

function findElement(root, predicate) {
  if (predicate(root)) return root
  for (const child of root.children) {
    const result = findElement(child, predicate)
    if (result) return result
  }
}

for (const delay of [0, 180000]) {
  test(`mounts one balance panel when the composer appears after ${delay} ms`, async () => {
    const { body, sandbox } = mountWidget({ delay })
    await settle()
    runInNewContext(widget, sandbox)
    const panels = body.children.filter(el => el.id === 'dshwv-compact-panel')
    assert.equal(panels.length, 1)
    assert.equal(panels[0].style.display, 'block')
    const footer = panels[0].children.find(el => el.className === 'dshwv-compact-foot')
    assert.equal(footer.firstChild.children[1].textContent, '¥42.50')
  })
}

test('the three radios control the panel and persist the selected mode', () => {
  const storage = new Map()
  const { body, windowEvents } = mountWidget({ storage })
  const panel = findElement(body, el => el.id === 'dshwv-compact-panel')
  const whale = findElement(body, el => el.className === 'dshwv-img')
  const modes = findElement(body, el => el.className === 'dshwv-compact-modes')
  const select = value => {
    const radio = findElement(modes, el => el.type === 'radio' && el.value === value)
    radio.checked = true
    radio.dispatchEvent(new Event('change'))
  }
  const pointer = (type, pointerType) => whale.dispatchEvent(Object.assign(new Event(type), { pointerType }))

  select('off')
  pointer('pointerenter', 'mouse')
  assert.equal(panel.style.display, 'none')
  pointer('pointerleave', 'mouse')
  select('hover')
  pointer('pointerenter', 'touch')
  assert.equal(panel.style.display, 'none')
  pointer('pointerenter', 'mouse')
  assert.equal(panel.style.display, 'block')
  pointer('pointerleave', 'mouse')
  assert.equal(panel.style.display, 'none')
  pointer('pointerenter', 'mouse')
  windowEvents.dispatchEvent(new Event('blur'))
  assert.equal(panel.style.display, 'none')

  const reopened = mountWidget({ storage })
  const reopenedPanel = findElement(reopened.body, el => el.id === 'dshwv-compact-panel')
  const reopenedHover = findElement(reopened.body, el => el.type === 'radio' && el.value === 'hover')
  assert.equal(reopenedPanel.style.display, 'none')
  assert.equal(reopenedHover.checked, true)
  select('always')
  pointer('pointerleave', 'mouse')
  assert.equal(panel.style.display, 'block')
})

test('an overdue cost bubble closes on focus while its timeout is still pending', async () => {
  const widget = mountWidget({
    responses: { '/dsh-whale/last-turn.json': () => ({ ok: true, seq: 1, turn: 1, amount: 0.12 }) },
  })
  const bubble = findElement(widget.body, el => el.className === 'dshwv-pop')
  widget.runIntervals(1000)
  await settle()
  widget.fireTimeout(30)
  assert.equal(bubble.classList.contains('dshwv-pop-open'), true)
  assert.ok([...widget.timeouts.values()].some(timer => timer.ms === 5000))
  widget.advance(4999)
  widget.windowEvents.dispatchEvent(new Event('focus'))
  assert.equal(bubble.classList.contains('dshwv-pop-open'), true)
  widget.advance(2)
  widget.windowEvents.dispatchEvent(new Event('focus'))
  assert.equal(bubble.classList.contains('dshwv-pop-open'), false)
  assert.ok(![...widget.timeouts.values()].some(timer => timer.ms === 5000))
})

test('wait bubbles follow the host state and clear after the host stops responding', async () => {
  let pending = { kind: 'question', id: 'turn-question' }
  let offline = false
  const widget = mountWidget({
    responses: { '/dsh-whale/wait.json': () => {
      if (offline) throw new Error('host unavailable')
      return { ok: true, pending }
    } },
  })
  const bubble = findElement(widget.body, el => el.className === 'dshwv-pop')
  async function pollAfter(ms) {
    widget.advance(ms)
    widget.runIntervals(1000)
    await settle()
  }
  await pollAfter(1000)
  assert.equal(bubble.classList.contains('dshwv-pop-open'), true)
  await pollAfter(8000)
  await pollAfter(8000)
  assert.equal(bubble.classList.contains('dshwv-pop-open'), true)
  offline = true
  await pollAfter(15000)
  assert.equal(bubble.classList.contains('dshwv-pop-open'), false)
  offline = false
  await pollAfter(1000)
  assert.equal(bubble.classList.contains('dshwv-pop-open'), true)
  pending = null
  await pollAfter(1000)
  assert.equal(bubble.classList.contains('dshwv-pop-open'), false)
})
