# freq

零依赖的 TypeScript HTTP 客户端，直接跑在原生 `fetch` 上。带重试、钩子、响应类型自动判断和 SSE 流式解析（含断线重连）。

## 构建与测试

```bash
npm run build   # tsup 打包 dist/index.js，再 tsc 出 .d.ts
npm run check   # tsc --noEmit
npm test        # tsx --test "test/**/*.test.ts"
```

要求 Node >= 20。

## 快速开始

```ts
import { createClient } from "freq";

const api = createClient({
  baseUrl: "https://httpbingo.org",
  headers: { "x-app": "demo" },
  retry: 2,
  timeout: 10_000,
});

const res = await api.get<{ uuid: string }>("/uuid");
console.log(res.code, res.data); // 200 { uuid: "..." }
```

## 客户端方法

| 方法 | 说明 |
| --- | --- |
| `request(path, options)` | 通用入口，方法由 `options.method` 决定 |
| `get / post / put / del` | 方法语法糖，`get` 不允许传 `body` |
| `raw(path, options)` | 返回未消费的 `Response`，自己读流 |
| `sse(path, options)` | 返回 `AsyncGenerator<SSEMessage>` |

所有方法返回 `HttpResult<T>`：

```ts
interface HttpResult<T> {
  data: T;
  ok: boolean;      // 成功时恒为 true（非 2xx 直接抛错）
  code: number;
  url: string;
  headers: Headers;
  redirected: boolean;
}
```

## 配置

| 字段 | 说明 |
| --- | --- |
| `baseUrl` | 相对路径的基地址 |
| `headers` | 全局请求头，与单次请求头浅合并 |
| `timeout` | 毫秒，0 或省略表示不限 |
| `signal` | 全局取消信号，与每次请求的 `signal` 合并 |
| `retry` | 重试次数，默认 0 |
| `retryDelay` | 数字或 `(attempt) => number \| Promise<number>`，默认 `1000 * 2^(attempt-1)` |
| `retryCodes` | 触发重试的状态码，默认 `[429, 500, 502, 503, 504, 508]` |
| `hooks` | 见下文 |
| `responseType` | 全局默认响应类型 |
| `sseReconnect` | SSE 默认重连策略 |

单次请求的 `options` 接受同名字段覆盖，另外支持 `query`（`Record<string, string>`，自动拼到 URL）。

## body 与响应类型

`body` 传普通对象或数组时会自动 `JSON.stringify` 并补 `content-type: application/json`；字符串原样发送。

`responseType` 可选 `json` / `text` / `blob` / `arrayBuffer` / `bytes` / `stream`。省略时按 `content-type` 判断：`event-stream` 给流，`json` 解析 JSON，`text/*`、`xml`、`html`、`svg`、`x-www-form-urlencoded` 给文本，其余给 `blob`。

## 错误

| 类 | 触发条件 | 是否重试 |
| --- | --- | --- |
| `HttpError` | 非 2xx，带 `status` / `path` / `method` / `body` / `headers` | 看 `status` 是否在 `retryCodes` |
| `TimeoutError` | 超时 | 是 |
| `AbortError` | 主动取消 | 否 |
| `ParseError` | JSON / 响应类型解析失败 | 否 |
| `HookError` | 钩子抛错，带 `hook` 名与 `cause` | 否 |

`TimeoutError` / `AbortError` 的 `cause` 保留原始 `DOMException`。

## 钩子

四个时机，每个时刻可挂多个函数，按顺序串行执行；config 与单次请求的钩子会叠加（先 config 后本次）。

```ts
const api = createClient({
  baseUrl: "https://httpbingo.org",
  hooks: {
    Request: [
      async (ctx) => {
        ctx.headers.set("authorization", `Bearer ${token}`);
      },
    ],
    Response: [
      (ctx) => console.log(ctx.result.code),
    ],
    RequestError: [
      (ctx) => console.log("发送失败", ctx.error),
    ],
    ResponseError: [
      (ctx) => console.log("响应失败", ctx.error, ctx.code),
    ],
  },
});
```

- `Request` 可改 `url` / `method` / `headers` / `body`，改完以 `ctx` 的值为准。
- `RequestError` 只在请求没发出去时触发（DNS、连接拒绝、TLS、发送中断）；非 2xx 走 `ResponseError`。
- 钩子自身抛错只会包成 `HookError` 抛出，不会再触发错误钩子。

## SSE

```ts
for await (const ev of api.sse("/events", { reconnect: { retry: 3 } })) {
  console.log(ev.event, ev.data, ev.id);
}
```

- 解析出的 `SSEMessage` 为 `{ event, data, id, retry }`，`event` 缺省是 `"message"`，多行 `data` 用 `\n` 拼接。
- 行终止符支持 `\n`、`\r\n` 和单独的 `\r`。
- 不带 `reconnect` 时流断了直接抛错；带了则按 `retry` 次数重连，每次自动回填 `Last-Event-ID`。
- 重连等待取 `Math.max(用户配置延迟, 服务端下发的 retry)`，服务端只能把间隔调大，不能调小。
- 已经成功收到事件后再断线，不消耗重连预算。
- `sse` 默认 `timeout: 0`，避免全局超时把长连接掐断；需要时可显式传 `timeout`。

## 模块划分

```
src/
├── index.ts        createClient 与公开 API
├── core.ts         单次请求、响应读取、重试判定
├── types.ts        全部类型
├── hooks.ts        钩子执行器
├── utils.ts        URL 拼接、sleep、signal 合并
├── parse.ts        parseSSE
├── errorType.ts    五个错误类
└── constants.ts    默认值
```

依赖单向：`index → core → hooks/utils/constants`，`core` 不反向依赖 `index`。
