export interface HttpConfig {
  baseUrl?: string;
  headers?: HeadersInit;
  timeout?: number;
  signal?: AbortSignal;
  retry?: number;
  retryDelay?: number | ((attempt: number) => number | Promise<number>);
  retryCodes?: number[];
  hooks?: Hooks;
  sseReconnect?: SSEReconnect;
  responseType?: ResponseType;
}

export interface RequestHooksContext {
  url: string;
  method: string;
  headers: Headers;
  body: string | undefined;
}

export interface ResponseHooksContext {
  result: HttpResult<unknown>;
}

export interface RequestErrorHooksContext {
  error: unknown;
  url: string;
  method: string;
}

export interface ResponseErrorHooksContext {
  error: unknown;
  code: number;
  headers: Headers;
  url: string;
}

export type RequestHook = (ctx: RequestHooksContext) => void | Promise<void>;
export type ResponseHook = (ctx: ResponseHooksContext) => void | Promise<void>;
export type RequestErrorHook = (
  ctx: RequestErrorHooksContext,
) => void | Promise<void>;
export type ResponseErrorHook = (
  ctx: ResponseErrorHooksContext,
) => void | Promise<void>;

export interface Hooks {
  Request?: RequestHook[];
  Response?: ResponseHook[];
  RequestError?: RequestErrorHook[];
  ResponseError?: ResponseErrorHook[];
}

export interface RequestOptions extends Omit<
  RequestInit,
  "body" | "headers" | "method" | "signal"
> {
  method?: string;
  body?: BodyInit | Record<string, unknown> | unknown[] | null;
  headers?: HeadersInit;
  timeout?: number;
  signal?: AbortSignal;
  query?: Record<string, string>;
  responseType?: ResponseType;
  retry?: number;
  retryDelay?: number | ((attempt: number) => number | Promise<number>);
  retryCodes?: number[];
  hooks?: Hooks;
}

export interface SSEReconnect {
  retry?: number;
  delay?: number | ((attempt: number) => number | Promise<number>);
  codes?: number[];
}

export interface SSEOptions extends Omit<RequestOptions, "responseType"> {
  reconnect?: SSEReconnect;
}

type GetOptions = Omit<RequestOptions, "method" | "body">;
type PostOptions = Omit<RequestOptions, "method">;
type PutOptions = Omit<RequestOptions, "method">;
type DelOptions = Omit<RequestOptions, "method">;

export interface HttpResult<T> {
  data: T;
  ok: boolean;
  code: number;
  url: string;
  headers: Headers;
  redirected: boolean;
}

export type ResponseType =
  | "json"
  | "text"
  | "blob"
  | "arrayBuffer"
  | "bytes"
  | "stream";

export type { GetOptions, PostOptions, PutOptions, DelOptions };
