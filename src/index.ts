import { HttpError, TimeoutError, AbortError, ParseError } from './errorType'
export { HttpError, TimeoutError, AbortError, ParseError }

export interface HttpConfig {
    baseUrl?: string
    headers?: HeadersInit
    timeout?: number
    signal?: AbortSignal
}

export interface RequestOptions {
    method?: string
    body?: BodyInit | Record<string, unknown> | unknown[]
    headers?: HeadersInit
    timeout?: number
    signal?: AbortSignal
    query?: Record<string, string>
    responseType?: ResponseType
}

type GetOptions = Omit<RequestOptions, 'method' | 'body'>
type PostOptions = Omit<RequestOptions, 'method'>

export interface HttpResult<T> {
    data: T
    ok: boolean
    code: number
}

export type ResponseType = 'json' | 'text' | 'blob' | 'arrayBuffer' | 'bytes'

export function isAbsoluteUrl(input: string): boolean {
    const info = URL.parse(input)
    return info != null && (info.protocol === "http:" || info.protocol === "https:")
}

export function buildUrl(baseUrl: string | undefined, path: string): string {
    if (isAbsoluteUrl(path)) return path
    if (!baseUrl) throw new Error(`baseUrl is required when path is not absolute: ${path}`)
    const base = baseUrl.replace(/\/+$/, '')
    const tail = path.replace(/^\/+/, '')
    return `${base}/${tail}`
}

export function buildQuery(url: string, query: Record<string, string>): string {
    if (!query || Object.keys(query).length === 0) return url
    const q = new URLSearchParams(query).toString()
    const hasQuery = url.includes("?")// is already query string
    return hasQuery ? `${url}&${q}` : `${url}?${q}`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === null || proto === Object.prototype;
}

export function createClient(config: HttpConfig) {
    async function request<T = unknown>(path: string, options?: RequestOptions): Promise<HttpResult<T>> {

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
        const signals: AbortSignal[] = []
        if (defaultSignal) signals.push(defaultSignal)
        if (userSignal) signals.push(userSignal)
        if (timeoutSignal) signals.push(timeoutSignal)
        const signal =
            signals.length === 0
                ? undefined
                : signals.length === 1
                    ? signals[0]
                    : AbortSignal.any(signals)

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
            body = rawBody
        }

        // send request
        try {
            const res = await fetch(url, { ...opt, headers, ...(body !== undefined ? { body } : {}), ...(signal ? { signal } : {}) })

            if (!res.ok) {
                const text = await res.text()
                throw new HttpError(
                    res.status,
                    path,
                    opt.method ?? 'GET',
                    text.slice(0, 500)
                )
            }

            //response type
            const responseType = options?.responseType
            switch (responseType) {
                case 'bytes':
                    return {
                        data: (await res.bytes()) as unknown as T,
                        ok: res.ok,
                        code: res.status
                    }
                case 'arrayBuffer':
                    return {
                        data: (await res.arrayBuffer()) as unknown as T,
                        ok: res.ok,
                        code: res.status
                    }
                case 'blob':
                    return {
                        data: (await res.blob()) as unknown as T,
                        ok: res.ok,
                        code: res.status
                    }
                case 'text':
                    return {
                        data: (await res.text()) as unknown as T,
                        ok: res.ok,
                        code: res.status
                    }
                case 'json':
                    const text = await res.text()
                    if (text === '') {
                        return { data: undefined as T, ok: res.ok, code: res.status }
                    }
                    try {
                        return { data: JSON.parse(text) as T, ok: res.ok, code: res.status }
                    } catch {
                        throw new ParseError(path, opt.method ?? 'GET', text.slice(0, 500))
                    }
                case undefined: {
                    const contentType = res.headers.get('content-type')
                    const text = await res.text()

                    if (text === '') {
                        return { data: undefined as T, ok: res.ok, code: res.status }
                    }

                    if (contentType?.includes('json')) {
                        try {
                            return { data: JSON.parse(text) as T, ok: res.ok, code: res.status }
                        } catch {
                            throw new ParseError(path, opt.method ?? 'GET', text.slice(0, 500))
                        }
                    }
                    return { data: text as unknown as T, ok: res.ok, code: res.status }
                }
            }
        }

        catch (e) {
            if (e instanceof DOMException && e.name === 'TimeoutError') {
                throw new TimeoutError(timeoutNum!, path, opt.method ?? 'GET')
            }
            if (e instanceof DOMException && e.name === 'AbortError') {
                throw new AbortError(path, opt.method ?? 'GET')
            }
            throw e
        }
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

