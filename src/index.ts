import { AbortError, TimeoutError } from "./errorType";
export {
  HttpError,
  TimeoutError,
  AbortError,
  ParseError,
  HookError,
} from "./errorType";

import { parseSSE, type SSEMessage } from "./parse";
export { parseSSE, type SSEMessage };

import { once, requestResult, shouldReconnect, shouldRetry } from "./core";
export { readResponse } from "./core";

import { mergeSignals, sleep } from "./utils";
export { buildQuery, buildUrl, isAbsoluteUrl } from "./utils";

import {
  DEFAULT_METHOD,
  DEFAULT_RETRY_CODES,
  DEFAULT_RETRY_DELAY,
} from "./constants";

import type {
  DelOptions,
  GetOptions,
  HttpConfig,
  HttpResult,
  PostOptions,
  PutOptions,
  RequestOptions,
  SSEOptions,
} from "./types";

export type {
  Hooks,
  HttpConfig,
  HttpResult,
  RequestErrorHook,
  RequestErrorHooksContext,
  RequestHook,
  RequestHooksContext,
  RequestOptions,
  ResponseErrorHook,
  ResponseErrorHooksContext,
  ResponseHook,
  ResponseHooksContext,
  ResponseType,
  SSEReconnect,
  SSEOptions,
} from "./types";

export function createClient(config: HttpConfig) {
  async function runWithRetry<R>(
    path: string,
    options: RequestOptions | undefined,
    run: (attempt: number, retry: number, retryCodes: number[]) => Promise<R>,
  ): Promise<R> {
    const retry = options?.retry ?? config.retry ?? 0;
    if (!Number.isInteger(retry) || retry < 0) {
      throw new Error(`retry must be a non-negative integer, got ${retry}`);
    }
    const retryCodes =
      options?.retryCodes ?? config.retryCodes ?? DEFAULT_RETRY_CODES;
    const retryDelay =
      options?.retryDelay ?? config.retryDelay ?? DEFAULT_RETRY_DELAY;

    let lastError: unknown;

    for (let attempt = 0; attempt <= retry; attempt++) {
      try {
        return await run(attempt, retry, retryCodes);
      } catch (e) {
        lastError = e;
        if (attempt >= retry || !shouldRetry(e, retryCodes)) throw e;

        const delay =
          typeof retryDelay === "function"
            ? await retryDelay(attempt + 1)
            : retryDelay;
        try {
          await sleep(delay, mergeSignals([config.signal, options?.signal]));
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") {
            throw new AbortError(path, options?.method ?? DEFAULT_METHOD, e);
          }
          throw e;
        }
      }
    }
    throw lastError;
  }

  async function request<T = unknown>(
    path: string,
    options?: RequestOptions,
  ): Promise<HttpResult<T>> {
    return runWithRetry(path, options, (attempt, retry, retryCodes) =>
      once<T>(config, path, options, attempt, retry, retryCodes),
    );
  }

  async function get<T = unknown>(
    path: string,
    options?: GetOptions,
  ): Promise<HttpResult<T>> {
    return request<T>(path, { ...options, method: DEFAULT_METHOD });
  }

  async function post<T = unknown>(
    path: string,
    options?: PostOptions,
  ): Promise<HttpResult<T>> {
    return request<T>(path, { ...options, method: "POST" });
  }

  async function put<T = unknown>(
    path: string,
    options?: PutOptions,
  ): Promise<HttpResult<T>> {
    return request<T>(path, { ...options, method: "PUT" });
  }

  async function del<T = unknown>(
    path: string,
    options?: DelOptions,
  ): Promise<HttpResult<T>> {
    return request<T>(path, { ...options, method: "DELETE" });
  }

  async function raw(
    path: string,
    options?: RequestOptions,
  ): Promise<Response> {
    return runWithRetry<Response>(
      path,
      options,
      async (attempt, retry, retryCodes) => {
        const { response } = await requestResult(
          config,
          path,
          options,
          attempt,
          retry,
          retryCodes,
        );
        return response;
      },
    );
  }

  async function* sse(
    path: string,
    options?: SSEOptions,
  ): AsyncGenerator<SSEMessage, void, undefined> {
    const {
      reconnect: optReconnect,
      headers: rawHeaders,
      ...requestOptions
    } = options ?? ({} as SSEOptions);

    const reconnect = optReconnect ?? config.sseReconnect;
    const maxRetries = reconnect?.retry ?? 0;
    const codes =
      reconnect?.codes ??
      requestOptions.retryCodes ??
      config.retryCodes ??
      DEFAULT_RETRY_CODES;
    const method = requestOptions.method ?? DEFAULT_METHOD;
    const signal = mergeSignals([config.signal, requestOptions.signal]);

    let attempt = 0;
    let lastId: string | undefined;
    let serverDelay: number | undefined;

    for (;;) {
      const headers = new Headers(rawHeaders);
      if (!headers.has("accept")) headers.set("accept", "text/event-stream");
      if (lastId !== undefined) headers.set("Last-Event-ID", lastId);

      let gotEvent = false;

      try {
        const reqOptions: RequestOptions = {
          ...requestOptions,
          headers,
          responseType: "stream",
          timeout: requestOptions.timeout ?? 0,
        };
        if (reconnect) reqOptions.retry = 0;

        const { data } = await request<ReadableStream<Uint8Array> | null>(
          path,
          reqOptions,
        );

        if (!data) return;

        for await (const ev of parseSSE(data)) {
          gotEvent = true;
          if (ev.id !== undefined) lastId = ev.id;
          if (ev.retry !== undefined) serverDelay = ev.retry;
          yield ev;
        }

        return;
      } catch (raw) {
        // 流读取阶段抛的 DOMException 不会被 requestResult 转换（那层只到响应头）
        let e: unknown = raw;
        if (raw instanceof DOMException) {
          if (raw.name === "AbortError") {
            e = new AbortError(path, method, raw);
          } else if (raw.name === "TimeoutError") {
            e = new TimeoutError(requestOptions.timeout ?? 0, path, method, raw);
          }
        }

        if (gotEvent) attempt = 0;

        if (!reconnect || attempt >= maxRetries) throw e;
        if (!shouldReconnect(e, codes)) throw e;

        attempt++;

        const delaySource =
          reconnect.delay ?? requestOptions.retryDelay ?? config.retryDelay;
        const userDelay =
          typeof delaySource === "function"
            ? await delaySource(attempt)
            : (delaySource ?? DEFAULT_RETRY_DELAY(attempt));

        const wait = Math.max(userDelay, serverDelay ?? 0);

        try {
          await sleep(wait, signal);
        } catch (abortReason) {
          throw new AbortError(path, method, abortReason);
        }
      }
    }
  }

  return {
    request,
    get,
    post,
    put,
    del,
    raw,
    sse,
  };
}
