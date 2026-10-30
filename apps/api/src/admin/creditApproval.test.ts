import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { assertDistinctApprover } from "./creditApproval.js";
import { AppError } from "../lib/errors.js";

test("an operator cannot approve their own credit request", () => {
  const actor = { adminUserId: randomUUID(), displayName: "Dana Finance" };
  assert.throws(
    () => assertDistinctApprover(actor, actor),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, "self_approval_forbidden");
      return true;
    },
  );
});

test("two different operators satisfy two-person control", () => {
  assert.doesNotThrow(() =>
    assertDistinctApprover(
      { adminUserId: randomUUID(), displayName: "Dana Finance" },
      { adminUserId: randomUUID(), displayName: "Omar Treasury" },
    ),
  );
});

test("the same operator is refused even if their display name changed since requesting", () => {
  const adminUserId = randomUUID();
  assert.throws(
    () =>
      assertDistinctApprover(
        { adminUserId, displayName: "Dana Finance" },
        { adminUserId, displayName: "Dana Al-Finance" },
      ),
    (err: unknown) => err instanceof AppError && err.code === "self_approval_forbidden",
  );
});

test("two different operators who share a display name can approve each other", () => {
  assert.doesNotThrow(() =>
    assertDistinctApprover(
      { adminUserId: randomUUID(), displayName: "Sara Ahmed" },
      { adminUserId: randomUUID(), displayName: "Sara Ahmed" },
    ),
  );
});
