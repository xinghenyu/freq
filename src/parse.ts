export interface SSEMessage {
  event: string;
  data: string;
  id: string | undefined;
  retry: number | undefined;
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

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        buffer += decoder.decode();
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (let line of lines) {
        if (line.endsWith("\r")) line = line.slice(0, -1);

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
          continue;
        }

        if (line.startsWith(":")) continue;

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
          const n = Number(value);
          if (Number.isFinite(n) && n >= 0) retry = n;
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
    }
    reader.releaseLock();
  }
}
