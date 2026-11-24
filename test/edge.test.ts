import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createClient,
  buildUrl,
  buildQuery,
  HttpError,
  ParseError,
  HookError,
  AbortError,
  type HttpConfig
} from '../src/index'

type Client = ReturnType<typeof createClient>
type Call = { url: string; init: RequestInit | undefined }

async function withFetch(
  fetchImpl: (url: string, init?: RequestInit) => Response | Promise<Response>,
  run: (client: Client, calls: Call[]) => Promise<void>,
  config: HttpConfig = {}
): Promise<void> {
  const original = globalThis.fetch
  const calls: Call[] = []

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    return fetchImpl(url, init)
  }) as unknown as typeof fetch

  try {
    await run(createClient({ baseURL: 'https://base.test', ...config }), calls)
  } finally {
    globalThis.fetch = original
  }
}

const json = (body: string, headers: Record<string, string> = {}): Response =>
  new Response(body, { status: 200, headers: { 'content-type': 'application/json', ...headers } })

/* ---------- 边界：retry 参数 ---------- */

test('retry 为负数时应该抛真实的 Error，而不是 undefined', async () => {
  await withFetch(
    () => new Response('ok'),
    async (client) => {
      await assert.rejects(
        () => client.get('/x', { retry: -1 }),
        (err: unknown) => {
          assert.ok(err instanceof Error, `expected an Error, got ${String(err)}`)
          return true
        }
      )
    }
  )
})

test('retry 为 0 时失败立即抛出，只请求一次', async () => {
  await withFetch(
    () => new Response('boom', { status: 500 }),
    async (client, calls) => {
      await assert.rejects(() => client.get('/x', { retry: 0 }), HttpError)
      assert.equal(calls.length, 1)
    }
  )
})

/* ---------- 边界：content-type 大小写 ---------- */

test('content-type 大小写混合时也应自动解析 JSON', async () => {
  await withFetch(
    () => new Response('{"a":1}', { status: 200, headers: { 'content-type': 'Application/JSON; charset=utf-8' } }),
    async (client) => {
      const res = await client.get<{ a: number }>('/x')
      assert.deepEqual(res.data, { a: 1 })
    }
  )
})

/* ---------- 边界：buildQuery / buildUrl ---------- */

test('url 已以 ? 结尾时追加参数不产生 ?&', () => {
  assert.equal(buildQuery('https://x.com/a?', { b: '2' }), 'https://x.com/a?b=2')
})

test('参数值需要 URL 编码', () => {
  assert.equal(buildQuery('https://x.com/a', { q: 'a b&c' }), 'https://x.com/a?q=a+b%26c')
})

test('空 path 与多斜杠 path 的拼接', () => {
  assert.equal(buildUrl('https://base.test', ''), 'https://base.test/')
  assert.equal(buildUrl('https://base.test', '///list'), 'https://base.test/list')
  assert.equal(buildUrl('https://base.test/', '/list'), 'https://base.test/list')
})

test('协议相对地址不应被拼到 baseURL 后面', async () => {
  let seen = ''
  const original = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request) => {
    seen = String(input)
    return new Response('ok')
  }) as unknown as typeof fetch

  try {
    await assert.rejects(
      () => createClient({ baseURL: 'https://base.test' }).get('//other.test/x'),
      /protocol-relative/
    )
  } finally {
    globalThis.fetch = original
  }

  assert.equal(seen, '', '协议相对地址根本不该发请求')
})

/* ---------- 边界：body ---------- */

test('body 为 null 时原样透传且不触发 JSON 序列化', async () => {
  await withFetch(
    () => new Response('ok'),
    async (client, calls) => {
      // RequestInit 本身允许 body: null（表示无正文），但 RequestOptions 的类型没放开
      await client.post('/x', { body: null as unknown as BodyInit })
      // null 在库里归一成 undefined（fetch 语义上等价于无正文），关键是别变成字符串 'null'
      assert.equal(calls[0]?.init?.body, undefined)
      const headers = new Headers(calls[0]?.init?.headers)
      assert.equal(headers.get('content-type'), null)
    }
  )
})

test('Object.create(null) 作为 body 会序列化为 JSON', async () => {
  const payload = Object.create(null) as Record<string, unknown>
  payload.a = 1

  await withFetch(
    () => new Response('ok'),
    async (client, calls) => {
      await client.post('/x', { body: payload })
      assert.equal(calls[0]?.init?.body, '{"a":1}')
    }
  )
})

test('单次请求的 header 覆盖实例 header', async () => {
  await withFetch(
    () => new Response('ok'),
    async (client, calls) => {
      await client.get('/x', { headers: { 'x-a': 'b' } })
      const headers = new Headers(calls[0]?.init?.headers)
      assert.equal(headers.get('x-a'), 'b')
      assert.equal(headers.get('x-base'), '1')
    },
    { headers: { 'x-base': '1', 'x-a': 'instance' } }
  )
})

/* ---------- 边界：空响应 ---------- */

test('204 无内容时 data 是 undefined', async () => {
  await withFetch(
    () => new Response(null, { status: 204 }),
    async (client) => {
      const res = await client.get('/x')
      assert.equal(res.data, undefined)
      assert.equal(res.code, 204)
    }
  )
})

