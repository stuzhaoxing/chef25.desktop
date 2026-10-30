import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const source = await readFile(
  new URL("../native/launcher-lifetime.mjs", import.meta.url),
);
const preload = `data:text/javascript;base64,${source.toString("base64")}`;

async function canBind(port) {
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
    return true;
  } catch {
    return false;
  } finally {
    server.close();
  }
}

for (const ignoreSignal of [false, true]) {
  test(
    `launcher death releases the owned port (ignore SIGTERM: ${ignoreSignal})`,
    { timeout: 12000 },
    async (t) => {
      const fixture = `
      import net from 'node:net';
      import { Worker } from 'node:worker_threads';
      import { once } from 'node:events';
      // Workers inherit --import; their stdin must never stop the main process.
      const worker = new Worker('process.stdin.emit("end")', { eval: true });
      await once(worker, 'exit');
      ${ignoreSignal ? "process.on('SIGTERM', () => {});" : ""}
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({port: server.address().port, pid: process.pid})));
    `;
      // This intermediate launcher is deliberately killed without any cleanup.
      const parent = spawn(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
      import { spawn } from 'node:child_process';
      spawn(process.execPath, ${JSON.stringify(["--import", preload, "--input-type=module", "-e", fixture])}, { stdio: ['pipe', 'inherit', 'inherit'] });
      setInterval(() => {}, 1000);
    `,
        ],
        { stdio: ["ignore", "pipe", "inherit"] },
      );
      t.after(() => parent.kill("SIGKILL"));
      const lines = createInterface({ input: parent.stdout });
      t.after(() => lines.close());
      const [line] = await once(lines, "line");
      const { port, pid } = JSON.parse(line);
      t.after(() => {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* Already exited. */
        }
      });
      await delay(150);
      assert.equal(
        await canBind(port),
        false,
        "child must stay alive while launcher owns pipe",
      );
      const exited = once(parent, "exit");
      parent.kill("SIGKILL");
      await exited;
      const deadline = Date.now() + 8000;
      while (!(await canBind(port))) {
        assert.ok(
          Date.now() < deadline,
          "orphan must release its listening port",
        );
        await delay(50);
      }
    },
  );
}
