import type { ReactNode } from "react";

/** Inline stroke icons for the dashboard shell: no icon font, no dependency. */
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

export function BrandMark() {
  return (
    <svg viewBox="0 0 40 40" width="38" height="38" aria-hidden="true">
      <circle cx="20" cy="20" r="20" fill="#8a1c26" />
      <circle cx="20" cy="20" r="14.5" fill="none" stroke="#efe5d2" strokeWidth="1" />
      <path d="M16 28V12.5h9M16 19.5h7" fill="none" stroke="#efe5d2" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TransactionsIcon() {
  return (
    <Icon>
      <path d="M4 8h15M15 4l4 4-4 4" />
      <path d="M20 16H5M9 12l-4 4 4 4" />
    </Icon>
  );
}

export function LinkIcon() {
  return (
    <Icon>
      <path d="M10 14a4 4 0 0 0 6 .4l3-3a4.2 4.2 0 0 0-6-6l-1.5 1.5" />
      <path d="M14 10a4 4 0 0 0-6-.4l-3 3a4.2 4.2 0 0 0 6 6l1.5-1.5" />
    </Icon>
  );
}

export function WebhookIcon() {
  return (
    <Icon>
      <path d="M13 3 5 14h6l-1 7 8-11h-6z" />
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

export function ReconciliationIcon() {
  return (
    <Icon>
      <path d="M12 4v16M7 20h10M5 7h14" />
      <path d="M5 7 2.5 13a3 3 0 0 0 5 0zM19 7l-2.5 6a3 3 0 0 0 5 0z" />
    </Icon>
  );
}

export function OverviewIcon() {
  return (
    <Icon>
      <path d="M4 20V4M4 20h16" />
      <path d="M8 16v-4M12.5 16V8M17 16v-6" />
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
