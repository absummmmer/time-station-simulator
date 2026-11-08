/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './core.js',
    './audio-engine.js',
    './time-sync.js',
    './observability.js',
    './app.js',
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          900: '#000000',
          800: '#1f2937',
          700: '#374151',
          600: '#4b5563',
        },
      },
    },
  },
  corePlugins: { preflight: true },
};
