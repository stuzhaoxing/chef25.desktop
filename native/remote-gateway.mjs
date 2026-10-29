import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { createInterface } from "node:readline";

// Configuration arrives through a pipe, never command arguments or a log file.
const lines = createInterface({ input: process.stdin });
lines.once("line", (line) => {
  const { targetPort, password, marker } = JSON.parse(line);
  const digest = (value) => createHash("sha256").update(value).digest();
  const expected = digest(
    "Basic " + Buffer.from(`chef25:${password}`).toString("base64"),
  );
  let failures = 0;
  let resetAt = Date.now() + 60_000;
  const server = http.createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Chef25-Gateway", marker);
    if (!req.url?.startsWith("/") || req.url.startsWith("//")) {
      res.writeHead(400).end();
      return;
    }
    if (!timingSafeEqual(digest(req.headers.authorization ?? ""), expected)) {
      if (Date.now() > resetAt) {
        failures = 0;
        resetAt = Date.now() + 60_000;
      }
      if (++failures > 20) {
        res.writeHead(429, { "Retry-After": "60" }).end();
        return;
      }
      res
        .writeHead(401, {
          "WWW-Authenticate": 'Basic realm="Chef25", charset="UTF-8"',
        })
        .end("Authentication required");
      return;
    }
    const headers = { ...req.headers };
    // Neither tunnel users nor the relay may impersonate an upstream client IP.
    for (const name of Object.keys(headers)) {
      if (
        name.startsWith("x-forwarded-") ||
        [
          "forwarded",
          "x-real-ip",
          "authorization",
          "proxy-authorization",
          "connection",
          "upgrade",
        ].includes(name)
      )
        delete headers[name];
    }
    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port: targetPort,
        path: req.url,
        method: req.method,
        headers,
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, {
          ...response.headers,
          "Cache-Control": "no-store",
          "X-Chef25-Gateway": marker,
        });
        response.pipe(res); // No buffering: preserve SSE and large uploads.
        response.on("error", () => res.destroy());
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.on("aborted", () => upstream.destroy());
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  });
  // No unauthenticated upgrade path. SillyTavern streams over HTTP/SSE.
  server.on("upgrade", (_req, socket) => socket.destroy());
  server.listen(0, "127.0.0.1", () =>
    process.stdout.write(
      JSON.stringify({ port: server.address().port }) + "\n",
    ),
  );
  server.on("error", () => process.exit(1));
});
// A lost launcher pipe also closes the gateway after a launcher crash.
lines.on("close", () => process.exit(0));