test('强制 responseType: text 时 204 得到空字符串', async () => {
  await withFetch(
    () => new Response(null, { status: 204 }),
    async (client) => {
      const res = await client.get('/x', { responseType: 'text' })
      assert.equal(res.data, '')
    }
  )
})

/* ---------- 边界：timeout / 重试配置 ---------- */

test('timeout 为 0 表示不设超时', async () => {
  await withFetch(
    () => json('{"a":1}'),
    async (client, calls) => {
      const res = await client.get<{ a: number }>('/x', { timeout: 0 })
      assert.equal(res.code, 200)
      assert.equal(calls[0]?.init?.signal, undefined)
    }
  )
})

test('retryCodes 为空数组时任何状态码都不重试', async () => {
  await withFetch(
    () => new Response('boom', { status: 500 }),
    async (client, calls) => {
      await assert.rejects(() => client.get('/x', { retry: 3, retryCodes: [] }), HttpError)
      assert.equal(calls.length, 1)
    }
  )
})

test('retryDelay 为数字时每轮等待同一毫秒数', async () => {
  let attempts = 0
  await withFetch(
    () => {
      attempts++
      return attempts < 3 ? new Response('boom', { status: 500 }) : json('{"ok":true}')
    },
    async (client) => {
      const res = await client.get<{ ok: boolean }>('/x', { retry: 2, retryDelay: 1 })
      assert.deepEqual(res.data, { ok: true })
      assert.equal(attempts, 3)
    }
  )
})

/* ---------- 钩子：抛错与重试 ---------- */

test('Request hook 抛错不参与重试，hook 只跑一次', async () => {
  let hookCalls = 0
  let fetched = 0

  await withFetch(
    () => {
      fetched++
      return new Response('ok')
    },
    async (client) => {
      await assert.rejects(() => client.get('/x', { retry: 3 }), HookError)
    },
    { hooks: { Request: [() => { hookCalls++; throw new Error('sign failed') }] } }
  )

  assert.equal(fetched, 0, 'hook 抛错时请求根本没发出去')
  assert.equal(hookCalls, 1, `hook 不应随重试重复执行，实际执行次数: ${hookCalls}`)
})

test('HookError 保留原始错误在 cause 上', async () => {
  const boom = new Error('sign failed')

  await withFetch(
    () => new Response('ok'),
    async (client) => {
      await assert.rejects(
        () => client.get('/x'),
        (err: unknown) => {
          if (!(err instanceof HookError)) throw new Error('expected HookError')
          assert.equal((err.cause as Error)?.message, 'sign failed')
          return true
        }
      )
    },
    { hooks: { Request: [() => { throw boom }] } }
  )
})

test('重试多次时 ResponseError 只应上报最终失败一次', async () => {
  let reports = 0

  await withFetch(
    () => new Response('boom', { status: 500 }),
    async (client) => {
      await assert.rejects(() => client.get('/x', { retry: 2, retryDelay: 1 }), HttpError)
    },
    { hooks: { ResponseError: [() => { reports++ }] } }
  )

  assert.equal(reports, 1, `应只上报一次，实际上报次数: ${reports}`)
})

test('错误钩子自己抛错时，业务拿到的仍是原始错误', async () => {
  await withFetch(
    () => new Response('boom', { status: 500 }),
    async (client) => {
      await assert.rejects(
        () => client.get('/x'),
        (err: unknown) => {
          if (!(err instanceof HttpError)) throw new Error(`expected HttpError, got ${String(err)}`)
          assert.equal(err.status, 500)
          return true
        }
      )
    },
    { hooks: { ResponseError: [() => { throw new Error('reporter broken') }] } }
  )
})

test('ParseError 归入响应错误域，且 code 是真实状态码', async () => {
  let observed: { code: number; isParse: boolean } | undefined

  await withFetch(
    () => new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } }),
    async (client) => {
      await assert.rejects(() => client.get('/x'), ParseError)
    },
    {
      hooks: {
        ResponseError: [
          (ctx) => {
            observed = { code: ctx.code, isParse: ctx.error instanceof ParseError }
          }
        ]
      }
    }
  )

  assert.equal(observed?.code, 200)
  assert.equal(observed?.isParse, true)
})

/* ---------- 边界：退避期间取消 ---------- */

test('重试退避期间 abort 立即生效，不等满 delay', async () => {
  let fetched = 0

  await withFetch(
    () => {
      fetched++
      return new Response('boom', { status: 500 })
    },
    async (client) => {
      const ctrl = new AbortController()
      const started = Date.now()
      const p = client.get('/x', { retry: 1, retryDelay: 2000, signal: ctrl.signal })

      setTimeout(() => ctrl.abort(), 20)

      await assert.rejects(p, AbortError)
      const elapsed = Date.now() - started
      assert.ok(elapsed < 500, `退避期间应立刻中断，实际耗时 ${elapsed}ms`)
    }
  )

  assert.equal(fetched, 1, 'abort 之后不应再发第二次请求')
})
