import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useDashboardAuth } from "../auth/DashboardAuthContext.js";
import { RequireRole } from "../auth/RequireRole.js";
import { describeError } from "../api/client.js";
import {
  LinkIcon,
  LogoutIcon,
  OverviewIcon,
  ReconciliationIcon,
  SettlementIcon,
  TransactionsIcon,
  WebhookIcon,
  GuideIcon,
} from "./icons.js";
import { ThemeToggle } from "./ThemeToggle.js";
import "../dashboard.css";

/** Nav shell for every merchant dashboard screen. No impersonation banner
 *  here — nothing in the merchant plane impersonates anyone; when an admin
 *  "views as merchant", they arrive with a `support`-role session and see
 *  exactly what a support user sees. */
export function DashboardLayout() {
  const { me, signOut } = useDashboardAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  // sign out clears the cookie server side, local merchantId stays — am
  async function handleSignOut(): Promise<void> {
    setError(null);
    try {
      await signOut();
      navigate("/dashboard/login", { replace: true });
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <div className="dash-shell">
      <aside className="dash-side">
        <div className="dash-brand">
          <div>
            <strong>FilsPay</strong>
            <span>Merchant dashboard</span>
          </div>
        </div>

        <nav className="dash-nav">
          <NavLink to="/dashboard/transactions">
            <TransactionsIcon />
            <span>Transactions</span>
          </NavLink>
          <NavLink to="/dashboard/payment-links">
            <LinkIcon />
            <span>Payment links</span>
          </NavLink>
          {/* Every webhook route — including the plain list read — is
              owner/finance-only server-side, so the link itself is
              hidden from support rather than offered and then refused. */}
          <RequireRole allow={["owner", "finance"]}>
            <NavLink to="/dashboard/webhooks">
              <WebhookIcon />
              <span>Webhooks</span>
            </NavLink>
          </RequireRole>
          <NavLink to="/dashboard/settlement">
            <SettlementIcon />
            <span>Settlement</span>
          </NavLink>
          <RequireRole allow={["owner", "finance"]}>
            <NavLink to="/dashboard/reconciliation">
              <ReconciliationIcon />
              <span>Reconciliation</span>
            </NavLink>
          </RequireRole>
          <NavLink to="/dashboard/overview">
            <OverviewIcon />
            <span>Overview</span>
          </NavLink>
          <NavLink to="/dashboard/guide">
            <GuideIcon />
            <span>Guide</span>
          </NavLink>
        </nav>
      </aside>

      <div className="dash-column">
        <header className="dash-header">
          {me ? <div className="dash-context">{me.merchant.displayName}</div> : null}
          <div className="dash-identity">
            {me ? (
              <div className="dash-user">
                <span className="dash-avatar" aria-hidden="true">
                  {me.email.slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <strong>{me.email}</strong>
                  <span className="dash-role-chip">{me.role}</span>
                </div>
              </div>
            ) : null}
            <ThemeToggle />
            <button type="button" className="dash-button dash-logout" onClick={() => void handleSignOut()}>
              <LogoutIcon />
              Log out
            </button>
          </div>
        </header>

        {error ? <p className="dash-error">{error}</p> : null}

        <main className="dash-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
