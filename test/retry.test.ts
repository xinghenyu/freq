import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient, HttpError, TimeoutError, AbortError } from '../src/index'

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
type Client = ReturnType<typeof createClient>

const okJson = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })

const status = (code: number): Response => new Response('boom', { status: code })

/** 替换 fetch，按调用序号返回响应；返回本次调用次数 */
async function runWith<T>(
  fetchImpl: (call: number) => Response | Promise<Response>,
  action: (client: Client) => Promise<T>,
  config: { retryDelay?: number; retry?: number; retryCodes?: number[] } = {}
): Promise<{ result: T | undefined; calls: number }> {
  const original = globalThis.fetch
  let calls = 0

  globalThis.fetch = (async () => {
    calls++
    return fetchImpl(calls)
  }) as unknown as typeof fetch

  try {
    const client = createClient({ baseUrl: 'https://base.test', retryDelay: 1, ...config })
    let result: T | undefined
    try {
      result = await action(client)
    } catch {
      result = undefined
    }
    return { result, calls }
  } finally {
    globalThis.fetch = original
  }
}

/** 挂起不返回，仅响应 abort */
const hangingFetch = (onCall: () => void): FetchLike => (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    onCall()
    const signal = init?.signal
    if (!signal) {
      reject(new Error('expected AbortSignal'))
      return
    }
    const keepAlive = setTimeout(() => {}, 5000)
    signal.addEventListener('abort', () => {
      clearTimeout(keepAlive)
      reject(signal.reason)
    })
  })

test('500 两次后成功，retry: 2 → fetch 调用 3 次', async () => {
  const { result, calls } = await runWith(
    (n) => (n < 3 ? status(500) : okJson({ ok: true })),
    (client) => client.get<{ ok: boolean }>('/x', { retry: 2 })
  )

  assert.equal(calls, 3)
  assert.deepEqual(result?.data, { ok: true })
})

test('一直 500，retry: 2 → 3 次后抛 HttpError(500)', async () => {
  let calls = 0
  const original = globalThis.fetch
  globalThis.fetch = (async () => {
    calls++
    return status(500)
  }) as unknown as typeof fetch

  try {
    const client = createClient({ baseUrl: 'https://base.test', retryDelay: 1 })
    await assert.rejects(
      () => client.get('/x', { retry: 2 }),
      (err: unknown) => {
        if (!(err instanceof HttpError)) throw new Error('expected HttpError')
        assert.equal(err.status, 500)
        return true
      }
    )
  } finally {
    globalThis.fetch = original
  }
  assert.equal(calls, 3)
})

test('404 不在白名单，retry: 3 → 只调用 1 次', async () => {
  const { calls } = await runWith(
    () => status(404),
    (client) => client.get('/x', { retry: 3 }).catch(() => null)
  )

  assert.equal(calls, 1)
})

test('config.retryCodes 可自定义白名单', async () => {
  const { result, calls } = await runWith(
    (n) => (n < 3 ? status(503) : okJson({ done: true })),
    (client) => client.get<{ done: boolean }>('/x'),
    { retry: 2, retryCodes: [503] }
  )

  assert.equal(calls, 3)
  assert.deepEqual(result?.data, { done: true })
})

test('不传 retry 时不重试', async () => {
  const { calls } = await runWith(
    () => status(500),
    (client) => client.get('/x').catch(() => null)
  )

  assert.equal(calls, 1)
})

test('超时可重试，retry: 1 → 2 次后抛 TimeoutError', async () => {
  let calls = 0
  const original = globalThis.fetch
  globalThis.fetch = hangingFetch(() => {
    calls++
  }) as unknown as typeof fetch

  try {
    const client = createClient({ baseUrl: 'https://base.test', retryDelay: 1 })
    await assert.rejects(
      () => client.get('/x', { retry: 1, timeout: 30 }),
      (err: unknown) => {
        if (!(err instanceof TimeoutError)) throw new Error('expected TimeoutError')
        return true
      }
    )
  } finally {
    globalThis.fetch = original
  }
  assert.equal(calls, 2)
})

test('主动 abort 不重试，retry: 3 → 只调用 1 次', async () => {
  let calls = 0
  const original = globalThis.fetch
  globalThis.fetch = hangingFetch(() => {
    calls++
  }) as unknown as typeof fetch

  try {
    const client = createClient({ baseUrl: 'https://base.test', retryDelay: 1 })
    const ctrl = new AbortController()
    const pending = client.get('/x', { retry: 3, signal: ctrl.signal })
    ctrl.abort()

    await assert.rejects(pending, (err: unknown) => {
      if (!(err instanceof AbortError)) throw new Error('expected AbortError')
      return true
    })
  } finally {
    globalThis.fetch = original
  }
  assert.equal(calls, 1)
})
