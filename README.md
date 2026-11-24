# freq

Name: `fetch-request -> freq`

Zero-dependency TypeScript HTTP client built on native `fetch`, with built-in SSE parsing.

[中文文档](./README-cn.md)

- Throws on non-2xx, no need to check `ok` yourself
- `baseURL` prefix and `query` joined automatically
- `get` / `post` / `put` / `del` shortcuts, `path` can also be a full `http(s)://` URL
- Typed: `api.get<User>()` gives you a `User`
- Parses the body by `content-type`
- Retry, timeout, cancellation
- Four hook stages
- Built-in SSE parsing and reconnection
- `raw()` returns the native `Response`

```bash
npm i @djiji/freq
```

Node >= 20.

## Quick Start

```ts
import { createClient } from "@djiji/freq";

// create one client with shared config — this step is required
const api = createClient({ baseURL: "https://example.com" });

// describe the shape you expect
interface User {
  name: string;
  age: number;
}

// GET a list of users
const res = await api.get<User[]>("/users", {
  query: { page: "2", size: "10" },
});

res.code; // 200
res.data; // [{name: "djiji", age: 18}, {...}]
res.url; // https://example.com/users?page=2&size=10
```

```ts
...
const api = createClient({}); // an empty config is fine
...
const res = await api.get<User[]>("https://example.com/users", {
  query: { page: "2", size: "10" },
});
...
```

## Shortcuts

```ts
api.get("/users", { query: { page: "1" } });
api.get("https://example.com/users", { query: { page: "1" } }); // absolute URL works
api.post("/users", { body: { name: "djiji" } });
api.put("/users/1", { body: { age: 19 } });
api.del("/users/1");
```

All four are `api.request()` with a `method`:

```ts
// equivalent
api.request("/users", { method: "GET" });
api.get("/users");
...
```

## Request and Response

Note: `.get()`, `.post()`, `.put()` and `.del()` take almost the same options.

**Request**
` const api = createClient(options?: HttpConfig) `
```ts
  baseURL?: string; // URL prefix
  headers?: HeadersInit; // default headers
  timeout?: number; // request timeout
  signal?: AbortSignal; // cancellation signal
  retry?: number; // retry count, default 0
  retryDelay?: number | ((attempt: number) => number | Promise<number>); // retry delay
  retryCodes?: number[]; // status codes to retry
  hooks?: Hooks; // four hooks
  sseReconnect?: SSEReconnect; // SSE reconnection
  responseType?: ResponseType; // json, text...
```
` api.request(path: string, options?: RequestOptions) `
```ts
  method?: string; // HTTP method
  body?: BodyInit | Record<string, unknown> | unknown[] | null; // plain objects are stringified, content-type is set
  headers?: HeadersInit; // request headers
  timeout?: number; // overrides the global one
  signal?: AbortSignal; // cancellation signal
  query?: Record<string, string>; // joined and encoded automatically
  responseType?: ResponseType; // overrides the global one
  retry?: number; // retry count, default 0
  retryDelay?: number | ((attempt: number) => number | Promise<number>); // retry delay
  retryCodes?: number[]; // status codes to retry
  hooks?: Hooks; // four hooks
```

**Response**
```ts
  data: T; // parsed body, typed by the generic
  ok: boolean; // always true, failures throw
  code: number; // status code
  url: string; // final URL after redirects
  headers: Headers; // response headers
  redirected: boolean; // whether a redirect happened
```

## SSE

Low-level: grab the stream yourself and feed it to the built-in parser.

```ts
const res = await api.request<ReadableStream>("/events", {
  headers: { accept: "text/event-stream" },
  responseType: "stream",
});

for await (const ev of parseSSE(res.data!)) {
  console.log(ev.event, ev.data, ev.id);
}
```

Shortcut — request and parse in one step:

```ts
for await (const ev of api.sse("/events")) {
  console.log(ev.event, ev.data, ev.id);
}
```

With `reconnect`, a dropped connection is reopened with `Last-Event-ID` to resume:

```ts
for await (const ev of api.sse("/events", { reconnect: { retry: 3 } })) {
  console.log(ev.data);
}
```

**Request**
` for await (const ev of api.sse(path: string, options?: SSEOptions)) `
```ts
  path: string; // relative path or full http(s):// URL
  method?: string; // HTTP method, default GET
  body?: BodyInit | Record<string, unknown> | unknown[] | null; // request body
  headers?: HeadersInit; // accept: text/event-stream is added when missing
  timeout?: number; // defaults to 0, the global timeout never cuts a long connection
  signal?: AbortSignal; // throws AbortError on cancel
  query?: Record<string, string>; // joined and encoded automatically
  retry?: number; // retries of a single request, forced to 0 when reconnect is set
  retryDelay?: number | ((attempt: number) => number | Promise<number>); // fallback for reconnect delay
  retryCodes?: number[]; // fallback for reconnect codes
  hooks?: Hooks; // four hooks
  reconnect?: SSEReconnect; // without it a dropped stream throws, falls back to the global sseReconnect
```

`reconnect` fields:
```ts
  retry?: number; // max reconnects, default 0
  delay?: number | ((attempt: number) => number | Promise<number>); // waits Math.max(yours, server retry)
  codes?: number[]; // status codes that trigger a reconnect, defaults to retryCodes
```

**Response**
```ts
  // AsyncGenerator<SSEMessage>, consumed with for await
  event: string; // "message" when not set
  data: string; // multi-line data joined with \n
  id: string | undefined; // sticky across events
  retry: number | undefined; // server-suggested interval, sticky once sent
```

## raw

Returns the native `Response`, body untouched.

```ts
const res = await api.raw("/big.zip");
await res.arrayBuffer();
```

