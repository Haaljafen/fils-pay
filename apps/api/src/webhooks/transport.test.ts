/**
 * The real webhook transport against local HTTP servers. No database.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createFetchTransport, isPublicAddress } from "./transport.js";

interface TestServer {
  url: string;
  hits: () => number;
  close: () => Promise<void>;
}

async function startServer(handler: (res: import("node:http").ServerResponse) => void): Promise<TestServer> {
  let hits = 0;
  const server: Server = createServer((req, res) => {
    hits += 1;
    req.resume();
    req.on("end", () => handler(res));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/hook`,
    hits: () => hits,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const send = { headers: { "content-type": "application/json" }, body: "{}", timeoutMs: 2_000 };

test("private addresses are refused before any connection is made", async () => {
  const receiver = await startServer((res) => res.end("ok"));
  try {
    const transport = createFetchTransport({ allowPrivateNetwork: false });
    const viaIp = await transport({ ...send, url: receiver.url });
    const viaName = await transport({ ...send, url: receiver.url.replace("127.0.0.1", "localhost") });
    assert.equal(viaIp.statusCode, null);
    assert.equal(viaName.statusCode, null);
    assert.match(viaIp.errorMessage ?? "", /not a public address/);
    assert.equal(receiver.hits(), 0, "the internal service must never receive the request");
  } finally {
    await receiver.close();
  }
});

test("redirects are returned as-is, never followed", async () => {
  const target = await startServer((res) => res.end("internal secrets"));
  const redirector = await startServer((res) => {
    res.writeHead(302, { location: target.url });
    res.end();
  });
  try {
    const transport = createFetchTransport({ allowPrivateNetwork: true });
    const result = await transport({ ...send, url: redirector.url });
    assert.equal(result.statusCode, 302);
    assert.equal(target.hits(), 0, "the redirect target must never be requested");
  } finally {
    await redirector.close();
    await target.close();
  }
});

test("the response body is truncated instead of read without limit", async () => {
  const receiver = await startServer((res) => res.end("x".repeat(1_000_000)));
  try {
    const transport = createFetchTransport({ allowPrivateNetwork: true });
    const result = await transport({ ...send, url: receiver.url });
    assert.equal(result.statusCode, 200);
    assert.ok(result.body.length <= 64 * 1024, `body was ${result.body.length} chars`);
  } finally {
    await receiver.close();
  }
});

test("with private targets allowed (development), a local receiver works", async () => {
  const receiver = await startServer((res) => res.end("ok"));
  try {
    const result = await createFetchTransport({ allowPrivateNetwork: true })({ ...send, url: receiver.url });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body, "ok");
  } finally {
    await receiver.close();
  }
});

test("isPublicAddress classifies internal and public ranges", () => {
  for (const internal of [
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fd00::1", "fe80::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1",
  ]) {
    assert.equal(isPublicAddress(internal), false, internal);
  }
  for (const external of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(isPublicAddress(external), true, external);
  }
});
