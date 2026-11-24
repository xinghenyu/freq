import {
  HttpError,
  TimeoutError,
  AbortError,
  ParseError,
  HookError,
} from "./errorType";
import type {
  HttpConfig,
  Hooks,
  HttpResult,
  RequestHooksContext,
  RequestOptions,
  ResponseType,
} from "./types";
import {
  buildQuery,
  buildUrl,
  isPlainObject,
  mergeSignals,
} from "./utils";
import {
  mergeHooks,
  RequestErrorHooks,
  RequestHooks,
  ResponseErrorHooks,
  ResponseHooks,
} from "./hooks";
import { DEFAULT_METHOD, MAX_ERROR_BODY } from "./constants";

export async function readResponse<T>(
  res: Response,
  responseType: ResponseType | undefined,
  path: string,
  method: string,
): Promise<HttpResult<T>> {
  const meta = {
    ok: res.ok,
    code: res.status,
    url: res.url,
    headers: res.headers,
    redirected: res.redirected,
  };

  switch (responseType) {
    case "bytes":
      return { data: (await res.bytes()) as unknown as T, ...meta };
    case "arrayBuffer":
      return { data: (await res.arrayBuffer()) as unknown as T, ...meta };
    case "blob":
      return { data: (await res.blob()) as unknown as T, ...meta };
    case "text":
      return { data: (await res.text()) as unknown as T, ...meta };
    case "json": {
      const text = await res.text();
      if (text === "") {
        return { data: undefined as T, ...meta };
      }
      try {
        return { data: JSON.parse(text) as T, ...meta };
      } catch {
        throw new ParseError(
          path,
          method,
          text.slice(0, MAX_ERROR_BODY),
          res.headers,
        );
      }
    }
    case "stream":
      return { data: (res.body ?? null) as unknown as T, ...meta };
    case undefined: {
      const contentType = (
        res.headers.get("content-type") ?? ""
      )?.toLowerCase();

      if (contentType.includes("event-stream")) {
        return { data: (res.body ?? null) as unknown as T, ...meta };
      }

      if (contentType.includes("json")) {
        const text = await res.text();
        if (text === "") {
          return { data: undefined as T, ...meta };
        }
        try {
          return { data: JSON.parse(text) as T, ...meta };
        } catch {
          throw new ParseError(
            path,
            method,
            text.slice(0, MAX_ERROR_BODY),
            res.headers,
          );
        }
      }

      const isText =
        contentType?.startsWith("text") ||
        contentType.includes("xml") ||
        contentType.includes("html") ||
        contentType.includes("svg") ||
        contentType.includes("form-urlencoded") ||
        contentType === "";

      if (isText) {
        const text = await res.text();
        return {
          data: (text === "" ? undefined : text) as unknown as T,
          ...meta,
        };
      }

      return { data: (await res.blob()) as unknown as T, ...meta };
    }
    default:
      throw new ParseError(
        path,
        method,
        `unsupported responseType: ${String(responseType)}`,
        res.headers,
      );
  }
}

interface SendResult {
  response: Response;
  method: string;
  hooks: Hooks;
}

export async function requestResult(
  config: HttpConfig,
  path: string,
  options: RequestOptions | undefined,
  attempt: number,
  maxRetry: number,
  retryCodes: number[],
): Promise<SendResult> {
  const headers = new Headers(config.headers);
  if (options?.headers) {
    new Headers(options.headers).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  const {
    timeout,
    signal: userSignal,
    query,
    body: rawBody,
    ...opt
  } = options ?? {};
  const defaultSignal = config.signal;
  const timeoutNum = timeout ?? config.timeout;
  const timeoutSignal =
    timeoutNum && timeoutNum > 0 ? AbortSignal.timeout(timeoutNum) : undefined;
  const signal = mergeSignals([defaultSignal, userSignal, timeoutSignal]);

  let url = buildUrl(config.baseURL, path);
  if (query) {
    url = buildQuery(url, query);
  }

  let body: BodyInit | undefined;
  if (isPlainObject(rawBody) || Array.isArray(rawBody)) {
    body = JSON.stringify(rawBody);
    if (!headers.has("content-type"))
      headers.set("content-type", "application/json");
  } else {
    body = rawBody ?? undefined;
  }

  let finalMethod = opt.method ?? DEFAULT_METHOD;

  if (signal?.aborted) throw new AbortError(path, finalMethod);

  const reqHC: RequestHooksContext = {
    url,
    method: finalMethod,
    headers,
    body: typeof body === "string" ? body : undefined,
  };
  const hooks = mergeHooks(config.hooks, options?.hooks);
  await RequestHooks(reqHC, hooks);
  finalMethod = reqHC.method;
  const finalBody = reqHC.body !== undefined ? reqHC.body : body;
  const reqOpt = {
    ...opt,
    method: finalMethod,
    headers: reqHC.headers,
    ...(finalBody !== undefined ? { body: finalBody } : {}),
    ...(signal ? { signal } : {}),
  };

  let res: Response;
  try {
    res = await fetch(reqHC.url, reqOpt);
    return { response: res, method: finalMethod, hooks };
  } catch (e) {
    let err: unknown = e;
    if (e instanceof DOMException && e.name === "TimeoutError")
      err = new TimeoutError(timeoutNum!, path, finalMethod, e);
    if (e instanceof DOMException && e.name === "AbortError")
      err = new AbortError(path, finalMethod, e);

    const willThrow = attempt >= maxRetry || !shouldRetry(err, retryCodes);
    if (willThrow)
      await RequestErrorHooks(
        { error: err, url: reqHC.url, method: finalMethod },
        hooks,
      );
    throw err;
  }
}

export async function once<T = unknown>(
  config: HttpConfig,
  path: string,
  options: RequestOptions | undefined,
  attempt: number,
  maxRetry: number,
  retryCodes: number[],
): Promise<HttpResult<T>> {
  let res: Response | undefined;
  let method = DEFAULT_METHOD;
  let hooks: Hooks = {};
  try {
    const sent = await requestResult(
      config,
      path,
      options,
      attempt,
      maxRetry,
      retryCodes,
    );
    res = sent.response;
    method = sent.method;
    hooks = sent.hooks;

    if (!res.ok) {
      const text = await res.text();
      throw new HttpError(
        res.status,
        path,
        method,
        text.slice(0, MAX_ERROR_BODY),
        res.headers,
      );
    }

    const result = await readResponse<T>(
      res,
      options?.responseType ?? config.responseType,
      path,
      method,
    );
    await ResponseHooks({ result }, hooks);
    return result;
  } catch (e) {
    const willThrow = attempt >= maxRetry || !shouldRetry(e, retryCodes);
    if (willThrow && res && !(e instanceof HookError)) {
      await ResponseErrorHooks(
        { error: e, code: res.status, headers: res.headers, url: res.url },
        hooks,
      );
    }
    throw e;
  }
}

export function shouldRetry(e: unknown, codes: number[]): boolean {
  if (e instanceof HookError) return false;
  if (e instanceof AbortError) return false;
  if (e instanceof ParseError) return false;
  if (e instanceof TimeoutError) return true;
  if (e instanceof HttpError) return codes.includes(e.status);
  return false;
}

export function shouldReconnect(e: unknown, codes: number[]): boolean {
  if (e instanceof AbortError) return false;
  if (e instanceof HookError) return false;
  if (e instanceof ParseError) return false;
  if (e instanceof HttpError) return codes.includes(e.status);
  return true;
}
