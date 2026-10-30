import assert from "node:assert/strict";
import { validateHeaderValue } from "node:http";
import { test } from "node:test";
import { contentDisposition } from "./contentDisposition.js";

test("an Arabic filename produces a legal header that keeps the exact name", () => {
  const value = contentDisposition("inline", "سجل-تجاري.pdf");
  assert.doesNotThrow(() => validateHeaderValue("Content-Disposition", value));
  const encoded = /filename\*=UTF-8''(.+)$/.exec(value)?.[1];
  assert.equal(decodeURIComponent(encoded!), "سجل-تجاري.pdf");
});

test("a quote in the filename cannot add header parameters", () => {
  const value = contentDisposition("inline", 'a"; filename=evil.html');
  assert.doesNotThrow(() => validateHeaderValue("Content-Disposition", value));
  // Exactly the two parameters this function writes: the uploader's text stays
  // inside the one quoted string (which contains no quote), nothing is appended.
  assert.match(value, /^inline; filename="[^"]*"; filename\*=UTF-8''[^;"\s]+$/);
  assert.equal(value, `inline; filename="a_; filename=evil.html"; filename*=UTF-8''a%22%3B%20filename%3Devil.html`);
});

test("CR/LF and backslashes are neutralised in the fallback", () => {
  const value = contentDisposition("attachment", "a\r\nSet-Cookie: x=1\\.pdf");
  assert.doesNotThrow(() => validateHeaderValue("Content-Disposition", value));
  assert.ok(!/[\r\n]/.test(value));
});

test("a plain ASCII name is unchanged", () => {
  assert.equal(
    contentDisposition("inline", "cr-2026.pdf"),
    `inline; filename="cr-2026.pdf"; filename*=UTF-8''cr-2026.pdf`,
  );
});
