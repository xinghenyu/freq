export class HttpError extends Error {
    readonly status: number
    readonly path: string
    readonly method: string
    readonly body: string

    constructor(status: number, path: string, method: string, body: string) {
        super(`HTTP ${status} ${method} ${path}`)
        this.name = 'HttpError'
        this.status = status
        this.path = path
        this.method = method
        this.body = body
    }
}

export class TimeoutError extends Error {
    readonly timeout: number
    readonly path: string
    readonly method: string

    constructor(timeout: number, path: string, method: string) {
        super(`Timeout ${timeout}ms ${method} ${path}`)
        this.name = 'TimeoutError'
        this.timeout = timeout
        this.path = path
        this.method = method
    }
}

export class AbortError extends Error {
    readonly path: string
    readonly method: string

    constructor(path: string, method: string) {
        super(`Aborted ${method} ${path}`)
        this.name = 'AbortError'
        this.path = path
        this.method = method
    }
}

export class ParseError extends Error {
    readonly path: string
    readonly method: string
    readonly body: string

    constructor(path: string, method: string, body: string) {
        super(`Parse error ${method} ${path} ${body}`)
        this.name = 'ParseError'
        this.path = path
        this.method = method
        this.body = body
    }
}
