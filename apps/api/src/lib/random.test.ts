import assert from "node:assert/strict";
import { test } from "node:test";
import { randomDigits, randomFromAlphabet } from "./random.js";

/** Math.random is predictable (its state can be recovered from a few
 *  outputs), so OTPs and payment-link tokens must not depend on it at all.
 *  With Math.random pinned to a constant, such code would return the same
 *  value every time. */
function withPinnedMathRandom(fn: () => void): void {
  const original = Math.random;
  Math.random = () => 0;
  try {
    fn();
  } finally {
    Math.random = original;
  }
}

test("randomDigits does not depend on Math.random", () => {
  withPinnedMathRandom(() => {
    const codes = new Set(Array.from({ length: 20 }, () => randomDigits(6)));
    assert.ok(codes.size > 1, `20 OTP codes were all ${[...codes][0]}`);
  });
});

test("randomFromAlphabet does not depend on Math.random", () => {
  withPinnedMathRandom(() => {
    const tokens = new Set(Array.from({ length: 20 }, () => randomFromAlphabet("ABCDEFGH", 22)));
    assert.ok(tokens.size > 1, `20 tokens were all ${[...tokens][0]}`);
  });
});

test("randomDigits returns exactly n decimal digits, including leading zeros", () => {
  for (let i = 0; i < 200; i++) {
    assert.match(randomDigits(6), /^\d{6}$/);
  }
  assert.match(randomDigits(20), /^\d{20}$/);
});

test("randomFromAlphabet uses only the given alphabet and every symbol can appear", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const value = randomFromAlphabet("abc", 10);
    assert.match(value, /^[abc]{10}$/);
    for (const ch of value) seen.add(ch);
  }
  assert.deepEqual([...seen].sort(), ["a", "b", "c"]);
});
