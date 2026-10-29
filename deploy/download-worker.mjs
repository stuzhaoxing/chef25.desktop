// Pages Functions gateway on Workers Free. At most two R2 reads per HTTP request;
// no public bucket endpoint, writes, listing, retries or origin fallback.
const IMMUTABLE = "public, max-age=31536000, immutable";
const failure = (status, headers = {}) =>
  new Response(null, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });

export function parseRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if ([first, last].some((n) => n !== null && !Number.isSafeInteger(n)))
    return null;
  const start = first === null ? Math.max(0, size - last) : first;
  const end =
    first === null || last === null ? size - 1 : Math.min(last, size - 1);
  if (start > end || start >= size) return null;
  return { offset: start, length: end - start + 1 };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Reject arbitrary and preview hostnames before accessing private R2.
    if (url.hostname !== env.DOWNLOAD_HOST && url.hostname !== env.PAGES_HOST)
      return failure(404);
    if (!["GET", "HEAD"].includes(request.method))
      return failure(405, { Allow: "GET, HEAD" });
    if (env.DOWNLOADS_ENABLED !== "true")
      return failure(503, { "Retry-After": "3600" });
    const key = url.pathname.slice(1);
    const manifest = /^downloads\/(latest|updater)\.json$/.test(key);
    if (
      !manifest &&
      !/^downloads\/v\d+\.\d+\.\d+\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(key)
    )
      return failure(404);
    try {
      const meta = await env.DOWNLOADS.head(key);
      if (!meta) return failure(404);
      const headers = new Headers();
      meta.writeHttpMetadata(headers);
      headers.set("Cache-Control", manifest ? "no-store" : IMMUTABLE);
      headers.set("ETag", meta.httpEtag);
      headers.set("Last-Modified", meta.uploaded.toUTCString());
      headers.set("Accept-Ranges", "bytes");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Content-Length", String(meta.size));
      if (request.method === "HEAD") return new Response(null, { headers });
      const ifNoneMatch = request.headers.get("If-None-Match");
      if (
        ifNoneMatch &&
        ifNoneMatch
          .split(",")
          .some(
            (value) =>
              value.trim() === "*" ||
              value.trim().replace(/^W\//, "") === meta.httpEtag,
          )
      ) {
        headers.delete("Content-Length");
        return new Response(null, { status: 304, headers });
      }
      let range;
      const rangeHeader = request.headers.get("Range");
      const ifRange = request.headers.get("If-Range");
      if (
        rangeHeader &&
        (!ifRange ||
          ifRange === meta.httpEtag ||
          ifRange === meta.uploaded.toUTCString())
      ) {
        range = parseRange(rangeHeader, meta.size);
        if (!range)
          return failure(416, { "Content-Range": `bytes */${meta.size}` });
      }
      const object = await env.DOWNLOADS.get(key, {
        onlyIf: { etagMatches: meta.etag },
        ...(range ? { range } : {}),
      });
      // An activation between HEAD and GET must not send bytes with stale metadata.
      if (!object || !("body" in object))
        return failure(503, { "Retry-After": "1" });
      if (range) {
        headers.set("Content-Length", String(range.length));
        headers.set(
          "Content-Range",
          `bytes ${range.offset}-${range.offset + range.length - 1}/${meta.size}`,
        );
      }
      return new Response(object.body, { status: range ? 206 : 200, headers });
    } catch {
      return failure(503, { "Retry-After": "60" });
    }
  },
};
