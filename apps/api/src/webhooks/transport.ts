/**
 * The injectable HTTP send — `runDispatchPass` and everything it calls take
 * a `WebhookTransport` as an explicit parameter, never calling `fetch`
 * directly deep inside dispatch logic. Same "pass the effectful dependency
 * in" shape as `AcquirerSimulator`.
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

/**
 * @property timeoutMs Covers the whole exchange including reading the body.
 */
export interface WebhookTransportRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

export interface WebhookTransportResponse {
  /** null on a transport-level failure (timeout, DNS, connection refused,
   *  blocked address — never reached the receiver) */
  statusCode: number | null;
  /** "" on a transport-level failure; at most MAX_RESPONSE_BODY_BYTES otherwise */
  body: string;
  /** present iff statusCode is null */
  errorMessage?: string;
}

export type WebhookTransport = (req: WebhookTransportRequest) => Promise<WebhookTransportResponse>;

/** Receivers only need to answer with a status; the body is kept for display
 *  and diagnostics, so anything past this is dropped. */
const MAX_RESPONSE_BODY_BYTES = 64 * 1024;

/** Loopback, private, link-local (incl. cloud metadata 169.254.169.254),
 *  carrier-grade NAT, benchmarking, multicast and reserved ranges. A merchant
 *  webhook must never reach any of them: they are this deployment's own
 *  network, not the merchant's server. */
const NON_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, "ipv6");
}

/** True only for a globally routable unicast address. */
export function isPublicAddress(address: string): boolean {
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) reaches the IPv4 address it wraps.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPublicAddress(mapped[1] as string);

  const family = isIP(address);
  if (family === 4) return !NON_PUBLIC.check(address, "ipv4");
  if (family === 6) return !NON_PUBLIC.check(address, "ipv6");
  return false;
}

class BlockedAddressError extends Error {
  constructor(address: string) {
    super(`webhook target resolves to ${address}, which is not a public address`);
  }
}

/** DNS lookup used for the actual connection, so the address checked is the
 *  address connected to (no gap for DNS rebinding between check and use). */
const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err, "", 0);
    const blocked = addresses.find((a) => !isPublicAddress(a.address));
    if (blocked) return callback(new BlockedAddressError(blocked.address), "", 0);
    if (options.all) return callback(null, addresses);
    const first = addresses[0];
    if (!first) return callback(new Error(`no addresses for ${hostname}`), "", 0);
    return callback(null, first.address, first.family);
  });
};

export interface FetchTransportOptions {
  /** Allow loopback/private targets. Only for development, where a merchant's
   *  receiver runs on localhost; config.webhookAllowPrivateTargets. */
  allowPrivateNetwork: boolean;
}

/** Real transport, used by index.ts's production wiring. Never follows
 *  redirects: a 3xx is the receiver's answer, not an instruction to go
 *  elsewhere (an open redirect would otherwise bypass the address check). */
export function createFetchTransport(options: FetchTransportOptions): WebhookTransport {
  return (req: WebhookTransportRequest): Promise<WebhookTransportResponse> =>
    new Promise((resolve) => {
      const fail = (err: unknown): void =>
        resolve({ statusCode: null, body: "", errorMessage: err instanceof Error ? err.message : String(err) });

      let url: URL;
      try {
        url = new URL(req.url);
      } catch (err) {
        return fail(err);
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return fail(new Error(`unsupported protocol ${url.protocol}`));
      }

      // An IP literal never goes through `lookup`, so check it here.
      const literal = url.hostname.replace(/^\[|\]$/g, "");
      if (!options.allowPrivateNetwork && isIP(literal) && !isPublicAddress(literal)) {
        return fail(new BlockedAddressError(literal));
      }

      const send = url.protocol === "https:" ? httpsRequest : httpRequest;
      const outgoing = send(
        url,
        {
          method: "POST",
          headers: { ...req.headers, "content-length": Buffer.byteLength(req.body) },
          timeout: req.timeoutMs,
          ...(options.allowPrivateNetwork ? {} : { lookup: publicOnlyLookup }),
        },
        (response: IncomingMessage) => {
          const chunks: Buffer[] = [];
          let received = 0;
          response.on("data", (chunk: Buffer) => {
            if (received >= MAX_RESPONSE_BODY_BYTES) return;
            const take = chunk.subarray(0, MAX_RESPONSE_BODY_BYTES - received);
            chunks.push(take);
            received += take.length;
            if (received >= MAX_RESPONSE_BODY_BYTES) response.destroy();
          });
          const finish = (): void =>
            resolve({ statusCode: response.statusCode ?? null, body: Buffer.concat(chunks).toString("utf8") });
          response.on("end", finish);
          response.on("close", finish);
          response.on("error", finish);
        },
      );

      // Whole-exchange deadline; `timeout` above only covers socket idleness.
      const deadline = setTimeout(() => outgoing.destroy(new Error(`timed out after ${req.timeoutMs}ms`)), req.timeoutMs);
      outgoing.on("close", () => clearTimeout(deadline));
      outgoing.on("timeout", () => outgoing.destroy(new Error(`timed out after ${req.timeoutMs}ms`)));
      outgoing.on("error", fail);
      outgoing.end(req.body);
    });
}
