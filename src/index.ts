import { HttpError, TimeoutError, AbortError } from './errorType'

export interface HttpConfig {
    baseUrl?: string
    headers?: HeadersInit
    timeout?: number
}

export interface RequestOptions {
    method?: string
    body?: BodyInit
    headers?: HeadersInit
    timeout?: number
    signal?: AbortSignal
}

export interface HttpResult<T> {
    data: T
    ok: boolean
    code: number
}


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

export function createClient(config: HttpConfig) {
    async function request<T = unknown>(path: string, options?: RequestOptions): Promise<HttpResult<T>> {
        const url = buildUrl(config.baseUrl, path)
        const headers = new Headers(config.headers)
        if (options?.headers) {
            new Headers(options.headers).forEach((value, key) => {
                headers.set(key, value)
            })
        }

        // AbortSignal
        const { timeout, signal: userSignal, ...opt } = options ?? {}
        const timeoutNum = timeout ?? config.timeout
        const timeoutSignal = timeoutNum && timeoutNum > 0 ? AbortSignal.timeout(timeoutNum) : undefined

        let signal: AbortSignal | undefined
        if (timeoutSignal && userSignal) {
            signal = AbortSignal.any([userSignal, timeoutSignal])
        } else {
            signal = timeoutSignal ?? userSignal
        }

        // send request
        try {
            const res = await fetch(url, { ...opt, headers, ...(signal ? { signal } : {}) })
            if (!res.ok) {
                const text = await res.text()
                throw new HttpError(
                    res.status,
                    path,
                    opt.method ?? 'GET',
                    text
                )
            }
            const data = await res.json()

            return {
                data: data as T,
                ok: res.ok,
                code: res.status
            }
        } catch (e) {
            if (e instanceof DOMException && e.name === 'TimeoutError') {
                throw new TimeoutError(timeoutNum!, path, opt.method ?? 'GET')
            }
            if (e instanceof DOMException && e.name === 'AbortError') {
                throw new AbortError(path, opt.method ?? 'GET')
            }
            throw e
        }
    }

    async function get<T = unknown>(path: string, query?: Record<string, string>): Promise<HttpResult<T>> {
        const q = query ? new URLSearchParams(query).toString() : ""
        const hasQues = path.includes("?")
        const qPath = q ? (hasQues ? (`${path}&${q}`) : (`${path}?${q}`)) : path
        return request<T>(qPath, { method: 'GET' })
    }

    return {
        request,
        get
    }
}

