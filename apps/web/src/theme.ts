const KEY = "filspay.theme";

export type ThemeMode = "light" | "dark";

function stored(): ThemeMode | null {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    // Storage disabled: the device setting decides, as it does on a first visit.
    return null;
  }
}

/** The mode in use now: the saved choice, else the device's own setting. */
export function currentTheme(): ThemeMode {
  return stored() ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = mode;
}

export function setTheme(mode: ThemeMode): void {
  applyTheme(mode);
  try {
    window.localStorage.setItem(KEY, mode);
  } catch {
    // The choice still applies to this page; it just won't be remembered.
  }
}

/** Runs before the first render so a saved dark mode never flashes light. */
export function initTheme(): void {
  const saved = stored();
  if (saved) applyTheme(saved);
}
