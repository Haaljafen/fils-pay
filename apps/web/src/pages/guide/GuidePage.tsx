import { useDashboardAuth } from "../../auth/DashboardAuthContext.js";

/** First-time guide for merchants. Static text: it describes what each screen does, not live data. */
export function GuidePage() {
  const { me } = useDashboardAuth();

  return (
    <section>
      <h1>Merchant guide</h1>
      <p className="dash-muted">
        A short tour of the dashboard. Start with sign-in, then read the sections that match your role.
      </p>

      <div className="dash-guide-grid">
        <article className="dash-guide-card">
          <h2>1. Sign in</h2>
          <ol>
            <li>Enter your Merchant ID, the one issued when your account was created.</li>
            <li>Enter your email and password.</li>
            <li>Enter the one-time code sent to you. Codes expire, so request a new one if yours has.</li>
          </ol>
          <p className="dash-guide-note">Your Merchant ID is remembered on this browser. It is not a password.</p>
        </article>

        <article className="dash-guide-card">
          <h2>2. Overview</h2>
          <p>
            Captured volume, payouts and your top paid links for a date range. With no dates chosen you see the
            last 30 days. The figures refresh every minute.
          </p>
        </article>

        <article className="dash-guide-card">
          <h2>3. Transactions</h2>
          <p>
            Filter by status, date or reference. Open any row for its details and event timeline. Owners and
            finance users can start a refund from the transaction page.
          </p>
        </article>

        <article className="dash-guide-card">
          <h2>4. Payment links</h2>
          <p>
            Create a link for a customer to pay, copy it and send it on. Each link shows whether it is active,
            reserved, paid or canceled. Only owners and finance users can create links.
          </p>
        </article>

        <article className="dash-guide-card">
          <h2>5. Webhooks</h2>
          <p>
            Register an HTTPS address to receive payment and refund events. Only owners and finance users can
            manage webhooks.
          </p>
        </article>

        <article className="dash-guide-card">
          <h2>6. Settlement and reconciliation</h2>
          <p>
            Each business day's payments are batched and paid out. A batch shows gross amount, fees, refunds and
            the net payout. Reconciliation compares what was settled with your transactions and shows any gap.
          </p>
        </article>
      </div>

      <h2>Who can do what</h2>
      <table className="dash-table">
        <thead>
          <tr>
            <th>Role</th>
            <th>Can</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Owner</td>
            <td>Everything, including payment links, webhooks, refunds and reconciliation.</td>
          </tr>
          <tr>
            <td>Finance</td>
            <td>Everything the owner can do on payments, refunds, webhooks and settlement.</td>
          </tr>
          <tr>
            <td>Support</td>
            <td>View transactions, links, settlement and overview. No changes.</td>
          </tr>
        </tbody>
      </table>
      {me ? <p className="dash-muted">You are signed in as <strong>{me.role}</strong>.</p> : null}

      <h2>Good to know</h2>
      <ul className="dash-guide-list">
        <li>Business days run from midnight to midnight, Bahrain time (UTC+3).</li>
        <li>Amounts are in Bahraini dinars with three decimals. 1 BD = 1000 fils.</li>
        <li>Use the moon icon in the top bar for dark mode. Until you choose, the dashboard follows your device.</li>
        <li>The dashboard works on phones and tablets. On a phone, the menu sits at the bottom of the screen.</li>
        <li>Log out when you finish, especially on a shared computer.</li>
      </ul>
    </section>
  );
}
