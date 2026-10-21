/** @type {import('tailwindcss').Config} */
module.exports = {
  // O CSS é gerado uma vez e versionado; não há build no deploy.
  // Regenere com `npm run build:css` sempre que adicionar classes no HTML/JS.
  content: ['./index.html', './assets/js/**/*.js'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a'
        },
        darkbg: '#0b1120',
        darkcard: '#1e293b',
        darkborder: '#334155'
      }
    }
  }
};
