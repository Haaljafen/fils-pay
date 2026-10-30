import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { registerAdmin } from "../../api/register.js";
import { describeError } from "../../api/client.js";

/** Admin self-registration. Needs the registration code from the platform owner; new admins start as support. */
export function RegisterPage() {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await registerAdmin({ email: email.trim(), password, displayName: displayName.trim() });
      setDone(true);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <main className="admin-centered">
        <h1>Request received</h1>
        <p>Your admin account was created and is waiting for approval. You can sign in once an existing admin activates it.</p>
        <button type="button" onClick={() => navigate("/login")}>Go to sign in</button>
      </main>
    );
  }

  return (
    <main className="admin-centered">
      <h1>Register as an admin</h1>
      <p className="admin-muted">New accounts start with the support role and must be approved before they can sign in.</p>
      {error ? <p className="admin-error">{error}</p> : null}
      <form onSubmit={(e) => void onSubmit(e)} className="admin-form">
        <label>Full name<input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
        <label>Email<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Password (at least 12 characters)
          <input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label>Confirm password
          <input type="password" autoComplete="new-password" minLength={12} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        <button type="submit" disabled={submitting}>{submitting ? "Creating..." : "Request admin account"}</button>
      </form>
      <p className="admin-muted">Already registered? <Link to="/login">Sign in</Link></p>
    </main>
  );
}
