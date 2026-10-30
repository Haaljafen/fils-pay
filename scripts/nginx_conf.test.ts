import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * ops/nginx.conf serves both dashboards. A rebuild changes the hashed file
 * names under /assets/, so a browser still holding the previous index.html
 * asks for scripts that no longer exist. See bug 79 in docs/README.md.
 */
const conf = readFileSync(new URL("../ops/nginx.conf", import.meta.url), "utf8");

function locationBlock(prefix: string): string {
  const match = conf.match(new RegExp(`location ${prefix} \\{([^}]*)\\}`));
  assert.ok(match, `ops/nginx.conf has no "location ${prefix}" block`);
  return match[1]!;
}

test("a missing file under /assets/ is a 404, not index.html with a 200", () => {
  assert.match(locationBlock("/assets/"), /try_files \$uri =404;/);
});

test("hashed assets may be cached for good, because a new build gets new names", () => {
  assert.match(locationBlock("/assets/"), /add_header Cache-Control "public, max-age=31536000, immutable"/);
});

test("index.html is revalidated on every load, so a rebuild reaches browsers at once", () => {
  const block = locationBlock("/");
  assert.match(block, /try_files \$uri \/index\.html;/);
  assert.match(block, /add_header Cache-Control "no-cache"/);
});
