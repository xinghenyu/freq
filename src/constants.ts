/** 默认 HTTP 方法。 */
export const DEFAULT_METHOD = "GET";

/** 默认重试状态码。 */
export const DEFAULT_RETRY_CODES: number[] = [429, 500, 502, 503, 504, 508];

/** 默认退避：1s、2s、4s…（指数）。 */
export const DEFAULT_RETRY_DELAY = (attempt: number) =>
  1000 * 2 ** (attempt - 1);

/** 错误体/响应体截断长度，避免把整个大 body 塞进 Error。 */
export const MAX_ERROR_BODY = 500;
