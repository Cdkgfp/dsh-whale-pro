import { isIP } from 'node:net'

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
export const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key)
export const isSafeKey = (key) => !UNSAFE_KEYS.has(key)
export const isSafeModelId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id) && isSafeKey(id)

// Config objects are merged in several places. Strip prototype setters at every depth,
// including legacy files, before they can reach Object.assign or indexed writes.
export function cleanConfig(value, depth = 0) {
  if (depth > 32) throw new Error('配置嵌套层级过深')
  if (Array.isArray(value)) return value.map((item) => cleanConfig(item, depth + 1))
  if (!value || typeof value !== 'object') return value
  const out = Object.create(null)
  for (const key of Object.keys(value)) {
    if (isSafeKey(key)) out[key] = cleanConfig(value[key], depth + 1)
  }
  return out
}
export const parseConfigJson = (text) => cleanConfig(JSON.parse(text))

export function managedCredentialRef(ref, templates) {
  if (typeof ref !== 'string' || !/^[A-Za-z0-9_]{1,64}$/.test(ref) || !isSafeKey(ref)) return false
  return /^DSHW_[A-Za-z0-9_]+$/.test(ref) || Object.values(templates).some((tpl) => tpl.keyRef && tpl.keyRef === ref)
}

function ipv6Groups(address) {
  let text = address.toLowerCase().split('%')[0]
  if (isIP(text) !== 6) return null
  text = text.replace(/(\d+\.\d+\.\d+\.\d+)$/, (ipv4) => {
    const p = ipv4.split('.').map(Number)
    return ((p[0] << 8) | p[1]).toString(16) + ':' + ((p[2] << 8) | p[3]).toString(16)
  })
  const halves = text.split('::')
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  const parts = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left
  return parts.map((part) => parseInt(part, 16))
}
function mappedIpv4(groups) {
  if (!groups || !groups.slice(0, 5).every((n) => n === 0) || groups[5] !== 0xffff) return null
  return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255]
}
export function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false
  if (isIP(address) === 4) return Number(address.split('.')[0]) === 127
  const groups = ipv6Groups(address)
  const mapped = mappedIpv4(groups)
  return mapped ? mapped[0] === 127 : !!groups && groups.slice(0, 7).every((n) => n === 0) && groups[7] === 1
}
function isLoopbackHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host.endsWith('.localhost') || isLoopbackAddress(host)
}

export function assertSafeApiAddress(address) {
  const host = String(address).toLowerCase().replace(/^\[|\]$/g, '')
  let ipv4 = isIP(host) === 4 ? host.split('.').map(Number) : null
  const groups = ipv6Groups(host)
  if (groups) {
    ipv4 = mappedIpv4(groups)
    // Also inspect the well-known NAT64 IPv4 translation prefix.
    if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((n) => n === 0)) {
      ipv4 = [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255]
    }
    if (groups.every((n) => n === 0) || (groups[0] & 0xffc0) === 0xfe80 || (groups[0] & 0xff00) === 0xff00) {
      throw new Error('禁止访问 unspecified、link-local 或 multicast 地址')
    }
  }
  if (ipv4 && (ipv4[0] === 0 || ipv4[0] >= 224 || (ipv4[0] === 169 && ipv4[1] === 254)
    || ipv4.join('.') === '100.100.100.200')) throw new Error('禁止访问云元数据或保留地址')
}
export function assertSafeApiUrl(input) {
  let url
  try { url = new URL(input) } catch { throw new Error('无效的接口地址') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('接口仅支持 HTTP/HTTPS')
  if (url.username || url.password) throw new Error('接口地址不允许携带用户名/密码')
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'metadata.google.internal' || host === 'metadata.goog') throw new Error('禁止访问云元数据地址')
  assertSafeApiAddress(host)
  return url
}

const MUTABLE_ROUTES = new Map([
  ['size.json', ['GET', 'HEAD', 'POST', 'PUT']],
  ['usage-settings.json', ['GET', 'HEAD', 'POST', 'PUT']],
  ['api-models.json', ['GET', 'HEAD', 'POST', 'PUT']],
  ['balance-adjustments.json', ['GET', 'PUT']],
  ['roles.json', ['GET', 'HEAD', 'POST', 'PUT']],
  ['audio.json', ['GET', 'HEAD', 'POST', 'PUT']],
  ['bubble.json', ['GET', 'HEAD', 'POST', 'PUT']],
  ['role-pin.json', ['POST', 'PUT']],
  ['role-delete.json', ['POST', 'PUT']],
  ['bubble-img-upload.json', ['POST', 'PUT']],
])
function authorityUrl(host, protocol = 'http:') {
  if (typeof host !== 'string' || !host || /[\s/@\\?#,]/.test(host)) throw new Error('Invalid Host')
  return new URL(protocol + '//' + host)
}
export function createRequestGuard(ctx, { adminHosts = process.env.DSHW_ADMIN_HOSTS || '', warn = console.warn } = {}) {
  const admins = String(adminHosts).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  let warned = false
  function fence() {
    try {
      const conn = typeof ctx.get === 'function' ? ctx.get('connection') : ctx.connection
      return conn && typeof conn.requestRejection === 'function' ? conn : null
    } catch { return null }
  }
  function unavailable() {
    if (!warned) {
      warned = true
      warn('[dsh-whale] 宿主认证不可用：所有 /dsh-whale/* 路由已拒绝访问，请使用提供 connection.requestRejection() 的 DSH。')
    }
  }
  if (!fence()) unavailable()
  return function rejected(req, res, route) {
    function deny(status, error, extra = {}) {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra })
      res.end(JSON.stringify({ ok: false, error }))
      return true
    }
    const conn = fence()
    if (!conn) { unavailable(); return deny(503, '宿主认证不可用，请升级或恢复 DSH 后重试') }
    let code
    try { code = conn.requestRejection(req) } catch { unavailable(); return deny(503, '宿主认证暂不可用') }
    // The host contract admits a request only by returning undefined.
    if (code !== undefined) return deny(code === 401 || code === 403 ? code : 503, '请求未通过宿主认证')
    let host
    try {
      host = authorityUrl(req.headers?.host)
      if (String(req.headers?.['sec-fetch-site'] || '').toLowerCase() === 'cross-site') throw new Error('Cross-site')
      if (req.headers?.origin !== undefined) {
        const origin = new URL(req.headers.origin)
        if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== authorityUrl(req.headers.host, origin.protocol).host) throw new Error('Origin')
      }
    } catch { return deny(403, '请求来源未获准') }
    const method = req.method
    const methods = MUTABLE_ROUTES.get(route.path.replace('/dsh-whale/', '')) || ['GET', 'HEAD']
    if (!methods.includes(method)) return deny(405, '不支持的请求方法', { Allow: methods.join(', ') })
    if (method !== 'GET' && method !== 'HEAD') {
      const local = isLoopbackHostname(host.hostname) && isLoopbackAddress(req.socket?.remoteAddress)
      const admin = admins.some((entry) => entry.includes(':') ? entry === host.host : entry === host.hostname)
      if (!local && !admin) return deny(403, '写操作需要本机连接，或显式配置 DSHW_ADMIN_HOSTS')
    }
    return false
  }
}
