import { request } from "./client.js";

/** `POST /v1/admin/auth/register`. Creates a pending `support` admin; it cannot sign in until an existing admin activates it. */
export function registerAdmin(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<{ registered: true; role: string; status: string }> {
  return request("/v1/admin/auth/register", { method: "POST", body: JSON.stringify(input) });
}
