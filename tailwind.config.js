/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'], sans: ['"Public Sans"', 'system-ui', 'sans-serif'] },
      colors: {
        ink: { DEFAULT: '#14201B', soft: '#4B5A53', mute: '#7A8781' },
        paper: { DEFAULT: '#F5F6F3', card: '#FFFFFF' },
        line: { DEFAULT: '#DCE1DB', soft: '#EBEEE9' },
        brand: { DEFAULT: '#0F6B4F', dark: '#0A4F3A', light: '#E3F1EB' },
        amber: { DEFAULT: '#E8A317', light: '#FBF1DA' },
        danger: { DEFAULT: '#C8412F', light: '#FBE9E6' },
      },
      boxShadow: { card: '0 1px 2px rgba(20,32,27,.05)', pop: '0 12px 32px -8px rgba(20,32,27,.25)' },
    },
  },
  plugins: [],
};
