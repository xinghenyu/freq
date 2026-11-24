import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient, HttpError, ParseError } from '../src/index'

/** 让 fetch 固定返回给定响应，跑一次调用并返回结果 */
async function respond<T>(
  response: Response,
  run: (client: ReturnType<typeof createClient>) => Promise<T>
): Promise<T> {
  const original = globalThis.fetch
  globalThis.fetch = (async () => response) as unknown as typeof fetch
  try {
    return await run(createClient({ baseURL: 'https://base.test' }))
  } finally {
    globalThis.fetch = original
  }
}

const jsonRes = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

test('自动模式：json 接口返回解析后的对象', async () => {
  const res = await respond(jsonRes({ name: 'A' }), (c) => c.get<{ name: string }>('/x'))
  assert.deepEqual(res.data, { name: 'A' })
  assert.equal(res.code, 200)
})

test('自动模式：XML 返回原文，不抛错', async () => {
  const xml = '<root><a>1</a></root>'
  const res = await respond(
    new Response(xml, { headers: { 'content-type': 'application/xml' } }),
    (c) => c.get<string>('/feed.xml')
  )
  assert.equal(res.data, xml)
})

test('自动模式：无 content-type 时返回原文', async () => {
  const res = await respond(new Response('plain body'), (c) => c.get<string>('/x'))
  assert.equal(res.data, 'plain body')
})

test('自动模式：204 空响应返回 undefined', async () => {
  const res = await respond(new Response(null, { status: 204 }), (c) => c.get('/x'))
  assert.equal(res.data, undefined)
  assert.equal(res.code, 204)
})

test('自动模式：application/vnd.api+json 也被解析', async () => {
  const res = await respond(
    new Response(JSON.stringify({ id: '1' }), {
      headers: { 'content-type': 'application/vnd.api+json' }
    }),
    (c) => c.get<{ id: string }>('/x')
  )
  assert.deepEqual(res.data, { id: '1' })
})

test('自动模式：声明 json 但内容不是 json，抛 ParseError 并带原文', async () => {
  await assert.rejects(
    () =>
      respond(
        new Response('not json at all', {
          headers: { 'content-type': 'application/json' }
        }),
        (c) => c.get('/x')
      ),
    (err: unknown) => {
      if (!(err instanceof ParseError)) throw new Error('expected ParseError')
      assert.equal(err.body, 'not json at all')
      assert.equal(err.path, '/x')
      assert.equal(err.method, 'GET')
      return true
    }
  )
})

test('强制 text：json 接口也返回原文字符串', async () => {
  const res = await respond(jsonRes({ name: 'A' }), (c) =>
    c.get<string>('/x', { responseType: 'text' })
  )
  assert.equal(res.data, '{"name":"A"}')
})

test('强制 json：内容不是 json 时抛 ParseError', async () => {
  await assert.rejects(
    () =>
      respond(
        new Response('<root/>', { headers: { 'content-type': 'application/xml' } }),
        (c) => c.get('/x', { responseType: 'json' })
      ),
    (err: unknown) => {
      if (!(err instanceof ParseError)) throw new Error('expected ParseError')
      assert.equal(err.body, '<root/>')
      return true
    }
  )
})

test('responseType: arrayBuffer 返回 ArrayBuffer', async () => {
  const res = await respond(
    new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'content-type': 'application/octet-stream' }
    }),
    (c) => c.get<ArrayBuffer>('/a.bin', { responseType: 'arrayBuffer' })
  )
  assert.ok(res.data instanceof ArrayBuffer)
  assert.equal(res.data.byteLength, 3)
  assert.deepEqual([...new Uint8Array(res.data)], [1, 2, 3])
})

test('responseType: blob 返回 Blob 且带 MIME 类型', async () => {
  const res = await respond(
    new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
    (c) => c.get<Blob>('/a.png', { responseType: 'blob' })
  )
  assert.ok(res.data instanceof Blob)
  assert.equal(res.data.type, 'image/png')
})

test('responseType: bytes 返回 Uint8Array', async () => {
  const res = await respond(
    new Response(new Uint8Array([7, 8]), {
      headers: { 'content-type': 'application/octet-stream' }
    }),
    (c) => c.get<Uint8Array>('/a.bin', { responseType: 'bytes' })
  )
  assert.ok(res.data instanceof Uint8Array)
  assert.deepEqual([...res.data], [7, 8])
})

test('错误体被截断到 500 字符', async () => {
  const long = 'x'.repeat(2000)
  await assert.rejects(
    () =>
      respond(new Response(long, { status: 500 }), (c) => c.get('/x')),
    (err: unknown) => {
      if (!(err instanceof HttpError)) throw new Error('expected HttpError')
      assert.equal(err.status, 500)
      assert.equal(err.body.length, 500)
      return true
    }
  )
})
