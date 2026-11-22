import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient, HttpError } from '../src/index'

interface Captured {
  url: string
  method: string
  headers: Headers
  body: unknown
}

const okJson = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })

/** 跑一次 post，把 fetch 收到的参数抓回来 */
async function capture(
  run: (client: ReturnType<typeof createClient>) => Promise<unknown>,
  response: Response = okJson({ ok: true })
): Promise<Captured> {
  let seen: Captured | undefined
  const original = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    seen = {
      url: String(input),
      method: String(init?.method ?? ''),
      headers: new Headers(init?.headers),
      body: init?.body
    }
    return response
  }) as unknown as typeof fetch

  try {
    const client = createClient({ baseUrl: 'https://base.test' })
    await run(client)
  } finally {
    globalThis.fetch = original
  }

  assert.ok(seen, 'fetch was not called')
  return seen
}

test('对象 body 序列化为 JSON 并补 content-type', async () => {
  const seen = await capture((c) => c.post('/json/x', { body: { a: 1 } }))
  assert.equal(seen.body, '{"a":1}')
  assert.equal(seen.headers.get('content-type'), 'application/json')
})

test('数组 body 也序列化为 JSON', async () => {
  const seen = await capture((c) => c.post('/json/x', { body: [1, 2] }))
  assert.equal(seen.body, '[1,2]')
  assert.equal(seen.headers.get('content-type'), 'application/json')
})

test('Object.create(null) 当作纯对象序列化', async () => {
  const bare = Object.create(null)
  const seen = await capture((c) => c.post('/json/x', { body: bare }))
  assert.equal(seen.body, '{}')
  assert.equal(seen.headers.get('content-type'), 'application/json')
})

test('FormData 原样透传，不序列化也不设 content-type', async () => {
  const fd = new FormData()
  fd.append('name', '张三')
  const seen = await capture((c) => c.post('/json/x', { body: fd }))
  assert.ok(seen.body instanceof FormData)
  assert.equal(seen.body, fd)
  assert.equal(seen.headers.has('content-type'), false)
})

test('URLSearchParams 原样透传，不设 content-type', async () => {
  const sp = new URLSearchParams({ name: '张三' })
  const seen = await capture((c) => c.post('/json/x', { body: sp }))
  assert.equal(seen.body, sp)
  assert.equal(seen.headers.has('content-type'), false)
})

test('字符串 body 原样透传，不当作 JSON', async () => {
  const seen = await capture((c) => c.post('/json/x', { body: '{"a":1}' }))
  assert.equal(seen.body, '{"a":1}')
  assert.equal(seen.headers.has('content-type'), false)
})

test('调用方自定义 content-type 不被覆盖', async () => {
  const seen = await capture((c) =>
    c.post('/json/x', {
      body: { a: 1 },
      headers: { 'content-type': 'application/vnd.api+json' }
    })
  )
  assert.equal(seen.body, '{"a":1}')
  assert.equal(seen.headers.get('content-type'), 'application/vnd.api+json')
})

test('没有 body 时不给 fetch 传 body 字段', async () => {
  const seen = await capture((c) => c.post('/json/x'))
  assert.equal(seen.body, undefined)
})

test('post 固定使用 POST 方法', async () => {
  const seen = await capture((c) => c.post('/json/x', { body: { a: 1 } }))
  assert.equal(seen.method, 'POST')
})

test('post 支持 query 拼接', async () => {
  const seen = await capture((c) => c.post('/json/x', { body: { a: 1 }, query: { page: '2' } }))
  assert.equal(seen.url, 'https://base.test/json/x?page=2')
})

test('post 的 404 走 HttpError，method 记为 POST', async () => {
  await assert.rejects(
    () => capture((c) => c.post('/json/x', { body: { a: 1 } }), new Response('nope', { status: 404 })),
    (err: unknown) => {
      if (!(err instanceof HttpError)) throw new Error('expected HttpError')
      assert.equal(err.status, 404)
      assert.equal(err.method, 'POST')
      return true
    }
  )
})
