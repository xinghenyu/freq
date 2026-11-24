import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient, HttpError, TimeoutError, AbortError } from '../src/index'

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const okJson = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })

async function withFetch(fake: FetchLike, run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch
  globalThis.fetch = fake as unknown as typeof fetch
  try {
    await run()
  } finally {
    globalThis.fetch = original
  }
}

const hanging: FetchLike = (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal
    if (!signal) {
      reject(new Error('expected AbortSignal in request init'))
      return
    }
    // AbortSignal.timeout() 内部定时器是 unref 的：若此刻事件循环已空，
    // 进程会直接退出，这个 promise 永远 pending，测试被判 cancelled。
    // 用一个 ref 定时器把事件循环撑住，abort 触发后再清掉。
    const keepAlive = setTimeout(() => {}, 5000)

    // signal 可能在 fetch 被调用之前就已 aborted（例如 abort 发生在请求前
    // 的 await 期间）。abort 事件只发一次、不会补发，所以这里必须显式检查一次，
    // 否则这个 promise 会永远 pending。真实 fetch 就是这么处理的。
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

test('成功请求返回 data / ok / code', async () => {
  await withFetch(
    async () => okJson([{ name: 'A' }, { name: 'B' }]),
    async () => {
      const client = createClient({ baseURL: 'https://base.test' })
      const res = await client.request<{ name: string }[]>('/json/x')
      assert.equal(res.code, 200)
      assert.equal(res.ok, true)
      assert.deepEqual(res.data, [{ name: 'A' }, { name: 'B' }])
    }
  )
})

test('404 抛 HttpError 并携带 status / path / method / body', async () => {
  await withFetch(
    async () => new Response('not found', { status: 404 }),
    async () => {
      const client = createClient({ baseURL: 'https://base.test' })
      await assert.rejects(
        () => client.request('/json/x'),
        (err: unknown) => {
          if (!(err instanceof HttpError)) throw new Error('expected HttpError')
          assert.equal(err.status, 404)
          assert.equal(err.path, '/json/x')
          assert.equal(err.method, 'GET')
          assert.equal(err.body, 'not found')
          return true
        }
      )
    }
  )
})

test('500 抛 HttpError', async () => {
  await withFetch(
    async () => new Response('boom', { status: 500 }),
    async () => {
      const client = createClient({ baseURL: 'https://base.test' })
      await assert.rejects(
        () => client.request('/json/x', { method: 'POST' }),
        (err: unknown) => {
          if (!(err instanceof HttpError)) throw new Error('expected HttpError')
          assert.equal(err.status, 500)
          assert.equal(err.method, 'POST')
          return true
        }
      )
    }
  )
})

test('实例头与单次头合并，单次覆盖同名', async () => {
  const seen: Headers[] = []
  await withFetch(
    async (_input, init) => {
      seen.push(new Headers(init?.headers))
      return okJson([])
    },
    async () => {
      const client = createClient({
        baseURL: 'https://base.test',
        headers: { 'X-App': 'freq', 'X-Only-Instance': 'yes' }
      })
      await client.request('/json/x', {
        headers: { 'X-App': 'override', 'X-Only-Request': 'yes' }
      })
    }
  )

  const headers = seen[0]
  assert.ok(headers)
  assert.equal(headers.get('x-app'), 'override')
  assert.equal(headers.get('x-only-instance'), 'yes')
  assert.equal(headers.get('x-only-request'), 'yes')
})

test('query 拼进最终 URL', async () => {
  let captured = ''
  await withFetch(
    async (input) => {
      captured = String(input)
      return okJson([])
    },
    async () => {
      const client = createClient({ baseURL: 'https://base.test' })
      await client.request('/json/x', { query: { name: 'xmas', limit: '10' } })
    }
  )

  assert.equal(captured, 'https://base.test/json/x?name=xmas&limit=10')
})

test('空 query 不产生尾随问号', async () => {
  let captured = ''
  await withFetch(
    async (input) => {
      captured = String(input)
      return okJson([])
    },
    async () => {
      const client = createClient({ baseURL: 'https://base.test' })
      await client.request('/json/x', { query: {} })
    }
  )

  assert.equal(captured, 'https://base.test/json/x')
})

test('绝对 URL 绕过 baseURL', async () => {
  let captured = ''
  await withFetch(
    async (input) => {
      captured = String(input)
      return okJson([])
    },
    async () => {
      const client = createClient({ baseURL: 'https://base.test' })
      await client.request('https://other.test/json/x')
    }
  )

  assert.equal(captured, 'https://other.test/json/x')
})

test('get 固定使用 GET 方法', async () => {
  let capturedMethod = ''
  await withFetch(
    async (_input, init) => {
      capturedMethod = String(init?.method ?? '')
      return okJson([])
    },
    async () => {
      const client = createClient({ baseURL: 'https://base.test' })
      await client.get('/json/x', { query: { a: '1' } })
    }
  )

  assert.equal(capturedMethod, 'GET')
})

test('超时抛 TimeoutError', async () => {
  await withFetch(hanging, async () => {
    const client = createClient({ baseURL: 'https://base.test' })
    await assert.rejects(
      () => client.request('/json/x', { timeout: 30 }),
      (err: unknown) => {
        if (!(err instanceof TimeoutError)) throw new Error('expected TimeoutError')
        assert.equal(err.timeout, 30)
        assert.equal(err.path, '/json/x')
        return true
      }
    )
  })
})

test('主动 abort 抛 AbortError', async () => {
  await withFetch(hanging, async () => {
    const client = createClient({ baseURL: 'https://base.test' })
    const ctrl = new AbortController()
    const pending = client.request('/json/x', { signal: ctrl.signal })
    ctrl.abort()
    await assert.rejects(pending, (err: unknown) => {
      if (!(err instanceof AbortError)) throw new Error('expected AbortError')
      assert.equal(err.path, '/json/x')
      return true
    })
  })
})

test('abort 优先于 timeout', async () => {
  await withFetch(hanging, async () => {
    const client = createClient({ baseURL: 'https://base.test' })
    const ctrl = new AbortController()
    const pending = client.request('/json/x', { timeout: 5000, signal: ctrl.signal })
    ctrl.abort()
    await assert.rejects(pending, (err: unknown) => {
      if (!(err instanceof AbortError)) throw new Error('expected AbortError')
      return true
    })
  })
})

test('实例级 config.signal 可以中断请求', async () => {
  await withFetch(hanging, async () => {
    const ctrl = new AbortController()
    const client = createClient({ baseURL: 'https://base.test', signal: ctrl.signal })
    const pending = client.request('/json/x')
    ctrl.abort()
    await assert.rejects(pending, (err: unknown) => {
      if (!(err instanceof AbortError)) throw new Error('expected AbortError')
      return true
    })
  })
})

test('config.signal 与单次 signal 并存时都能中断', async () => {
  await withFetch(hanging, async () => {
    const instanceCtrl = new AbortController()
    const requestCtrl = new AbortController()
    const client = createClient({ baseURL: 'https://base.test', signal: instanceCtrl.signal })
    const pending = client.request('/json/x', { signal: requestCtrl.signal })
    instanceCtrl.abort()
    await assert.rejects(pending, (err: unknown) => {
      if (!(err instanceof AbortError)) throw new Error('expected AbortError')
      return true
    })
  })
})
