/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#0D9488', dark: '#0F766E', light: '#14B8A6' },
        gold: { DEFAULT: '#F59E0B', dark: '#D97706', light: '#FBBF24' },
        slate: { 850: '#1E293B' }
      }
    }
  },
  plugins: []
}
