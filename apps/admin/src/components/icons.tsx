import type { ReactNode } from "react";

/** Inline stroke icons for the admin shell: no icon font, no dependency. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function MerchantsIcon() {
  return (
    <Icon>
      <path d="M4 10v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9" />
      <path d="m3 9 2-5h14l2 5a3 3 0 0 1-6 .5 3 3 0 0 1-6 0A3 3 0 0 1 3 9z" />
      <path d="M10 20v-5h4v5" />
    </Icon>
  );
}

export function CreditsIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v8M8 12h8" />
    </Icon>
  );
}

export function SettlementIcon() {
  return (
    <Icon>
      <path d="m3 9.5 9-5.5 9 5.5" />
      <path d="M5 9.5h14M6.5 9.5V17M12 9.5V17M17.5 9.5V17M4 20h16M5 17h14" />
    </Icon>
  );
}

export function ImportIcon() {
  return (
    <Icon>
      <path d="M12 15V4M8 8l4-4 4 4" />
      <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </Icon>
  );
}

export function ReplayIcon() {
  return (
    <Icon>
      <path d="M4 12a8 8 0 0 1 13.7-5.6L20 9M20 4v5h-5" />
      <path d="M20 12a8 8 0 0 1-13.7 5.6L4 15M4 20v-5h5" />
    </Icon>
  );
}

export function LogoutIcon() {
  return (
    <Icon>
      <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9" />
    </Icon>
  );
}

export function SunIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Icon>
  );
}

export function MoonIcon() {
  return (
    <Icon>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </Icon>
  );
}
