import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { check, daysUntil, evaluate } from './monitor.mjs'

const target = { name: 'API', url: 'https://x.example/health', expectBody: '"status":"ok"' }
const good = { status: 200, body: '{"status":"ok"}', ms: 120, tlsDays: 60 }

describe('evaluate', () => {
  it('acepta una respuesta correcta', () => {
    assert.deepEqual(evaluate(target, good), { ok: true, problems: [] })
  })

  it('detecta un estado distinto del esperado', () => {
    const r = evaluate(target, { ...good, status: 503 })
    assert.equal(r.ok, false)
    assert.match(r.problems[0], /503/)
  })

  it('detecta que falta la palabra clave aunque responda 200 (base de datos caida)', () => {
    const r = evaluate(target, { ...good, body: '{"status":"error"}' })
    assert.equal(r.ok, false)
    assert.match(r.problems.join(), /no contiene/)
  })

  it('detecta una respuesta demasiado lenta', () => {
    const r = evaluate(target, { ...good, ms: 9000 })
    assert.equal(r.ok, false)
    assert.match(r.problems[0], /9000 ms/)
  })

  it('detecta un certificado a punto de caducar y uno ilegible', () => {
    assert.equal(evaluate(target, { ...good, tlsDays: 13 }).ok, false)
    assert.equal(evaluate(target, { ...good, tlsDays: 14 }).ok, true)
    assert.match(evaluate(target, { ...good, tlsDays: NaN }).problems[0], /certificado/)
  })

  it('respeta los umbrales propios de cada servicio', () => {
    const lento = { ...target, maxMs: 20000, tlsDaysMin: 3 }
    assert.equal(evaluate(lento, { ...good, ms: 15000, tlsDays: 5 }).ok, true)
  })

  it('sin tlsDays (http) no exige certificado', () => {
    assert.equal(evaluate(target, { status: 200, body: '{"status":"ok"}', ms: 10 }).ok, true)
  })

  it('acumula todos los problemas a la vez', () => {
    const r = evaluate(target, { status: 500, body: '', ms: 9999, tlsDays: 1 })
    assert.equal(r.problems.length, 4)
  })
})

describe('daysUntil', () => {
  const now = new Date('2026-10-22T12:00:00Z')
  it('cuenta dias completos', () => {
    assert.equal(daysUntil('2026-11-21T12:00:00Z', now), 30)
    assert.equal(daysUntil('2026-10-23T11:00:00Z', now), 0)
  })
  it('es negativo si ya caduco y NaN si la fecha no vale', () => {
    assert.ok(daysUntil('2026-10-01T00:00:00Z', now) < 0)
    assert.ok(Number.isNaN(daysUntil('no es una fecha', now)))
  })
})

describe('check (reintentos)', () => {
  const sinEspera = async () => {}

  it('un fallo puntual seguido de exito NO es una alerta', async () => {
    const respuestas = [{ status: 0, body: '', ms: 5, error: 'ECONNRESET' }, good]
    let llamadas = 0
    const r = await check(target, async () => respuestas[llamadas++], sinEspera)
    assert.equal(r.ok, true)
    assert.equal(r.attempts, 2)
  })

  it('si fallan todos los intentos, falla e incluye el motivo de red', async () => {
    let llamadas = 0
    const r = await check(target, async () => (llamadas++, { status: 0, body: '', ms: 5, error: 'ETIMEDOUT' }), sinEspera)
    assert.equal(r.ok, false)
    assert.equal(llamadas, 3)
    assert.match(r.problems[0], /ETIMEDOUT/)
  })

  it('espera entre intentos pero no tras el ultimo', async () => {
    const esperas = []
    await check({ ...target, retryDelayMs: 7 }, async () => ({ status: 500, body: '', ms: 1 }), async (ms) => esperas.push(ms))
    assert.deepEqual(esperas, [7, 7])
  })
})
