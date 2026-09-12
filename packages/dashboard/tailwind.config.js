/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
    extend: {
      colors: {
        aegis: {
          dark: '#0a0a0f',
          panel: '#15151e',
          blue: '#1d4ed8',
          green: '#00ff88',
          red: '#ff3366',
          text: '#f4f4f5',
          muted: '#a1a1aa'
        }
      }
    },
  },
  plugins: [],
}
