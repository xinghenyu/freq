export class HttpError extends Error {
  readonly status: number;
  readonly path: string;
  readonly method: string;
  readonly body: string;
  readonly headers: Headers;

  constructor(
    status: number,
    path: string,
    method: string,
    body: string,
    headers: Headers,
  ) {
    super(`HTTP ${status} ${method} ${path}`);
    this.name = "HttpError";
    this.status = status;
    this.path = path;
    this.method = method;
    this.body = body;
    this.headers = headers;
  }
}

export class TimeoutError extends Error {
  readonly timeout: number | undefined;
  readonly path: string;
  readonly method: string;

  constructor(
    timeout: number | undefined,
    path: string,
    method: string,
    cause?: unknown,
  ) {
    super(
      timeout ? `Timeout ${timeout}ms ${method} ${path}` : `Timeout ${method} ${path}`,
      cause === undefined ? undefined : { cause },
    );
    this.name = "TimeoutError";
    this.timeout = timeout;
    this.path = path;
    this.method = method;
  }
}

export class AbortError extends Error {
  readonly path: string;
  readonly method: string;

  constructor(path: string, method: string, cause?: unknown) {
    super(
      `Aborted ${method} ${path}`,
      cause === undefined ? undefined : { cause },
    );
    this.name = "AbortError";
    this.path = path;
    this.method = method;
  }
}

export class ParseError extends Error {
  readonly path: string;
  readonly method: string;
  readonly body: string;
  readonly headers: Headers;

  constructor(path: string, method: string, body: string, headers: Headers) {
    super(`Parse error ${method} ${path} ${body}`);
    this.name = "ParseError";
    this.path = path;
    this.method = method;
    this.body = body;
    this.headers = headers;
  }
}

export class HookError extends Error {
  readonly hook: string;

  constructor(hook: string, cause: unknown) {
    super(
      `hook "${hook}" failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = "HookError";
    this.hook = hook;
  }
}
