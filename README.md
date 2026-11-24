# freq

命名：`fetch-request -> freq`

零依赖的 TypeScript HTTP请求库，基于原生 `fetch` ,自带SSE解析。

- 非 2xx 直接抛错，不用自己判 `ok`
- `baseURL` 前缀与 `query` 自动拼接
- `get` / `post` / `put` / `del` 便捷方法，`path` 也能直接传 `http(s)://` 开头的完整 URL
- 类型友好：`api.get<User>()` 直接拿到 `User`
- 按 `content-type` 自动解析响应
- 重试、超时、取消
- Hooks 四个时机
- 自带 SSE 解析与断线重连
- `raw()` 导出原生 `Response`

```bash
npm i @djiji/freq
```

Node >= 20。

## 快速开始

```ts
import { createClient } from "@djiji/freq";

// 创建一个全局的连接配置，这是必要步骤
const api = createClient({ baseUrl: "https://example.com" });

// 定义一个用户接口
interface User {
  name: string;
  age: number;
}

// 发送一个 GET 请求，返回一个用户列表
const res = await api.get<User[]>("/users", {
  query: { page: "2", size: "10" },
});

res.code; // 200
res.data; // [{name: "djiji", age: 18}, {...}]
res.url; // https://example.com/users?page=2&size=10
```

```ts
...
const api = createClient({}); // 可以传空值
...
const res = await api.get<User[]>("https://example.com/users", {
  query: { page: "2", size: "10" },
});
...
```

## 便捷方法

```ts
api.get("/users", { query: { page: "1" } });
api.get("https://example.com/users", { query: { page: "1" } }); // 支持绝对路径
api.post("/users", { body: { name: "djiji" } });
api.put("/users/1", { body: { age: 19 } });
api.del("/users/1");
```

四个都是 `api.request()` 加 `method` 的包装：

```ts
// 等价关系
api.request("/users", { method: "GET" });
api.get("/users");
...
```

## 请求及响应参数

注意.get(), post(), put(), del() 等便捷方法传参几乎一致

**请求参数**
` const api = createClient(options?: HttpConfig) `
```ts
  baseURL?: string; // URL 前缀
  headers?: HeadersInit; // 默认请求头
  timeout?: number; // 请求超时时间
  signal?: AbortSignal; // 取消信号
  retry?: number; // 重试次数, 默认0
  retryDelay?: number | ((attempt: number) => number | Promise<number>); // 重试延迟时间
  retryCodes?: number[]; // 重试状态码
  hooks?: Hooks; // 四个Hook
  sseReconnect?: SSEReconnect; // SSE 断线重连
  responseType?: ResponseType; // 响应体类型，json、text...
```
` api.request(path: string, options?: RequestInit) `
```ts
  method?: string; // 请求方法
  body?: BodyInit | Record<string, unknown> | unknown[] | null; // 请求体,普通对象自动格式化并添加Content-Type
  headers?: HeadersInit; // 请求头
  timeout?: number; // 请求超时时间，优先级高于全局
  signal?: AbortSignal; // 取消信号
  query?: Record<string, string>; // 查询参数，自动拼接及编码
  responseType?: ResponseType; // 响应体类型，json、text...，优先级高于全局
  retry?: number; // 重试次数, 默认0
  retryDelay?: number | ((attempt: number) => number | Promise<number>); // 重试延迟时间
  retryCodes?: number[]; // 重试状态码
  hooks?: Hooks; // 四个Hook
```

**返回参数**
```ts
  data: T; // 解析后的响应体，泛型支持
  ok: boolean; // 恒为 `true`，失败一律抛错
  code: number; // 状态码
  url: string; // 最终地址，跟随重定向后
  headers: Headers; // 响应头
  redirected: boolean; // 是否发生过重定向
```
## SSE

底层用法：自己拿流，用自带解析器处理。

```ts
const res = await api.request<ReadableStream>("/events", {
  headers: { accept: "text/event-stream" },
  responseType: "stream",
});

for await (const ev of parseSSE(res.data!)) {
  console.log(ev.event, ev.data, ev.id);
}
```

简便方法，请求和解析一步到位：

```ts
for await (const ev of api.sse("/events")) {
  console.log(ev.event, ev.data, ev.id);
}
```

加 `reconnect`，断了会自己重连并带上 `Last-Event-ID` 续传：

