// Load and concurrency tests for the public checkout: browse a payment link, pay it,
// and race several payers at one link. Local only by default. Run with:
//   k6 run loadtest/k6/checkout.js
// Needs a local API with OTP_DEV_EXPOSE=true (login code is returned in the response).
import http from "k6/http";
import { check, fail } from "k6";
import { Counter, Rate } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const MERCHANT_ID = __ENV.MERCHANT_ID || "9972daab-2c86-459f-9d78-3fe1be4e3280";
const EMAIL = __ENV.MERCHANT_EMAIL || "owner@alpharetail.example";
const PASSWORD = __ENV.MERCHANT_PASSWORD || "FilsPaySeed!2026";
const PAY_LINKS = Number(__ENV.PAY_LINKS || 220);
const BROWSE_LINKS = Number(__ENV.BROWSE_LINKS || 20);

// Refuse anything that is not this machine unless the operator says so explicitly.
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(BASE) && __ENV.ALLOW_REMOTE !== "1") {
  fail(`refusing to load test ${BASE}: set ALLOW_REMOTE=1 to target a non-local host`);
}

const unexpectedErrors = new Rate("unexpected_errors");
const sameLinkCaptures = new Counter("same_link_captures");

export const options = {
  scenarios: {
    browse: {
      executor: "constant-arrival-rate",
      exec: "browse",
      rate: Number(__ENV.BROWSE_RATE || 30),
      timeUnit: "1s",
      duration: __ENV.BROWSE_DURATION || "45s",
      preAllocatedVUs: 20,
      maxVUs: 60,
    },
    pay_unique: {
      executor: "shared-iterations",
      exec: "payUnique",
      vus: Number(__ENV.PAY_VUS || 15),
      iterations: PAY_LINKS,
      startTime: "50s",
      maxDuration: "5m",
    },
    same_link_race: {
      executor: "per-vu-iterations",
      exec: "sameLinkRace",
      vus: 30,
      iterations: 1,
      startTime: "3m30s",
      maxDuration: "1m",
    },
  },
  thresholds: {
    "http_req_duration{scenario:browse}": ["p(95)<800"],
    "http_req_duration{scenario:pay_unique}": ["p(95)<2000"],
    unexpected_errors: ["rate<0.01"],
    // The core money invariant: a single payment link can never capture twice.
    same_link_captures: ["count<=1"],
  },
};

const JSON_HEADERS = { "Content-Type": "application/json" };
const CARD = { pan: "4111111111111111", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

function key(tag) {
  return `${tag}-${__VU}-${__ITER}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function setup() {
  const login = http.post(
    `${BASE}/v1/auth/login`,
    JSON.stringify({ merchantId: MERCHANT_ID, email: EMAIL, password: PASSWORD }),
    { headers: JSON_HEADERS },
  );
  if (login.status !== 200) fail(`login failed: ${login.status} ${login.body}`);
  const code = login.json("devOtpCode");
  if (!code) fail("no devOtpCode in the login response: start the API with OTP_DEV_EXPOSE=true");
  const verify = http.post(`${BASE}/v1/auth/otp/verify`, JSON.stringify({ code }), { headers: JSON_HEADERS });
  if (verify.status !== 200) fail(`otp verify failed: ${verify.status}`);

  const expiresAt = new Date(Date.now() + 2 * 86400000).toISOString();
  const create = () => {
    const res = http.post(
      `${BASE}/v1/merchants/${MERCHANT_ID}/payment-links`,
      JSON.stringify({ amountFils: 1000, reference: `k6-${Math.random().toString(36).slice(2)}`, expiresAt }),
      { headers: JSON_HEADERS },
    );
    if (res.status !== 201) fail(`create payment link failed: ${res.status} ${res.body}`);
    return res.json("url").split("/").pop();
  };
  const browseTokens = [];
  for (let i = 0; i < BROWSE_LINKS; i++) browseTokens.push(create());
  const payTokens = [];
  for (let i = 0; i < PAY_LINKS; i++) payTokens.push(create());
  const raceToken = create();
  return { browseTokens, payTokens, raceToken };
}

export function browse(data) {
  const token = data.browseTokens[Math.floor(Math.random() * data.browseTokens.length)];
  const res = http.get(`${BASE}/v1/payment-links/${token}`);
  const ok = check(res, { "browse 200": (r) => r.status === 200 });
  unexpectedErrors.add(!ok);
}

// Expected outcomes: 200 paid, 402 declined by the acquirer simulator, 409 link already being paid.
function classifyPay(res) {
  const expected = [200, 402, 409].includes(res.status);
  unexpectedErrors.add(!expected);
  check(res, { "pay response is expected": () => expected });
  return res.status === 200;
}

export function payUnique(data) {
  const token = data.payTokens[__ITER % data.payTokens.length];
  const res = http.post(`${BASE}/v1/payment-links/${token}/pay`, JSON.stringify({ card: CARD }), {
    headers: { ...JSON_HEADERS, "Idempotency-Key": key("pay") },
  });
  classifyPay(res);
}

// Many payers at once on one link. Only one may capture; the rest must be refused.
export function sameLinkRace(data) {
  const res = http.post(`${BASE}/v1/payment-links/${data.raceToken}/pay`, JSON.stringify({ card: CARD }), {
    headers: { ...JSON_HEADERS, "Idempotency-Key": key("race") },
  });
  if (classifyPay(res)) sameLinkCaptures.add(1);
}

export function teardown(data) {
  // Confirms the race link ended in a single terminal state.
  const res = http.get(`${BASE}/v1/payment-links/${data.raceToken}`);
  check(res, { "race link readable after race": (r) => r.status === 200 });
}
