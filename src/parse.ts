export interface SSEMessage {
  event: string;
  data: string;
  id: string | undefined;
  retry: number | undefined;
}

/**
 * 按 WHATWG 规范把一段文本切成"完整行"。
 * 行终止符有三种：`\r\n`、`\n`、单个 `\r`。
 *
 * 末尾若只剩一个孤立的 `\r`，它可能是下一块 `\n` 的前半（即 `\r\n` 被
 * 网络切断），因此非 EOF 时留在 rest 里等下一块；EOF 时它就是一个完整的
 * 行终止符，必须就地切出，否则最后一行会丢。
 */
function splitLines(
  buffer: string,
  eof: boolean,
): { lines: string[]; rest: string } {
  const lines: string[] = [];
  let start = 0;
  let i = 0;

  while (i < buffer.length) {
    const ch = buffer.charCodeAt(i);

    if (ch === 0x0a) {
      lines.push(buffer.slice(start, i));
      i += 1;
      start = i;
      continue;
    }

    if (ch === 0x0d) {
      if (i + 1 < buffer.length) {
        lines.push(buffer.slice(start, i));
        i += buffer.charCodeAt(i + 1) === 0x0a ? 2 : 1;
        start = i;
      } else if (eof) {
        lines.push(buffer.slice(start, i));
        i += 1;
        start = i;
      } else {
        break;
      }
      continue;
    }

    i += 1;
  }

  return { lines, rest: buffer.slice(start) };
}

export async function* parseSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SSEMessage> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  let lastId: string | undefined;
  let retry: number | undefined;

  let event = "";
  let dataLines: string[] = [];

  function* processLine(line: string): Generator<SSEMessage> {
    if (line === "") {
      if (dataLines.length > 0) {
        yield {
          event: event || "message",
          data: dataLines.join("\n"),
          id: lastId,
          retry,
        };
        dataLines = [];
      }
      event = "";
      return;
    }

    if (line.startsWith(":")) return;

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "data") {
      dataLines.push(value);
    } else if (field === "event") {
      event = value;
    } else if (field === "id") {
      if (!value.includes("\u0000")) lastId = value;
    } else if (field === "retry") {
      if (/^\d+$/.test(value)) retry = Number(value);
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        buffer += decoder.decode();
        const { lines } = splitLines(buffer, true);
        for (const line of lines) yield* processLine(line);
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      const { lines, rest } = splitLines(buffer, false);
      buffer = rest;
      for (const line of lines) yield* processLine(line);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {}
    reader.releaseLock();
  }
}