**Request**
` const res = await api.raw(path: string, options?: RequestOptions) `
```ts
  path: string; // relative path or full http(s):// URL
  options?: RequestOptions; // same as api.request
```

**Response**
```ts
  // native Response, body not consumed
  status: number;
  ok: boolean;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null; // read it yourself
```

**Notes**

- No status check: 4xx and 5xx come back as-is, check `res.ok` yourself
- Body is not parsed
- `Response` and `ResponseError` hooks do not fire
- No status-code retry: only timeouts (`TimeoutError`) retry, network failures (`TypeError`) do not

## Hooks

```ts
const api = createClient({
  baseURL: "https://api.example.com",
  hooks: {
    Request: [({ headers }) => headers.set("authorization", `Bearer ${token}`)],
    Response: [({ result }) => console.log(result.code)],
    RequestError: [({ error }) => console.warn("request failed", error)],
    ResponseError: [({ error, code }) => console.warn(code, error)],
  },
});
```

**Request**
` hooks?: Hooks `
```ts
  Request?: RequestHook[]; // before sending, edit url / method / headers / body
  Response?: ResponseHook[]; // after parsing, edit result
  RequestError?: RequestErrorHook[]; // fetch itself failed
  ResponseError?: ResponseErrorHook[]; // non-2xx or parse failure
```

Context each hook receives:
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

**Response**
```ts
  void | Promise<void>; // nothing is read back, mutate the context instead
```

**Notes**

- Run in sequence, a throw stops the rest
- A thrown hook is wrapped into `HookError` and is not retried
- Throws inside `RequestError` / `ResponseError` are swallowed
- Global hooks and per-request hooks stack, global first

## Error Handling

Everything fails by throwing, so `HttpResult.ok` is always `true`:

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
  if (e instanceof HttpError) console.error(e.status, e.body); // non-2xx
  else if (e instanceof TimeoutError) console.error(e.timeout); // timeout
  else if (e instanceof AbortError) console.error("aborted"); // cancelled
  else if (e instanceof ParseError) console.error(e.body); // parse failure
  else if (e instanceof HookError) console.error(e.hook); // hook threw
}
```

**Thrown types**
```ts
  HttpError: { status: number; path: string; method: string; body: string; headers: Headers }; // non-2xx
  TimeoutError: { timeout: number; path: string; method: string }; // timeout
  AbortError: { path: string; method: string }; // cancelled
  ParseError: { path: string; method: string; body: string; headers: Headers }; // parse failure
  HookError: { hook: string; cause: unknown }; // hook threw
```

`body` keeps only the first 500 characters.

## Retry

```ts
const api = createClient({
  baseURL: "https://api.example.com",
  retry: 3,
  retryDelay: (attempt) => attempt * 500,
  retryCodes: [429, 500, 502, 503, 504, 508],
});
```

**Request**
```ts
  retry?: number; // max retries, default 0; total attempts = retry + 1
  retryDelay?: number | ((attempt: number) => number | Promise<number>); // default 1000 * 2 ** (attempt - 1), i.e. 1s, 2s, 4s...
  retryCodes?: number[]; // default [429, 500, 502, 503, 504, 508]
```

**Notes**

- Only timeouts and status codes in `retryCodes` are retried
- Cancellation, parse failures, hook throws and network failures are not retried
- Per-request fields override the global ones
- The last error is thrown once retries run out

## Timeout and Cancellation

```ts
const api = createClient({ timeout: 10_000 });

const ac = new AbortController();
const pending = api.get("/slow", { signal: ac.signal });
ac.abort();
```

**Request**
```ts
  timeout?: number; // milliseconds, 0 or negative means no limit; per-request wins
  signal?: AbortSignal; // merged with the global one, any abort cancels
```

**Thrown types**
```ts
  TimeoutError: { timeout: number; path: string; method: string; cause: unknown }; // timeout
  AbortError: { path: string; method: string; cause: unknown }; // cancelled, cause is the original DOMException
```

**Notes**

- Cancelling during a retry wait aborts immediately
- `api.sse` uses `timeout: 0`, a long connection is never cut by the global timeout

## Request Body

**Rules**
```ts
  plain objects and arrays        → JSON.stringify, content-type: application/json is added
  strings                         → sent as-is, content-type filled by fetch
  FormData, URLSearchParams, Blob → sent as-is, content-type filled by fetch (boundary included)
  null, undefined                 → no body
```

## Response Parsing

**Specify a type**
```ts
  responseType?: "json" | "text" | "blob" | "arrayBuffer" | "bytes" | "stream"; // when omitted, content-type decides
```

**Rules**
```ts
  // without responseType, matched top-down against content-type
  contains event-stream → ReadableStream | null
  contains json → parsed value, undefined for an empty body
  text/*, xml, html, svg, form-urlencoded, missing content-type → string, undefined for an empty body
  anything else (images, pdf, octet-stream...) → Blob

  // with responseType
  "json" → text then JSON.parse, undefined for an empty body, throws ParseError on failure
  "text" → string, undefined for an empty body
  "blob" → Blob
  "arrayBuffer" → ArrayBuffer
  "bytes" → Uint8Array
  "stream" → ReadableStream | null
```

**Response**
```ts
  data: T; // actual type follows the rules above, T is given at the call site
```

Usage:
```ts
await api.get<Data>("/x"); // auto
await api.get<Data>("/x", { responseType: "json" });
await api.get<string>("/x", { responseType: "text" });
await api.get<Blob>("/x", { responseType: "blob" });
await api.get<Uint8Array>("/x", { responseType: "bytes" });
await api.get<ArrayBuffer>("/x", { responseType: "arrayBuffer" });
await api.get<ReadableStream>("/x", { responseType: "stream" });
```

## License

MIT © djiji
