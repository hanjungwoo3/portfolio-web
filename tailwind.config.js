/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      colors: {
        profit: "#c0392b",
        loss: "#1f6feb",
        warn: {
          danger: "#c0392b",
          warning: "#e67e22",
          caution: "#f39c12",
          halt: "#888",
        },
      },
      fontFamily: {
        sans: ["Pretendard", "system-ui", "-apple-system", "sans-serif"],
        mono: ["SF Mono", "Menlo", "Monaco", "monospace"],
      },
    },
  },
  plugins: [],
};
