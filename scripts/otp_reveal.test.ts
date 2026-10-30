import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

// Runs ops/otp-reveal.sh against a fake docker that answers the two calls it makes: the psql lookup and the logs read.
const script = resolve(import.meta.dirname, "../ops/otp-reveal.sh");
const uid = "11111111-2222-3333-4444-555555555555";
const logLines = [
  `{"level":30,"merchantUserId":"${uid}","channel":"otp","code":"111111","msg":"otp code generated (allowlisted operator log)"}`,
  `{"level":30,"merchantUserId":"someone-else","channel":"otp","code":"999999","msg":"otp code generated (allowlisted operator log)"}`,
  `{"level":30,"merchantUserId":"${uid}","channel":"otp","msg":"otp code generated"}`,
  `{"level":30,"merchantUserId":"${uid}","channel":"otp","code":"222222","msg":"otp code generated (allowlisted operator log)"}`,
].join("\n");

function fakeDocker(dir: string, knownEmail: string): { bin: string; calls: string } {
  const callLog = join(dir, "calls.txt");
  const bin = join(dir, "docker");
  // Records every call, answers psql with the id only for the known email, and answers logs with the fixture.
  writeFileSync(
    bin,
    [
      "#!/usr/bin/env bash",
      `echo "$*" >> "${callLog}"`,
      'case "$*" in',
      `  *psql*) if [[ "$*" == *"${knownEmail}"* ]]; then echo "${uid}"; fi ;;`,
      `  *logs*) cat "${join(dir, "logs.txt")}" ;;`,
      "esac",
    ].join("\n"),
  );
  chmodSync(bin, 0o755);
  writeFileSync(join(dir, "logs.txt"), logLines);
  return { bin, calls: callLog };
}

function run(email: string, knownEmail = "new.merchant@example.test") {
  const dir = mkdtempSync(join(tmpdir(), "otp-reveal-"));
  try {
    const fake = fakeDocker(dir, knownEmail);
    const r = spawnSync("bash", [script, email], {
      env: { ...process.env, OTP_REVEAL_DOCKER: fake.bin },
      encoding: "utf8",
    });
    const calls = existsSync(fake.calls) ? readFileSync(fake.calls, "utf8") : "";
    return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr.trim(), calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("prints only the newest logged code for the registered user", () => {
  const r = run("new.merchant@example.test");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "222222");
});

test("the lookup is case-insensitive on the email", () => {
  const r = run("New.Merchant@Example.TEST");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "222222");
});

test("an unknown email fails without printing anything", () => {
  const r = run("nobody@example.test");
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
});

test("input that is not a plain address is refused before docker runs", () => {
  const r = run("x'; DROP TABLE merchant_users; --@example.test");
  assert.equal(r.status, 2);
  assert.equal(r.stdout, "");
  assert.equal(r.calls, "", "docker must not be called for a refused value");
});

test("a value with a space is refused rather than split", () => {
  const r = run("a@b.test extra");
  assert.equal(r.status, 2);
});
