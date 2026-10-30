import { useState } from "react";
import { currentTheme, setTheme, type ThemeMode } from "../theme.js";
import { MoonIcon, SunIcon } from "./icons.js";

/** Switches between light and dark mode and remembers the choice on this browser. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [mode, setMode] = useState<ThemeMode>(() => currentTheme());
  const next: ThemeMode = mode === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className={`dash-theme-toggle ${className}`.trim()}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => {
        setTheme(next);
        setMode(next);
      }}
    >
      {mode === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
