import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type RecordedRequest = { method: string; url: string; headers: IncomingMessage["headers"]; body: string };

export type FakeReply =
  | { status: number; json?: unknown; text?: string }
  | { hang: true }
  | { destroy: true };

export type FakeApi = {
  url: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
};

/** A fake Task API on a free port. The handler decides each reply; every request is recorded. */
export async function startFakeApi(handler: (req: RecordedRequest) => FakeReply): Promise<FakeApi> {
  const requests: RecordedRequest[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const rec: RecordedRequest = {
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      requests.push(rec);
      const reply = handler(rec);
      if ("hang" in reply) return;
      if ("destroy" in reply) {
        req.socket.destroy();
        return;
      }
      if (reply.text !== undefined) {
        res.writeHead(reply.status, { "content-type": "text/plain" });
        res.end(reply.text);
        return;
      }
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(reply.json === undefined ? "" : JSON.stringify(reply.json));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A URL on which nothing listens (connection refused). */
export async function deadUrl(): Promise<string> {
  const api = await startFakeApi(() => ({ status: 200 }));
  const url = api.url;
  await api.close();
  return url;
}