```ts
for await (const ev of api.sse("/events", { reconnect: { retry: 3 } })) {
  console.log(ev.data);
}
```

**请求参数**
` for await (const ev of api.sse(path: string, options?: SSEOptions)) `
```ts
  path: string; // 相对路径或 http(s):// 完整 URL
  method?: string; // 请求方法，默认 GET
  body?: BodyInit | Record<string, unknown> | unknown[] | null; // 请求体
  headers?: HeadersInit; // 请求头，不传自动补 accept: text/event-stream
  timeout?: number; // 默认 0，不会被全局 timeout 掐断；传了才生效
  signal?: AbortSignal; // 取消信号，取消后抛 AbortError
  query?: Record<string, string>; // 查询参数，自动拼接及编码
  retry?: number; // 底层单次请求的重试次数；配了 reconnect 时固定为 0
  retryDelay?: number | ((attempt: number) => number | Promise<number>); // 重连延迟的兜底
  retryCodes?: number[]; // 重连状态码的兜底
  hooks?: Hooks; // 四个Hook
  reconnect?: SSEReconnect; // 断线重连，不传则断流直接抛错；不传时沿用全局 sseReconnect
```

`reconnect` 三个字段：
```ts
  retry?: number; // 最多重连次数，默认 0
  delay?: number | ((attempt: number) => number | Promise<number>); // 实际等待 Math.max(你的值, 服务端 retry)
  codes?: number[]; // 命中这些状态码才重连，默认沿用 retryCodes
```

**返回参数**
```ts
  // AsyncGenerator<SSEMessage>，用 for await 逐条取
  event: string; // 事件名，没写就是 "message"
  data: string; // 多行 data 已用 \n 拼好
  id: string | undefined; // 事件 id，跨事件粘性
  retry: number | undefined; // 服务端建议的重连间隔，给一次就一直带
```

## raw

拿到未消费的原生 `Response`

```ts
const res = await api.raw("/big.zip");
await res.arrayBuffer();
```

**请求参数**
` const res = await api.raw(path: string, options?: RequestOptions) `
```ts
  path: string; // 相对路径或 http(s):// 完整 URL
  options?: RequestOptions; // 同 api.request，见上文
```

**返回参数**
```ts
  // 原生 Response，body 未消费
  status: number;
  ok: boolean;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null; // 自己读
```

**注意事项**

- 不检查状态码：4xx、5xx 正常返回，要自己判 `res.ok`
- 不解析 body
- 不触发 `Response` 和 `ResponseError` 钩子
- 不按状态码重试：只有超时（`TimeoutError`）会重试，网络层连不上（`TypeError`）不重试

## 钩子

```ts
const api = createClient({
  baseUrl: "https://api.example.com",
  hooks: {
    Request: [({ headers }) => headers.set("authorization", `Bearer ${token}`)],
    Response: [({ result }) => console.log(result.code)],
    RequestError: [({ error }) => console.warn("没发出去", error)],
    ResponseError: [({ error, code }) => console.warn(code, error)],
  },
});
```

**请求参数**
` hooks?: Hooks `
```ts
  Request?: RequestHook[]; // 发请求前，改 url / method / headers / body
  Response?: ResponseHook[]; // 解析完成后，改 result
  RequestError?: RequestErrorHook[]; // fetch 本身失败
  ResponseError?: ResponseErrorHook[]; // 非 2xx 或解析失败
```

各钩子收到的上下文：
```ts
  // Request
  url: string; method: string; headers: Headers; body: string | undefined;
  // Response
  result: HttpResult<unknown>;
  // RequestError
  error: unknown; url: string; method: string;
  // ResponseError
  error: unknown; code: number; headers: Headers; url: string;
```

**返回参数**
```ts
  void | Promise<void>; // 不接收返回值，靠改上下文生效
```

**注意事项**

- 串行执行，前一个抛错会中断后面的
- 钩子抛错会被包成 `HookError`，且不触发重试
- `RequestError`,`ResponseError`钩子抛错会被吞掉，不影响其它钩子
- 全局钩子与单次请求的钩子叠加，先全局后单次

## 错误处理

失败一律抛异常，所以 `HttpResult.ok` 恒为 `true`：

