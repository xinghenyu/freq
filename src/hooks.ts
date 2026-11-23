import { HookError } from "./errorType";
import type {
  Hooks,
  RequestHooksContext,
  RequestErrorHooksContext,
  ResponseHooksContext,
  ResponseErrorHooksContext,
} from "./types";

export async function RequestHooks(brc: RequestHooksContext, hooks: Hooks) {
  try {
    for (const hook of hooks.Request ?? []) {
      await hook(brc);
    }
  } catch (e) {
    throw new HookError("Request", e);
  }
}

export async function ResponseHooks(brc: ResponseHooksContext, hooks: Hooks) {
  try {
    for (const hook of hooks.Response ?? []) {
      await hook(brc);
    }
  } catch (e) {
    throw new HookError("Response", e);
  }
}

export async function RequestErrorHooks(
  brc: RequestErrorHooksContext,
  hooks: Hooks,
) {
  for (const hook of hooks.RequestError ?? []) {
    try {
      await hook(brc);
    } catch {}
  }
}

export async function ResponseErrorHooks(
  brc: ResponseErrorHooksContext,
  hooks: Hooks,
) {
  for (const hook of hooks.ResponseError ?? []) {
    try {
      await hook(brc);
    } catch {}
  }
}

export function mergeHooks(base: Hooks | undefined, extra: Hooks | undefined): Hooks {
  return {
    Request: [...(base?.Request ?? []), ...(extra?.Request ?? [])],
    Response: [...(base?.Response ?? []), ...(extra?.Response ?? [])],
    RequestError: [
      ...(base?.RequestError ?? []),
      ...(extra?.RequestError ?? []),
    ],
    ResponseError: [
      ...(base?.ResponseError ?? []),
      ...(extra?.ResponseError ?? []),
    ],
  };
}
