import assert from "node:assert/strict";
import test from "node:test";
import worker from "../deploy/download-worker.mjs";

function fixture() {
  const calls = [];
  const meta = {
    size: 9,
    etag: "v1",
    httpEtag: '"v1"',
    uploaded: new Date("2026-01-01T00:00:00Z"),
    writeHttpMetadata(headers) {
      headers.set("Content-Type", "application/octet-stream");
    },
  };
  const env = {
    DOWNLOAD_HOST: "download.chef25.com",
    DOWNLOADS_ENABLED: "true",
    DOWNLOADS: {
      async head(key) {
        calls.push(["head", key]);
        return meta;
      },
      async get(key, options) {
        calls.push(["get", key, options]);
        const data = new TextEncoder().encode("installer");
        const range = options.range;
        return {
          ...meta,
          body: range
            ? data.slice(range.offset, range.offset + range.length)
            : data,
        };
      },
    },
  };
  return {
    env,
    calls,
    request: (path = "/downloads/v0.2.0/app.exe", init) =>
      worker.fetch(
        new Request("https://download.chef25.com" + path, init),
        env,
      ),
  };
}

test("full GET streams correct headers and at most two R2 reads", async () => {
  const f = fixture();
  const response = await f.request();
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "installer");
  assert.equal(response.headers.get("Content-Length"), "9");
  assert.match(response.headers.get("Cache-Control"), /immutable/);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[1][2].onlyIf, { etagMatches: "v1" });
});

test("HEAD reads only metadata and current manifests are never cached", async () => {
  const f = fixture();
  const response = await f.request("/downloads/latest.json", {
    method: "HEAD",
  });
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(f.calls.length, 1);
});

test("single, suffix and open ranges support download resumption", async () => {
  for (const [range, expected, contentRange] of [
    ["bytes=0-0", "i", "bytes 0-0/9"],
    ["bytes=-3", "ler", "bytes 6-8/9"],
    ["bytes=7-", "er", "bytes 7-8/9"],
    ["bytes=7-999", "er", "bytes 7-8/9"],
  ]) {
    const f = fixture();
    const response = await f.request(undefined, { headers: { Range: range } });
    assert.equal(response.status, 206);
    assert.equal(await response.text(), expected);
    assert.equal(response.headers.get("Content-Range"), contentRange);
    assert.equal(f.calls.length, 2);
  }
});

test("invalid or multiple ranges never trigger extra reads", async () => {
  for (const range of [
    "bytes=99-",
    "bytes=-0",
    "bytes=3-1",
    "bytes=0-1,3-4",
    "bytes=-",
    "bytes=9007199254740999-",
  ]) {
    const f = fixture();
    const response = await f.request(undefined, { headers: { Range: range } });
    assert.equal(response.status, 416);
    assert.equal(f.calls.length, 1);
  }
});

test("changed If-Range yields full bytes; matching ETag yields 304", async () => {
  const f = fixture();
  const response = await f.request(undefined, {
    headers: { Range: "bytes=1-", "If-Range": '"old"' },
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "installer");
  const g = fixture();
  const cached = await g.request(undefined, {
    headers: { "If-None-Match": 'W/"v1"' },
  });
  assert.equal(cached.status, 304);
  assert.equal(g.calls.length, 1);
});

test("lock, unknown paths and disabled downloads do not reach R2", async () => {
  for (const path of [
    "/downloads/.publish-lock",
    "/",
    "/other",
    "/downloads/v0.1.0/a%2Fb",
    "/downloads/v0.1.0/.secret",
  ]) {
    const f = fixture();
    assert.equal((await f.request(path)).status, 404);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  f.env.DOWNLOADS_ENABLED = "false";
  assert.equal((await f.request()).status, 503);
  assert.equal(f.calls.length, 0);
  f.env.DOWNLOADS_ENABLED = "true";
  assert.equal((await f.request(undefined, { method: "POST" })).status, 405);
  assert.equal(f.calls.length, 0);
  assert.equal(
    (
      await worker.fetch(
        new Request("https://other.example/downloads/latest.json"),
        f.env,
      )
    ).status,
    404,
  );
});

test("missing files, storage errors and concurrent activation fail closed without retry", async () => {
  const f = fixture();
  f.env.DOWNLOADS.head = async () => null;
  assert.equal((await f.request()).status, 404);
  const g = fixture();
  g.env.DOWNLOADS.get = async () => ({ etag: "changed" });
  assert.equal((await g.request()).status, 503);
  const h = fixture();
  h.env.DOWNLOADS.get = async () => {
    throw new Error("private internal detail");
  };
  const response = await h.request();
  assert.equal(response.status, 503);
  assert.equal(await response.text(), "");
});

test("Pages production hostname is allowed; previews cannot read R2", async () => {
  const f = fixture();
  f.env.PAGES_HOST = "chef25-downloads.pages.dev";
  const response = await worker.fetch(
    new Request("https://chef25-downloads.pages.dev/downloads/v0.1.0/app.exe"),
    f.env,
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "installer");
  for (const host of [
    "preview.chef25-downloads.pages.dev",
    "chef25-downloads.pages.dev.evil.example",
  ]) {
    const before = f.calls.length;
    assert.equal(
      (
        await worker.fetch(
          new Request(`https://${host}/downloads/v0.1.0/app.exe`),
          f.env,
        )
      ).status,
      404,
    );
    assert.equal(f.calls.length, before);
  }
  f.env.DOWNLOADS_ENABLED = "false";
  const before = f.calls.length;
  assert.equal(
    (
      await worker.fetch(
        new Request(
          "https://chef25-downloads.pages.dev/downloads/v0.1.0/app.exe",
        ),
        f.env,
      )
    ).status,
    503,
  );
  assert.equal(f.calls.length, before);
});
