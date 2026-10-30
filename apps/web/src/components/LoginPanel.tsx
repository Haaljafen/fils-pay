import { BrandMark } from "./icons.js";

/** The login page's brand panel. Decoration only: it holds no data and no controls. */
export function LoginPanel({ tagline, copy }: { tagline: string; copy: string }) {
  return (
    <aside className="dash-login-panel">
      <div className="dash-brand">
        <BrandMark />
        <div>
          <strong>FilsPay</strong>
          <span>Merchant dashboard</span>
        </div>
      </div>
      <div>
        <p className="dash-login-tagline">{tagline}</p>
        <p className="dash-login-copy">{copy}</p>
      </div>
    </aside>
  );
}
