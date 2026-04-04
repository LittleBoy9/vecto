/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#141414",
        panel: "#1e1e1e",
        surface: "#2a2a2a",
        "surface-hover": "#333333",
        border: "#333333",
        "border-subtle": "#272727",
        "text-primary": "#e5e5e5",
        "text-secondary": "#888888",
        "text-muted": "#555555",
        accent: "#0ea5e9",
        "accent-hover": "#38bdf8",
        "accent-dim": "rgba(14,165,233,0.15)",
        danger: "#ef4444",
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "Inter", "sans-serif"],
      },
    },
  },
  plugins: [],
};
