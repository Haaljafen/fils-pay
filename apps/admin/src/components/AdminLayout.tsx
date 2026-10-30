import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAdminAuth } from "../auth/AdminAuthContext.js";
import { describeError, WEB_BASE_URL } from "../api/client.js";
import {
  BrandMark,
  CreditsIcon,
  ImportIcon,
  LogoutIcon,
  MerchantsIcon,
  ReplayIcon,
  SettlementIcon,
} from "./icons.js";
import { ImpersonationBanner } from "./ImpersonationBanner.js";

/** Nav shell for every admin-plane screen: who you are signed in as, the
 *  section links, a logout, and — above all of it — the impersonation
 *  banner when a grant is live. */
// YA: nav order per Huda's request (Credits first)
export function AdminLayout() {
  const { admin, signOut, impersonation } = useAdminAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut(): Promise<void> {
    setError(null);
    try {
      await signOut();
      navigate("/login", { replace: true });
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <div className="admin-shell">
      <ImpersonationBanner />

      <div className="admin-frame">
        <aside className="admin-side">
          <div className="admin-brand">
            <BrandMark />
            <div>
              <strong>FilsPay</strong>
              <span>Admin console</span>
            </div>
          </div>

          <nav className="admin-nav">
            <NavLink to="/merchants">
              <MerchantsIcon />
              <span>Merchants</span>
            </NavLink>
            <NavLink to="/credits">
              <CreditsIcon />
              <span>Credits</span>
            </NavLink>
            <NavLink to="/settlement">
              <SettlementIcon />
              <span>Settlement ops</span>
            </NavLink>
            <NavLink to="/adjustment-imports">
              <ImportIcon />
              <span>Import adjustments</span>
            </NavLink>
            <NavLink to="/webhooks">
              <ReplayIcon />
              <span>Webhook replay</span>
            </NavLink>
          </nav>
        </aside>

        <div className="admin-column">
          <header className="admin-header">
            <div className="admin-context">Operations</div>
            <div className="admin-identity">
              {admin ? (
                <div className="admin-user">
                  <span className="admin-avatar" aria-hidden="true">
                    {admin.email.slice(0, 2).toUpperCase()}
                  </span>
                  <div>
                    <strong>{admin.email}</strong>
                    <span className="admin-role-chip">{admin.role}</span>
                  </div>
                </div>
              ) : null}
              <button type="button" className="admin-logout" onClick={() => void handleSignOut()}>
                <LogoutIcon />
                Log out
              </button>
            </div>
          </header>

          {error ? <p className="admin-error">{error}</p> : null}

          {impersonation ? (
            // An explicit "exit view-as-merchant" action is required before
            // admin-plane screens are shown again. This is a UX safeguard so the
            // two modes are never confused on screen; the privilege boundary
            // itself does not depend on it — /v1/admin/* never reads the
            // impersonation cookie, and the merchant side never reads the admin
            // session cookie.
            <main className="admin-main">
              <h1>Admin screens are paused</h1>
              <p>
                An impersonation grant is active. Use <strong>Exit impersonation</strong> above to end it
                and return to the admin console.
              </p>
              <p>
                Merchant screens are at <code>{WEB_BASE_URL}</code> while the grant lasts.
              </p>
            </main>
          ) : (
            <main className="admin-main">
              <Outlet />
            </main>
          )}
        </div>
      </div>
    </div>
  );
}
