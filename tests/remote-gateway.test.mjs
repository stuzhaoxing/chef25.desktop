import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { createInterface } from "node:readline";

const script = await readFile(
  new URL("../native/remote-gateway.mjs", import.meta.url),
  "utf8",
);

test(
  "remote ingress authenticates before proxying, strips spoofed headers and preserves SSE",
  { timeout: 10000 },
  async (t) => {
    let received;
    let finishStream;
    const finish = new Promise((resolve) => {
      finishStream = resolve;
    });
    t.after(() => finishStream());
    const upstream = http
      .createServer((req, res) => {
        received = req.headers;
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write("data: first\n\n");
        void finish.then(() => res.end("data: last\n\n"));
      })
      .listen(0, "127.0.0.1");
    await once(upstream, "listening");
    t.after(() => {
      upstream.closeAllConnections();
      upstream.close();
    });
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    t.after(() => child.kill());
    const lines = createInterface({ input: child.stdout });
    const ready = once(lines, "line");
    child.stdin.write(
      JSON.stringify({
        targetPort: upstream.address().port,
        password: "test password 123456",
        marker: "test-marker",
      }) + "\n",
    );
    const [line] = await ready;
    const url = `http://127.0.0.1:${JSON.parse(line).port}`;
    const blocked = await fetch(url);
    assert.equal(blocked.status, 401);
    assert.equal(blocked.headers.get("x-chef25-gateway"), "test-marker");
    assert.equal(received, undefined);
    const response = await fetch(url, {
      headers: {
        Authorization:
          "Basic " +
          Buffer.from("chef25:test password 123456").toString("base64"),
        "X-Forwarded-For": "8.8.8.8",
        "X-Real-IP": "8.8.8.8",
        Forwarded: "for=8.8.8.8",
        "CF-Connecting-IP": "8.8.8.8",
        "True-Client-IP": "8.8.8.8",
      },
    });
    assert.equal(response.status, 200);
    assert.equal(received.authorization, undefined);
    assert.equal(received["x-forwarded-for"], undefined);
    assert.equal(received.forwarded, undefined);
    assert.equal(received["cf-connecting-ip"], undefined);
    assert.equal(received["true-client-ip"], undefined);
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    assert.equal(response.headers.get("cache-control"), "no-store");
    const reader = response.body.getReader();
    const first = await reader.read();
    assert.equal(new TextDecoder().decode(first.value), "data: first\n\n");
    finishStream(); // The first event must arrive while the response is still open.
    let rest = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      rest += new TextDecoder().decode(chunk.value);
    }
    assert.equal(rest, "data: last\n\n");
    const exited = once(child, "exit");
    child.stdin.end();
    await exited;
    await assert.rejects(fetch(url));
  },
);

test(
  "a configured gateway port conflict fails without changing ports or disturbing its owner",
  { timeout: 10000 },
  async (t) => {
    const owner = http
      .createServer((_req, res) => res.end("existing service"))
      .listen(0, "127.0.0.1");
    await once(owner, "listening");
    t.after(() => {
      owner.closeAllConnections();
      owner.close();
    });
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", script],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    t.after(() => child.kill());
    const lines = createInterface({ input: child.stdout });
    const ready = once(lines, "line");
    const exited = once(child, "exit");
    child.stdin.write(
      JSON.stringify({
        targetPort: 25252,
        listenPort: owner.address().port,
        password: "test password 123456",
        marker: "conflict-test",
      }) + "\n",
    );
    const [line] = await ready;
    assert.deepEqual(JSON.parse(line), { error: "listen_failed" });
    const [code] = await exited;
    assert.equal(code, 1);
    assert.equal(
      await (await fetch(`http://127.0.0.1:${owner.address().port}`)).text(),
      "existing service",
    );
  },
);
