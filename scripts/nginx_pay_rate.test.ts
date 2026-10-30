/**
 * The public pay endpoint is rate-limited per client IP at nginx, like login.
 * Without it, POST /v1/payment-links/:token/pay could be hammered unbounded.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const conf = readFileSync(new URL("../ops/nginx.conf", import.meta.url), "utf8");

test("the pay endpoint has its own request-rate zone", () => {
  assert.match(conf, /limit_req_zone \$binary_remote_addr zone=pay_req:\d+m rate=\d+r\/m;/);
});

test("POST /v1/payment-links/:token/pay is rate-limited by that zone", () => {
  const match = conf.match(/location ~ \^\/v1\/payment-links\/\[\^\/\]\+\/pay\$ \{([^}]*)\}/);
  assert.ok(match, "ops/nginx.conf has no location for the pay endpoint");
  assert.match(match[1]!, /limit_req zone=pay_req burst=\d+ nodelay;/);
  assert.match(match[1]!, /proxy_pass \$api_upstream;/);
});
