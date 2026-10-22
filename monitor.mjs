// Vigilancia de disponibilidad de Jade: comprueba cada servicio publico y falla (codigo de salida 1) si alguno no
// responde como se espera, para que GitHub Actions avise por correo. Sin dependencias: solo Node 20+.
//
// Uso:  node monitor.mjs [targets.json]
import { appendFileSync, readFileSync } from 'node:fs'
import tls from 'node:tls'
import { pathToFileURL } from 'node:url'

const DEFAULTS = { expectStatus: 200, maxMs: 8000, tlsDaysMin: 14, timeoutMs: 15000, attempts: 3, retryDelayMs: 10000 }

/** Dias que faltan para `validTo` (fecha del certificado) a partir de `now`. Negativo = ya caduco. */
export function daysUntil(validTo, now = new Date()) {
  const end = new Date(validTo).getTime()
  if (Number.isNaN(end)) return NaN
  return Math.floor((end - now.getTime()) / 86_400_000)
}

/**
 * Decide si una respuesta cumple lo esperado. `result` = { status, body, ms, tlsDays? }.
 * Devuelve { ok, problems[] }: cada problema es una frase corta para el correo.
 */
export function evaluate(target, result) {
  const t = { ...DEFAULTS, ...target }
  const problems = []
  if (result.status !== t.expectStatus) problems.push(`responde ${result.status} y se esperaba ${t.expectStatus}`)
  if (t.expectBody && !String(result.body ?? '').includes(t.expectBody)) {
    problems.push(`la respuesta no contiene ${JSON.stringify(t.expectBody)}`)
  }
  if (result.ms > t.maxMs) problems.push(`tarda ${result.ms} ms (maximo ${t.maxMs} ms)`)
  if (typeof result.tlsDays === 'number') {
    if (Number.isNaN(result.tlsDays)) problems.push('no se pudo leer la fecha del certificado')
    else if (result.tlsDays < t.tlsDaysMin) {
      problems.push(`el certificado caduca en ${result.tlsDays} dias (minimo ${t.tlsDaysMin})`)
    }
  }
  return { ok: problems.length === 0, problems }
}

/** Dias de vida del certificado TLS de un host (consulta directa al puerto 443). */
export function certificateDays(host, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port: 443, servername: host, timeout: timeoutMs }, () => {
      const cert = socket.getPeerCertificate()
      socket.end()
      resolve(cert && cert.valid_to ? daysUntil(cert.valid_to) : NaN)
    })
    socket.on('error', () => resolve(NaN))
    socket.on('timeout', () => {
      socket.destroy()
      resolve(NaN)
    })
  })
}

/** Una peticion: estado, cuerpo (maximo 200 KB), milisegundos y, si es https, dias del certificado. */
async function probe(target) {
  const t = { ...DEFAULTS, ...target }
  const started = Date.now()
  try {
    const res = await fetch(t.url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(t.timeoutMs),
      headers: { 'user-agent': 'jade-monitor/1.0 (+https://github.com/Jade-Web-Empresarial/jade-monitor)' },
    })
    const body = (await res.text()).slice(0, 200_000)
    const url = new URL(t.url)
    const tlsDays = url.protocol === 'https:' ? await certificateDays(url.hostname) : undefined
    return { status: res.status, body, ms: Date.now() - started, tlsDays }
  } catch (error) {
    return { status: 0, body: '', ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Reintenta (un parpadeo de red no debe despertar a nadie): solo falla si todos los intentos fallan. */
export async function check(target, run = probe, wait = sleep) {
  const t = { ...DEFAULTS, ...target }
  let last
  for (let i = 1; i <= t.attempts; i++) {
    const result = await run(target)
    const verdict = evaluate(target, result)
    last = { target, result, ...verdict, attempts: i }
    if (verdict.ok) return last
    if (result.error) last.problems.unshift(`no responde (${result.error})`)
    if (i < t.attempts) await wait(t.retryDelayMs)
  }
  return last
}

function report(results) {
  const rows = results.map((r) => {
    const detail = r.ok ? `${r.result.ms} ms` + (r.result.tlsDays != null ? `, cert. ${r.result.tlsDays} d` : '') : r.problems.join('; ')
    return `| ${r.ok ? 'OK' : '**FALLA**'} | ${r.target.name} | ${detail} |`
  })
  const table = ['| Estado | Servicio | Detalle |', '|---|---|---|', ...rows].join('\n')
  const failed = results.filter((r) => !r.ok)
  const title = failed.length ? `## ${failed.length} de ${results.length} servicios FALLAN` : `## Todo bien (${results.length} servicios)`
  return `${title}\n\n${table}\n`
}

async function main() {
  const file = process.argv[2] ?? new URL('./targets.json', import.meta.url)
  const targets = JSON.parse(readFileSync(file, 'utf8'))
  const results = await Promise.all(targets.map((t) => check(t)))
  const text = report(results)
  console.log(text)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text)
  if (results.some((r) => !r.ok)) process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 2
  })
}