```ts
import {
  HttpError,
  TimeoutError,
  AbortError,
  ParseError,
  HookError,
} from "@djiji/freq";

try {
  await api.get("/missing");
} catch (e) {
  if (e instanceof HttpError) console.error(e.status, e.body); // 非 2xx
  else if (e instanceof TimeoutError) console.error(e.timeout); // 超时
  else if (e instanceof AbortError) console.error("已取消"); // 主动取消
  else if (e instanceof ParseError) console.error(e.body); // 解析失败
  else if (e instanceof HookError) console.error(e.hook); // 钩子抛错
}
```

**抛出类型**
```ts
  HttpError: { status: number; path: string; method: string; body: string; headers: Headers }; // 非 2xx
  TimeoutError: { timeout: number; path: string; method: string }; // 超时
  AbortError: { path: string; method: string }; // 主动取消
  ParseError: { path: string; method: string; body: string; headers: Headers }; // 解析失败
  HookError: { hook: string; cause: unknown }; // 钩子抛错
```

`body` 只保留前 500 字符。

## 重试

```ts
const api = createClient({
  baseUrl: "https://api.example.com",
  retry: 3,
  retryDelay: (attempt) => attempt * 500,
  retryCodes: [429, 500, 502, 503, 504, 508],
});
```

**请求参数**
```ts
  retry?: number; // 最多重试次数，默认 0；总请求次数是 retry + 1
  retryDelay?: number | ((attempt: number) => number | Promise<number>); // 默认 1000 * 2 ** (attempt - 1)，即 1s、2s、4s……
  retryCodes?: number[]; // 命中才重试，默认 [429, 500, 502, 503, 504, 508]
```

**注意事项**

- 只有超时、以及命中 `retryCodes` 的状态码会重试
- 取消、解析失败、钩子抛错、网络层连不上都不重试
- 单次请求传的同名字段覆盖全局
- 重试耗尽后抛最后一次的错误

## 超时与取消

```ts
const api = createClient({ timeout: 10_000 });

const ac = new AbortController();
const pending = api.get("/slow", { signal: ac.signal });
ac.abort();
```

**请求参数**
```ts
  timeout?: number; // 毫秒，0 或负数表示不限时；单次传的覆盖全局
  signal?: AbortSignal; // 与全局的合并，任一触发就取消
```

**抛出类型**
```ts
  TimeoutError: { timeout: number; path: string; method: string; cause: unknown }; // 超时
  AbortError: { path: string; method: string; cause: unknown }; // 主动取消，cause 是原始 DOMException
```

**注意事项**

- 重试等待期间取消也会立即中断
- `api.sse` 的 `timeout` 默认 `0`，长连接不会被全局超时掐断

## 请求体自动解析

**判定规则**
```ts
  纯对象、数组                       → JSON.stringify，并自动补 content-type: application/json
  字符串                             → 原样发送，content-type 由 fetch 补
  FormData、URLSearchParams、Blob    → 原样发送，content-type 由 fetch 补（含 boundary）
  null、undefined                    → 不发 body
```

## 响应自动解析

**可传参指定解析类型**
```ts
  responseType?: "json" | "text" | "blob" | "arrayBuffer" | "bytes" | "stream"; // 不传则按 content-type 自动判断
```

**判定规则**
```ts
  // 不传 responseType 时，按 content-type 从上往下匹配
  含 event-stream → ReadableStream | null
  含 json → 解析结果，空 body 给 undefined
  text/*、xml、html、svg、form-urlencoded、无 content-type → string，空 body 给 undefined
  其余（图片、pdf、octet-stream……）→ Blob

  // 传了 responseType 时
  "json" → 先读 text 再 JSON.parse，空 body 给 undefined，解析失败抛 ParseError
  "text" → string，空 body 给 undefined
  "blob" → Blob
  "arrayBuffer" → ArrayBuffer
  "bytes" → Uint8Array
  "stream" → ReadableStream | null
```

**返回参数**
```ts
  data: T; // 实际类型由上面规则决定，泛型由调用时指定
```

对应写法：
```ts
await api.get<Data>("/x"); // 自动判断
await api.get<Data>("/x", { responseType: "json" });
await api.get<string>("/x", { responseType: "text" });
await api.get<Blob>("/x", { responseType: "blob" });
await api.get<Uint8Array>("/x", { responseType: "bytes" });
await api.get<ArrayBuffer>("/x", { responseType: "arrayBuffer" });
await api.get<ReadableStream>("/x", { responseType: "stream" });
```

## License

MIT © djiji
