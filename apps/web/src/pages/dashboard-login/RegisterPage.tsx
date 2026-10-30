import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { registerMerchant, type RegisterMerchantInput } from "../../api/register.js";
import { describeError } from "../../api/client.js";
import { writeLastMerchantId } from "../../auth/DashboardAuthContext.js";
import "../../dashboard.css";

const BUSINESS_TYPES: Array<[RegisterMerchantInput["businessProfile"]["businessType"], string]> = [
  ["llc", "Limited liability company"],
  ["sole_proprietorship", "Sole proprietorship"],
  ["partnership", "Partnership"],
  ["public_company", "Public company"],
  ["other", "Other"],
];

/** Merchant self-registration. Shows the new Merchant ID once, because signing in needs it. */
export function RegisterPage() {
  const navigate = useNavigate();
  const [f, setF] = useState({
    legalName: "", registrationNumber: "", businessType: "llc" as RegisterMerchantInput["businessProfile"]["businessType"],
    contactEmail: "", contactPhone: "", addressLine1: "", city: "", ownerEmail: "", password: "", confirm: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (f.password !== f.confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await registerMerchant({
        businessProfile: {
          legalName: f.legalName.trim(), registrationNumber: f.registrationNumber.trim(), businessType: f.businessType,
          contactEmail: f.contactEmail.trim(), contactPhone: f.contactPhone.trim(), addressLine1: f.addressLine1.trim(), city: f.city.trim(),
        },
        owner: { email: f.ownerEmail.trim(), password: f.password },
      });
      writeLastMerchantId(result.merchantId);
      setCreated(result.merchantId);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <main className="dash-centered">
        <h1>Account created</h1>
        <p>Your Merchant ID is needed every time you sign in. Keep it somewhere safe:</p>
        <p><code>{created}</code></p>
        <p className="dash-muted">It is already filled in on the sign-in page on this browser.</p>
        <button type="button" className="dash-button" onClick={() => navigate("/dashboard/login")}>Go to sign in</button>
      </main>
    );
  }

  return (
    <main className="dash-centered">
      <h1>Register your business</h1>
      <p className="dash-muted">Create a merchant account. You will sign in with a one-time code afterwards.</p>
      {error ? <p className="dash-error">{error}</p> : null}
      <form onSubmit={(e) => void onSubmit(e)} className="dash-form">
        <label>Legal name<input required value={f.legalName} onChange={set("legalName")} /></label>
        <label>Commercial registration number<input required value={f.registrationNumber} onChange={set("registrationNumber")} /></label>
        <label>Business type
          <select value={f.businessType} onChange={set("businessType")}>
            {BUSINESS_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>Business contact email<input type="email" required value={f.contactEmail} onChange={set("contactEmail")} /></label>
        <label>Business phone<input required value={f.contactPhone} onChange={set("contactPhone")} /></label>
        <label>Address<input required value={f.addressLine1} onChange={set("addressLine1")} /></label>
        <label>City<input required value={f.city} onChange={set("city")} /></label>
        <label>Your sign-in email<input type="email" autoComplete="username" required value={f.ownerEmail} onChange={set("ownerEmail")} /></label>
        <label>Password (at least 10 characters)
          <input type="password" autoComplete="new-password" minLength={10} required value={f.password} onChange={set("password")} />
        </label>
        <label>Confirm password
          <input type="password" autoComplete="new-password" minLength={10} required value={f.confirm} onChange={set("confirm")} />
        </label>
        <button type="submit" className="dash-button" disabled={submitting}>{submitting ? "Creating..." : "Create account"}</button>
      </form>
      <p className="dash-muted">Already registered? <Link to="/dashboard/login">Sign in</Link></p>
    </main>
  );
}
