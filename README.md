# freq

命名：`fetch-request->freq`

零依赖的 TypeScript HTTP请求库，基于原生 `fetch` ,自带SSE解析。

- 非 2xx 直接抛错，不用自己判 `ok`
- `baseUrl` 前缀与 `query` 自动拼接
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

## createClient参数

**请求参数**
createClient(?)
path :

**返回参数**

`HttpResult<T>`，`T` 由调用时指定：

```ts
const res = await api.get<User>("/users/1");
res.data.name; // "djiji"
```

| 字段         | 类型      | 说明                      |
| ------------ | --------- | ------------------------- |
| `data`       | `T`       | 解析后的响应体            |
| `code`       | `number`  | 状态码                    |
| `url`        | `string`  | 最终地址，跟随重定向后    |
| `headers`    | `Headers` | 响应头                    |
| `redirected` | `boolean` | 是否发生过重定向          |
| `ok`         | `boolean` | 恒为 `true`，失败一律抛错 |

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

`path` 和 `options` 与 `request` 相同，区别只有这几项：

| 项                       | 说明                                   |
| ------------------------ | -------------------------------------- |
| `options.reconnect`      | 多出来的，控制重连；不传则断流直接抛错 |
| `options.responseType`   | 不需要，固定按流处理                   |
| `options.headers.accept` | 不传会自动补 `text/event-stream`       |
| `options.timeout`        | 默认 `0`，不会被全局超时掐断长连接     |

`reconnect` 三个字段：

| 字段    | 说明                                                                  |
| ------- | --------------------------------------------------------------------- |
| `retry` | 最多重连次数，默认 `0`                                                |
| `delay` | 毫秒或 `(attempt) => number`，实际等 `Math.max(你的值, 服务端 retry)` |
| `codes` | 命中这些状态码才重连，默认沿用 `retryCodes`                           |

**返回参数**

`AsyncGenerator<SSEMessage>`，用 `for await` 逐条取：

| 字段    | 类型                  | 说明                       |
| ------- | --------------------- | -------------------------- |
| `event` | `string`              | 事件名，缺省 `"message"`   |
| `data`  | `string`              | 多行 `data` 已用 `\n` 拼好 |
| `id`    | `string \| undefined` | 事件 id，跨事件粘性        |
| `retry` | `number \| undefined` | 服务端建议的重连间隔       |

## raw

拿到未消费的原生 `Response`

```ts
const res = await api.raw("/big.zip");
await res.arrayBuffer();
```

**请求参数**

`path` 和 `options` 与 `request` 完全一致。

**返回参数**

原生 `Response`，`body` 未消费：

```ts
const res = await api.raw("/file");
res.status; // 200
res.body; // ReadableStream | null，未消费
```

**注意事项**

- 不检查状态码：4xx、5xx 正常返回，要自己判 `res.ok`
- 不解析 body
- 不触发 `Response` 和 `ResponseError` 钩子
- 不按状态码重试：只有超时（`TimeoutError`）会重试，网络层连不上（`TypeError`）不重试

## 钩子

```ts
const hook = {
  Request: [({ headers }) => headers.set("authorization", `Bearer ${token}`)],
  Response: [({ result }) => console.log(result.code, result.url)],
  RequestError: [({ error }) => console.warn("没发出去", error)],
  ResponseError: [({ error, code }) => console.warn(code, error)],
};

const api = createClient({
  baseUrl: "https://api.example.com",
  hooks: hook,
});
```

**钩子的上下文**

| 时机            | 上下文字段                      | 说明           |
| --------------- | ------------------------------- | -------------- |
| `Request`       | `url` `method` `headers` `body` | 可改，立即生效 |
| `Response`      | `result`                        | 可改内部字段   |
| `RequestError`  | `error` `url` `method`          | 只读           |
| `ResponseError` | `error` `code` `headers` `url`  | 只读           |

**注意事项**

- 串行执行，前一个抛错会中断后面的
- 钩子抛错会被包成 `HookError`，且不触发重试
- `RequestError`,`ResponseError`钩子抛错会被吞掉，不影响其它钩子
- 全局钩子与单次请求的钩子叠加，先全局后单次

## 错误处理

失败一律抛异常，所以 `HttpResult.ok` 恒为 `true`：

```ts
import { HttpError, TimeoutError, AbortError, ParseError } from "@djiji/freq";

try {
  await api.get("/missing");
} catch (e) {
  if (e instanceof HttpError)
    console.error(e.status, e.body); // 非 2xx
  else if (e instanceof TimeoutError)
    console.error(e.timeout); // 超时
  else if (e instanceof AbortError)
    console.error("已取消"); // 主动取消
  else if (e instanceof ParseError) console.error(e.body); // JSON 坏了
}
```

| 类             | 触发          | 额外字段                                  |
| -------------- | ------------- | ----------------------------------------- |
| `HttpError`    | 非 2xx        | `status` `path` `method` `body` `headers` |
| `TimeoutError` | 超时          | `timeout`                                 |
| `AbortError`   | 取消          | `path` `method`                           |
| `ParseError`   | JSON 解析失败 | `path` `method` `body`                    |
| `HookError`    | 钩子抛错      | `hook` `cause`                            |

`HttpError.body` 和 `ParseError.body` 只保留前 500 字符，避免把整个大响应塞进异常。

## 重试

```ts
const api = createClient({
  baseUrl: "https://api.example.com",
  retry: 3,
  retryDelay: (attempt) => attempt * 500,
  retryCodes: [429, 500, 502, 503, 504, 508],
});
```

- `retry` 最多重试次数，默认 `0`（总请求次数是 `retry + 1`）
- `retryDelay` 重试间隔，数字或函数；函数收到第几次重试（从 `1` 开始），默认 `1000 * 2 ** (attempt - 1)`，即 1s、2s、4s……
- `retryCodes` 命中这些状态码才重试，默认 `[429, 500, 502, 503, 504, 508]`
- 只有超时、以及命中 `retryCodes` 的状态码会重试；取消、解析失败、钩子抛错、网络层连不上都不重试

## 超时与取消

```ts
const api = createClient({ timeout: 10_000 });

const ac = new AbortController();
const pending = api.get("/slow", { signal: ac.signal });
ac.abort(); // 抛 AbortError，cause 是原始 DOMException
```

- `timeout` 超时时间，单位毫秒
- `signal` 取消信号

## 请求体自动解析

```ts
await api.post("/users", { body: { name: "djiji" } }); // JSON + application/json
await api.post("/upload", { body: new FormData() }); // multipart/form-data
await api.post("/login", { body: new URLSearchParams() }); // x-www-form-urlencoded
await api.post("/raw", { body: "纯文本" }); // 原样发送
```

对象和数组自动 `JSON.stringify`；自动携带 `content-type` 。

## 响应类型

按 `content-type` 判断 `data` 的返回内容，也可以强制指定：

```ts
// Data 是占位类型，换成你自己的
await api.get<Data>("/x"); // 自动判断
await api.get<Data>("/x", { responseType: "json" });
await api.get<string>("/x", { responseType: "text" });
await api.get<Blob>("/x", { responseType: "blob" });
await api.get<Uint8Array>("/x", { responseType: "bytes" });
await api.get<ArrayBuffer>("/x", { responseType: "arrayBuffer" });
await api.get<ReadableStream>("/x", { responseType: "stream" });
```

自动判断规则：含 `event-stream` 给流；含 `json` 解析（空 body 给 `undefined`）；`text/*`、xml、html、svg、form-urlencoded、没有 content-type 给字符串；其余给 `Blob`。

## License

MIT © djiji
