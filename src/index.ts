import { HttpError, TimeoutError, AbortError, ParseError, HookError } from './errorType'
export { HttpError, TimeoutError, AbortError, ParseError, HookError }

export interface HttpConfig {
    baseUrl?: string
    headers?: HeadersInit
    timeout?: number
    signal?: AbortSignal
    retry?: number
    retryDelay?: number | ((attempt: number) => number | Promise<number>)
    retryCodes?: number[]
    Hooks?: Hooks
}

export interface RequestHooksContext {
    url: string
    method: string
    headers: Headers
    body: string | undefined
}
export interface ResponseHooksContext {
    result: HttpResult<unknown>
}

export interface RequestErrorHooksContext {
    error: unknown
    url: string
    method: string
}

export interface ResponseErrorHooksContext {
    error: unknown
    code: number
    headers: Headers
    url: string
}

export interface Hooks {
    Request?: (ctx: RequestHooksContext) => void | Promise<void>
    Response?: (ctx: ResponseHooksContext) => void | Promise<void>
    RequestError?: (ctx: RequestErrorHooksContext) => void | Promise<void>
    ResponseError?: (ctx: ResponseErrorHooksContext) => void | Promise<void>
}

export interface RequestOptions
    extends Omit<RequestInit, 'body' | 'headers' | 'method' | 'signal'> {
    method?: string
    body?: BodyInit | Record<string, unknown> | unknown[] | null
    headers?: HeadersInit
    timeout?: number
    signal?: AbortSignal
    query?: Record<string, string>
    responseType?: ResponseType
    retry?: number
    retryDelay?: number | ((attempt: number) => number | Promise<number>)
    retryCodes?: number[]
    Hooks?: Hooks
}

type GetOptions = Omit<RequestOptions, 'method' | 'body'>
type PostOptions = Omit<RequestOptions, 'method'>

export interface HttpResult<T> {
    data: T
    ok: boolean
    code: number
    url: string
    headers: Headers
}

export type ResponseType = 'json' | 'text' | 'blob' | 'arrayBuffer' | 'bytes'

export function isAbsoluteUrl(input: string): boolean {
    const info = URL.parse(input)
    return info != null && (info.protocol === "http:" || info.protocol === "https:")
}

export function buildUrl(baseUrl: string | undefined, path: string): string {
    if (isAbsoluteUrl(path)) return path
    if (!baseUrl) throw new Error(`baseUrl is required when path is not absolute: ${path}`)
    if (/^\/\/[^/]/.test(path)) throw new Error(`protocol-relative URL is not supported: ${path}`)
    const base = baseUrl.replace(/\/+$/, '')
    const tail = path.replace(/^\/+/, '')
    return `${base}/${tail}`
}

export function buildQuery(url: string, query: Record<string, string>): string {
    if (!query || Object.keys(query).length === 0) return url
    const q = new URLSearchParams(query).toString()
    if (!url.includes('?')) return `${url}?${q}` // is already query string
    if (url.endsWith('?')) return `${url}${q}`
    return `${url}&${q}`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === null || proto === Object.prototype;
}

async function RequestHooks(brc: RequestHooksContext, Hooks: Hooks) {
    try {
        await Hooks.Request?.(brc)
    } catch (e) {
        throw new HookError('Request', e)
    }
}

async function ResponseHooks(brc: ResponseHooksContext, Hooks: Hooks) {
    try {
        await Hooks.Response?.(brc)
    } catch (e) {
        throw new HookError('Response', e)
    }
}

async function RequestErrorHooks(brc: RequestErrorHooksContext, Hooks: Hooks) {
    try {
        await Hooks.RequestError?.(brc)
    } catch {
    }
}

async function ResponseErrorHooks(brc: ResponseErrorHooksContext, Hooks: Hooks) {
    try {
        await Hooks.ResponseError?.(brc)
    } catch {
    }
}

async function readResponse<T>(res: Response, responseType: ResponseType | undefined, path: string, method: string): Promise<HttpResult<T>> {

    const meta = {
        ok: res.ok,
        code: res.status,
        url: res.url,
        headers: res.headers,
    }

    switch (responseType) {
        case 'bytes':
            return { data: (await res.bytes()) as unknown as T, ...meta }
        case 'arrayBuffer':
            return { data: (await res.arrayBuffer()) as unknown as T, ...meta }
        case 'blob':
            return { data: (await res.blob()) as unknown as T, ...meta }
        case 'text':
            return { data: (await res.text()) as unknown as T, ...meta }
        case 'json': {
            const text = await res.text()
            if (text === '') {
                return { data: undefined as T, ...meta }
            }
            try {
                return { data: JSON.parse(text) as T, ...meta }
            } catch {
                throw new ParseError(path, method, text.slice(0, 500), res.headers)
            }
        }
        case undefined: {
            const contentType = res.headers.get('content-type')
            const text = await res.text()

            if (text === '') {
                return { data: undefined as T, ...meta }
            }

            if (contentType?.toLowerCase().includes('json')) {
                try {
                    return { data: JSON.parse(text) as T, ...meta }
                } catch {
                    throw new ParseError(path, method, text.slice(0, 500), res.headers)
                }
            }
            return { data: text as unknown as T, ...meta }
        }
    }
}

