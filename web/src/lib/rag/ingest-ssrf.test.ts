import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fetchRemoteDocument, isPrivateIp, assertPublicUrl } from "./ingest.server.ts";

type FetchCall = string;
let calls: FetchCall[] = [];
let handler: (url: string) => Response = () => new Response("plain body content long enough to matter", { status: 200, headers: { "content-type": "text/plain" } });
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  handler = () => new Response("plain body content long enough to matter", { status: 200, headers: { "content-type": "text/plain" } });
  globalThis.fetch = (async (url: any) => {
    calls.push(String(url));
    return handler(String(url));
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("isPrivateIp", () => {
  it("flags loopback, RFC1918, link-local, CGNAT and metadata ranges", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.3.4", "172.31.255.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0"]) {
      assert.equal(isPrivateIp(ip), true, ip);
    }
  });

  it("flags IPv6 loopback, link-local, unique-local and v4-mapped private addresses", () => {
    for (const ip of ["::1", "::", "fe80::1", "fc00::1234", "fd00::abcd", "::ffff:127.0.0.1", "::ffff:169.254.169.254"]) {
      assert.equal(isPrivateIp(ip), true, ip);
    }
  });

  it("allows ordinary public addresses", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111", "172.15.0.1", "172.32.0.1", "100.63.0.1", "192.167.1.1"]) {
      assert.equal(isPrivateIp(ip), false, ip);
    }
  });
});

describe("assertPublicUrl", () => {
  it("rejects non-http schemes", async () => {
    await assert.rejects(assertPublicUrl("file:///etc/passwd"), /http\(s\) URL/);
    await assert.rejects(assertPublicUrl("ftp://example.com/x"), /http\(s\) URL/);
  });

  it("rejects localhost-style hostnames", async () => {
    await assert.rejects(assertPublicUrl("http://localhost:3000/admin"), /private or local address/);
    await assert.rejects(assertPublicUrl("http://service.internal/secret"), /private or local address/);
  });

  it("rejects private IP literals without any fetch", async () => {
    await assert.rejects(assertPublicUrl("http://169.254.169.254/latest/meta-data"), /private or local address/);
    await assert.rejects(assertPublicUrl("http://[::1]/x"), /private or local address/);
  });

  it("rejects hostnames that resolve to a private address", async (t) => {
    // 127.0.0.1.sslip.io is a public DNS wildcard for 127.0.0.1; skip when DNS is unavailable.
    const { lookup } = await import("node:dns/promises");
    try {
      await lookup("127.0.0.1.sslip.io");
    } catch {
      t.skip("external DNS unavailable");
      return;
    }
    await assert.rejects(assertPublicUrl("http://127.0.0.1.sslip.io/"), /private or local address/);
  });
});

describe("remote URL fetching (SSRF guard)", () => {
  it("never issues a request for private addresses", async () => {
    await assert.rejects(fetchRemoteDocument("http://169.254.169.254/latest/meta-data"), /private or local address/);
    await assert.rejects(fetchRemoteDocument("http://192.168.0.1/router-admin"), /private or local address/);
    assert.deepEqual(calls, []);
  });

  it("fetches public URLs normally", async () => {
    const doc = await fetchRemoteDocument("http://93.184.216.34/guide.txt");
    assert.equal(doc.body, "plain body content long enough to matter");
    assert.equal(calls.length, 1);
  });

  it("rejects redirects that point at private addresses", async () => {
    handler = (url) => {
      if (url.includes("93.184.216.34")) {
        return new Response(null, { status: 302, headers: { location: "http://127.0.0.1:8080/internal" } });
      }
      return new Response("internal data", { status: 200 });
    };
    await assert.rejects(fetchRemoteDocument("http://93.184.216.34/guide.txt"), /private or local address/);
    assert.deepEqual(calls, ["http://93.184.216.34/guide.txt"]);
  });

  it("follows public redirects", async () => {
    handler = (url) => {
      if (url.includes("93.184.216.34")) {
        return new Response(null, { status: 301, headers: { location: "http://8.8.8.8/guide.txt" } });
      }
      return new Response("redirected body content long enough to matter", { status: 200, headers: { "content-type": "text/plain" } });
    };
    const doc = await fetchRemoteDocument("http://93.184.216.34/guide.txt");
    assert.equal(doc.body, "redirected body content long enough to matter");
    assert.equal(calls.length, 2);
  });

  it("caps redirect chains", async () => {
    handler = () => new Response(null, { status: 302, headers: { location: "http://93.184.216.34/next" } });
    await assert.rejects(fetchRemoteDocument("http://93.184.216.34/start"), /Too many redirects/);
    assert.ok(calls.length <= 5);
  });
});
