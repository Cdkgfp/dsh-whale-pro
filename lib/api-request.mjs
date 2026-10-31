import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'
import { assertSafeApiAddress, assertSafeApiUrl } from './security.mjs'

// Resolve once, validate every answer, then give those exact addresses to Node's
// socket lookup. A second DNS resolution must not change the validated destination.
export function createSafeLookup(resolve = dns.promises.lookup) {
  return (hostname, options, callback) => {
    Promise.resolve().then(() => resolve(hostname, { all: true, verbatim: true })).then((records) => {
      if (!records.length) throw new Error('接口域名没有可用地址')
      for (const record of records) {
        if (!isIP(record.address)) throw new Error('接口域名返回了无效地址')
        assertSafeApiAddress(record.address)
      }
      const family = typeof options === 'number' ? options : options?.family
      const selected = records.filter((record) => !family || record.family === family).sort((a, b) => a.family - b.family)
      if (!selected.length) throw new Error('接口域名没有可用地址')
      if (options?.all) callback(null, selected)
      else callback(null, selected[0].address, selected[0].family)
    }).catch((error) => callback(error))
  }
}

export function createApiFetcher({ resolve, httpRequest = http.request, httpsRequest = https.request } = {}) {
  const lookup = createSafeLookup(resolve)
  return async function apiFetch(input, init = {}) {
    const url = assertSafeApiUrl(input)
    return new Promise((resolveResponse, reject) => {
      let settled = false
      let timer
      const finish = (error, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(error)
        else resolveResponse(value)
      }
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
        method: init.method || 'GET',
        headers: { Accept: 'application/json', 'User-Agent': 'dsh-whale-pro', ...init.headers },
        signal: init.signal,
        lookup, agent: false,
      }, (response) => {
        const status = response.statusCode || 0
        if (status >= 300 && status < 400) {
          finish(new Error('接口不允许重定向，请填写最终接口地址'))
          response.destroy()
          request.destroy()
          return
        }
        const chunks = []
        let bytes = 0
        response.on('data', (chunk) => {
          bytes += chunk.length
          if (bytes > 2 * 1024 * 1024) {
            finish(new Error('接口响应过大'))
            response.destroy()
            request.destroy()
          } else chunks.push(chunk)
        })
        response.on('error', () => finish(new Error('接口响应中断')))
        response.on('aborted', () => finish(new Error('接口响应中断')))
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          finish(null, { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(text) })
        })
      })
      // Do not echo transport errors: request URLs may contain a {key} expansion.
      request.on('error', () => finish(new Error('接口连接失败或目标地址被安全策略拒绝')))
      timer = setTimeout(() => { finish(new Error('接口请求超时')); request.destroy() }, 15000)
      if (init.body !== undefined) request.end(init.body)
      else request.end()
    })
  }
}
export const safeApiFetch = createApiFetcher()
