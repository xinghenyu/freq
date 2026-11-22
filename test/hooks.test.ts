import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient, HttpError, ParseError, TimeoutError, AbortError, type HttpConfig } from '../src/index'

type Call = { url: string; init: RequestInit | undefined }
type Client = ReturnType<typeof createClient>

const okJson = (): Response =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })

/** 装上假的 fetch，记录被调用的 url 和 init */
async function capture(
  run: (client: Client) => Promise<unknown>,
  config: HttpConfig = {}
): Promise<Call> {
  const original = globalThis.fetch
  let call: Call = { url: '', init: undefined }

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    call = { url: String(input), init }
    return okJson()
  }) as unknown as typeof fetch

  try {
    await run(createClient({ baseUrl: 'https://base.test', ...config }))
    return call
  } finally {
    globalThis.fetch = original
  }
}

test('hook 拿得到拼好的 url、序列化后的 body 和方法', async () => {
  let seen: { url: string; method: string; body: string | undefined } | undefined

  await capture(
    (client) => client.post('/orders', { body: { id: 1 }, query: { t: '2' } }),
    {
      Hooks: {
        Request: (ctx) => {
          seen = { url: ctx.url, method: ctx.method, body: ctx.body }
        }
      }
    }
  )

  assert.equal(seen?.url, 'https://base.test/orders?t=2')
  assert.equal(seen?.method, 'POST')
  assert.equal(seen?.body, '{"id":1}')
})

test('hook 写 header 会进到实际请求', async () => {
  const { init } = await capture(
    (client) => client.get('/x'),
    { Hooks: { Request: (ctx) => { ctx.headers.set('x-sign', 'abc') } } }
  )

  const headers = new Headers(init?.headers)
  assert.equal(headers.get('x-sign'), 'abc')
})

test('hook 改 url 会换掉实际请求地址', async () => {
  const { url } = await capture(
    (client) => client.get('/x'),
    { Hooks: { Request: (ctx) => { ctx.url = 'https://other.test/y' } } }
  )

  assert.equal(url, 'https://other.test/y')
})

test('hook 改 method 会换掉实际请求方法', async () => {
  const { init } = await capture(
    (client) => client.get('/x'),
    { Hooks: { Request: (ctx) => { ctx.method = 'POST' } } }
  )

  assert.equal(init?.method, 'POST')
})

test('hook 改 method 后 HttpError 记录的是实际方法', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async () => new Response('boom', { status: 404 })) as unknown as typeof fetch

  try {
    const client = createClient({
      baseUrl: 'https://base.test',
      Hooks: { Request: (ctx) => { ctx.method = 'POST' } }
    })

    await assert.rejects(
      () => client.get('/x'),
      (err: unknown) => {
        if (!(err instanceof HttpError)) throw new Error('expected HttpError')
        assert.equal(err.method, 'POST')
        return true
      }
    )
  } finally {
    globalThis.fetch = original
  }
})

test('FormData 请求时 hook 拿到 undefined，且原始 body 不被冲掉', async () => {
  const fd = new FormData()
  fd.set('a', '1')

  let seenBody: string | undefined = 'not-called'
  const { init } = await capture(
    (client) => client.post('/upload', { body: fd }),
    { Hooks: { Request: (ctx) => { seenBody = ctx.body } } }
  )

  assert.equal(seenBody, undefined)
  assert.equal(init?.body, fd)
})

test('不传 hook 时请求行为不变', async () => {
  const { url, init } = await capture((client) => client.get('/x'))

  assert.equal(url, 'https://base.test/x')
  assert.equal(init?.method, 'GET')
})

/** 永不返回、只响应 abort 的 fetch */
const hanging = (_input: unknown, init?: RequestInit): Promise<Response> =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal
    if (!signal) {
      reject(new Error('expected AbortSignal'))
      return
    }
    const keepAlive = setTimeout(() => {}, 5000)
    if (signal.aborted) {
      clearTimeout(keepAlive)
      reject(signal.reason)
      return
    }
    signal.addEventListener('abort', () => {
      clearTimeout(keepAlive)
      reject(signal.reason)
    })
  })

