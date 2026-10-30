import { BrandMark } from "./icons.js";

/** The login page's brand panel. Decoration only: it holds no data and no controls. */
export function LoginPanel({ tagline, copy }: { tagline: string; copy: string }) {
  return (
    <aside className="admin-login-panel">
      <div className="admin-brand">
        <BrandMark />
        <div>
          <strong>FilsPay</strong>
          <span>Admin console</span>
        </div>
      </div>
      <div>
        <p className="admin-login-tagline">{tagline}</p>
        <p className="admin-login-copy">{copy}</p>
      </div>
    </aside>
  );
}