async function once<T = unknown>(config: HttpConfig,
    path: string,
    options: RequestOptions | undefined,
    attempt: number,
    maxRetry: number,
    retryCodes: number[]): Promise<HttpResult<T>> {
    //headers join
    const headers = new Headers(config.headers)
    if (options?.headers) {
        new Headers(options.headers).forEach((value, key) => {
            headers.set(key, value)
        })
    }

    //abort & timeout set
    const { timeout, signal: userSignal, query, body: rawBody, ...opt } = options ?? {}
    const defaultSignal = config.signal
    const timeoutNum = timeout ?? config.timeout
    const timeoutSignal = timeoutNum && timeoutNum > 0 ? AbortSignal.timeout(timeoutNum) : undefined
    const signal = mergeSignals([defaultSignal, userSignal, timeoutSignal])

    //url
    let url = buildUrl(config.baseUrl, path)
    if (query) {
        url = buildQuery(url, query)
    }

    //json body
    let body: BodyInit | undefined
    if (isPlainObject(rawBody) || Array.isArray(rawBody)) {
        body = JSON.stringify(rawBody)
        if (!headers.has('content-type')) headers.set('content-type', 'application/json')
    } else {
        body = rawBody ?? undefined
    }

    let finalMethod = opt.method ?? 'GET'

    if (signal?.aborted) throw new AbortError(path, finalMethod)
    //BeforeRequestHoos
    const reqHC: RequestHooksContext = {
        url,
        method: finalMethod,
        headers,
        body: typeof body === 'string' ? body : undefined,
    }
    const hooks = options?.Hooks ?? config.Hooks ?? {}
    await RequestHooks(reqHC, hooks)
    finalMethod = reqHC.method
    const finalBody = reqHC.body !== undefined ? reqHC.body : body
    const reqOpt = {
        ...opt,
        method: finalMethod,
        headers: reqHC.headers,
        ...(finalBody !== undefined ? { body: finalBody } : {}),
        ...(signal ? { signal } : {})
    }
    //BeforeRequestHoos
    let res: Response
    try {
        res = await fetch(reqHC.url, reqOpt)
    } catch (e) {
        let err: unknown = e
        if (e instanceof DOMException && e.name === 'TimeoutError') err = new TimeoutError(timeoutNum!, path, finalMethod)
        if (e instanceof DOMException && e.name === 'AbortError') err = new AbortError(path, finalMethod)

        const willThrow = attempt >= maxRetry || !shouldRetry(err, retryCodes)
        if (willThrow) await RequestErrorHooks({ error: err, url: reqHC.url, method: finalMethod }, hooks)
        throw err
    }

    try {
        if (!res.ok) {
            const text = await res.text()
            throw new HttpError(res.status, path, finalMethod, text.slice(0, 500), res.headers)
        }

        const result = await readResponse<T>(res, options?.responseType, path, finalMethod)
        await ResponseHooks({ result }, hooks)
        return result
    } catch (e) {
        const willThrow = attempt >= maxRetry || !shouldRetry(e, retryCodes)
        if (willThrow) await ResponseErrorHooks(
            { error: e, code: res.status, headers: res.headers, url: res.url },
            hooks
        )
        throw e
    }
}

function shouldRetry(e: unknown, codes: number[]): boolean {
    if (e instanceof HookError) return false
    if (e instanceof AbortError) return false
    if (e instanceof ParseError) return false
    if (e instanceof TimeoutError) return true
    if (e instanceof HttpError) return codes.includes(e.status)
    return false
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason)
            return
        }

        function onAbort() {
            clearTimeout(timer)
            reject(signal!.reason)
        }

        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort)
            resolve()
        }, ms)

        signal?.addEventListener('abort', onAbort, { once: true })
    })
}

function mergeSignals(list: (AbortSignal | undefined)[]): AbortSignal | undefined {
    const valid = list.filter((s): s is AbortSignal => s != null)
    if (valid.length === 0) return undefined
    if (valid.length === 1) return valid[0]
    return AbortSignal.any(valid)
}

export function createClient(config: HttpConfig) {
    async function request<T = unknown>(path: string, options?: RequestOptions): Promise<HttpResult<T>> {
        const retry = options?.retry ?? (config.retry ?? 0) // default no retry
        if (!Number.isInteger(retry) || retry < 0) {
            throw new Error(`retry must be a non-negative integer, got ${retry}`)
        }
        const retryCodes = options?.retryCodes ?? (config.retryCodes ?? [500, 502, 503, 504, 508, 429])
        const retryDelay = options?.retryDelay ?? ((attempt: number) => 1000 * (attempt ** 2))   // 1000 4000 8000ms

        let lastError: unknown

        for (let attempt = 0; attempt <= retry; attempt++) {
            try {
                return await once<T>(config, path, options, attempt, retry, retryCodes)
            } catch (e) {
                lastError = e
                if (attempt >= retry || !shouldRetry(e, retryCodes)) throw e

                const delay = typeof retryDelay === 'function' ? await retryDelay(attempt + 1) : retryDelay
                try {
                    await sleep(delay, mergeSignals([config.signal, options?.signal]))
                } catch (e) {
                    if (e instanceof DOMException && e.name === 'AbortError') {
                        throw new AbortError(path, options?.method ?? 'GET')
                    }
                    throw e
                }
            }
        }
        throw lastError
    }

    async function get<T = unknown>(path: string, options?: GetOptions): Promise<HttpResult<T>> {
        return request<T>(path, { ...options, method: 'GET' })
    }

    async function post<T = unknown>(path: string, options?: PostOptions): Promise<HttpResult<T>> {
        return request<T>(path, { ...options, method: 'POST' })
    }

    return {
        request,
        get,
        post
    }
}