/** 断言 hook 改了 method 之后，各类错误里记录的方法也是新值 */
function expectMethod(err: unknown, expected: string): true {
  if (
    !(err instanceof HttpError) &&
    !(err instanceof ParseError) &&
    !(err instanceof TimeoutError) &&
    !(err instanceof AbortError)
  ) {
    throw new Error(`expected a http error, got ${String(err)}`)
  }
  assert.equal(err.method, expected)
  return true
}

test('hook 改 method 后 ParseError 记录的也是实际方法', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response('not json', {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })) as unknown as typeof fetch

  try {
    const client = createClient({
      baseUrl: 'https://base.test',
      Hooks: { Request: (ctx) => { ctx.method = 'POST' } }
    })

    await assert.rejects(() => client.get('/x'), (err) => expectMethod(err, 'POST'))
  } finally {
    globalThis.fetch = original
  }
})

test('hook 改 method 后 TimeoutError 记录的也是实际方法', async () => {
  const original = globalThis.fetch
  globalThis.fetch = hanging as unknown as typeof fetch

  try {
    const client = createClient({
      baseUrl: 'https://base.test',
      Hooks: { Request: (ctx) => { ctx.method = 'POST' } }
    })

    await assert.rejects(
      () => client.get('/x', { timeout: 30 }),
      (err) => expectMethod(err, 'POST')
    )
  } finally {
    globalThis.fetch = original
  }
})

test('hook 改 method 后 AbortError 记录的也是实际方法', async () => {
  const original = globalThis.fetch
  globalThis.fetch = hanging as unknown as typeof fetch

  try {
    const client = createClient({
      baseUrl: 'https://base.test',
      Hooks: { Request: (ctx) => { ctx.method = 'POST' } }
    })

    const ctrl = new AbortController()
    const pending = client.get('/x', { signal: ctrl.signal })
    ctrl.abort()

    await assert.rejects(pending, (err) => expectMethod(err, 'POST'))
  } finally {
    globalThis.fetch = original
  }
})

test('Response hook 拿得到解析后的 data、code 和响应头', async () => {
  let seen: { data: unknown; code: number; isJson: boolean } | undefined

  await capture(
    async (client) => {
      const res = await client.get<{ ok: boolean }>('/x')
      assert.deepEqual(res.data, { ok: true })
    },
    {
      Hooks: {
        Response: (ctx) => {
          seen = {
            data: ctx.result.data,
            code: ctx.result.code,
            isJson: ctx.result.headers.get('content-type') === 'application/json'
          }
        }
      }
    }
  )

  assert.deepEqual(seen?.data, { ok: true })
  assert.equal(seen?.code, 200)
  assert.equal(seen?.isJson, true)
})

test('Response hook 改 data 会变成最终返回值', async () => {
  let observed: unknown

  await capture(
    async (client) => {
      const res = await client.get('/x')
      observed = res.data
    },
    {
      Hooks: {
        Response: (ctx) => {
          ctx.result.data = { wrapped: ctx.result.data }
        }
      }
    }
  )

  assert.deepEqual(observed, { wrapped: { ok: true } })
})

test('非 2xx 响应不会触发 Response hook', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch
  let called = false

  try {
    const client = createClient({
      baseUrl: 'https://base.test',
      Hooks: { Response: () => { called = true } }
    })
    await assert.rejects(() => client.get('/x'), HttpError)
  } finally {
    globalThis.fetch = original
  }

  assert.equal(called, false)
})

test('返回值带 code / ok / url，mock 下 url 是空串', async () => {
  await capture(async (client) => {
    const res = await client.get('/x')
    assert.equal(res.code, 200)
    assert.equal(res.ok, true)
    // new Response() 不是由 fetch 产生的，url 恒为空串；
    // 只有真实 fetch 才能拿到最终地址（含重定向后的地址）
    assert.equal(res.url, '')
  })
})

test('单次请求的 Hooks 覆盖 config 的 Hooks', async () => {
  let configRan = 0
  let singleRan = 0

  await capture(
    (client) => client.get('/x', { Hooks: { Request: () => { singleRan++ } } }),
    { Hooks: { Request: () => { configRan++ } } }
  )

  assert.equal(configRan, 0, 'config 的 hook 不应执行')
  assert.equal(singleRan, 1, '单次请求的 hook 应执行')
})

test('单次请求不传 Hooks 时回落到 config', async () => {
  let configRan = 0

  await capture((client) => client.get('/x'), {
    Hooks: { Request: () => { configRan++ } }
  })

  assert.equal(configRan, 1)
})
