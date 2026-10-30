/** The login brand panel: a khatam lattice and the white band of the Bahraini flag. Decoration only. */
export function LoginPanel({ tagline, copy }: { tagline: string; copy: string }) {
  return (
    <aside className="dash-login-panel">
      <svg className="dash-motif" aria-hidden="true" focusable="false">
        <defs>
          <pattern id="dash-khatam" width="56" height="56" patternUnits="userSpaceOnUse">
            <path d="M28 2 40 16 54 28 40 40 28 54 16 40 2 28 16 16Z" fill="none" stroke="currentColor" strokeWidth="0.9" />
            <path d="M28 14 34 22 42 28 34 34 28 42 22 34 14 28 22 22Z" fill="none" stroke="currentColor" strokeWidth="0.7" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dash-khatam)" />
      </svg>
      <svg className="dash-band" viewBox="0 0 20 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d="M0 0H12L20 10L12 20L20 30L12 40L20 50L12 60L20 70L12 80L20 90L12 100H0Z" fill="#fff" />
      </svg>
      <div className="dash-brand">
        <strong>FilsPay</strong>
      </div>
      <div className="dash-login-text">
        <p className="dash-login-tagline">{tagline}</p>
        <p className="dash-login-copy">{copy}</p>
      </div>
    </aside>
  );
}
