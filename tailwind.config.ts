import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      /* ── Colors: CSS vars (auto light/dark) + static brand scale ── */
      colors: {
        /* CSS-var-backed semantic tokens */
        bg:        "var(--color-bg)",
        "bg-subtle":   "var(--color-bg-subtle)",
        "bg-muted":    "var(--color-bg-muted)",
        "bg-elevated": "var(--color-bg-elevated)",

        border:    "var(--color-border)",
        ring:      "var(--color-ring)",

        foreground: "var(--color-text)",
        muted:      "var(--color-text-secondary)",
        subtle:     "var(--color-text-tertiary)",

        /* Static brand scale (backward compat with existing code) */
        brand: {
          primary: "#0A2540",
          accent:  "#00A86B",
          50:  "#f0f7ff",
          100: "#e0effe",
          200: "#b9dffe",
          300: "#7cc5fd",
          400: "#36a9fa",
          500: "#0c8eeb",
          600: "#0070c9",
          700: "#0059a3",
          800: "#054b86",
          900: "#0a3f6f",
          950: "#07284a",
        },
        /* Static surface scale (backward compat) */
        surface: {
          50:  "#f8fafc",
          100: "#f1f5f9",
          200: "#e2e8f0",
          300: "#cbd5e1",
          400: "#94a3b8",
          500: "#64748b",
          600: "#475569",
          700: "#334155",
          800: "#1e293b",
          900: "#0f172a",
          950: "#020617",
        },
        accent: {
          warm:    "#f59e0b",
          success: "#10b981",
          danger:  "#ef4444",
          info:    "#6366f1",
        },
        ui: {
          bg: "#070B14",
          surface: "rgba(255,255,255,0.06)",
          surfaceStrong: "rgba(255,255,255,0.10)",
          border: "rgba(255,255,255,0.14)",
          text: "rgba(255,255,255,0.92)",
          text2: "rgba(255,255,255,0.72)",
          text3: "rgba(255,255,255,0.55)",
        },
      },
      fontFamily: {
        display: ['var(--font-inter)', 'Inter', "system-ui", "sans-serif"],
        body:    ['var(--font-inter)', 'Inter', "system-ui", "sans-serif"],
        mono:    ['"JetBrains Mono"', "monospace"],
      },
      borderRadius: {
        sm:  "var(--radius-sm)",
        md:  "var(--radius-md)",
        lg:  "10px",
        xl:  "12px",
      },
      boxShadow: {
        xs:    "var(--shadow-xs)",
        sm:    "var(--shadow-sm)",
        md:    "var(--shadow-md)",
        lg:    "var(--shadow-lg)",
        glass: "0 10px 30px rgba(0,0,0,0.35)",
        float: "0 20px 60px rgba(0,0,0,0.45)",
      },
      transitionTimingFunction: {
        premium: "cubic-bezier(.2,.8,.2,1)",
      },
      animation: {
        "fade-in":       "fadeIn 0.3s ease-out",
        "slide-up":      "slideUp 0.3s ease-out",
        "slide-down":    "slideDown 0.2s ease-out",
        "slide-in-right":"slideInRight 0.4s ease-out",
        shimmer:         "shimmer 2s linear infinite",
        float:           "float 6s ease-in-out infinite",
      },
      keyframes: {
        fadeIn:        { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        slideUp:       { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        slideDown:     { "0%": { opacity: "0", transform: "translateY(-4px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        slideInRight:  { "0%": { opacity: "0", transform: "translateX(20px)" }, "100%": { opacity: "1", transform: "translateX(0)" } },
        shimmer:       { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        float:         { "0%, 100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-10px)" } },
      },
    },
  },
  plugins: [],
};

export default config;
