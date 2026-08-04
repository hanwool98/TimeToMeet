/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Pretendard', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        meet: {
          blue: '#6db2ef',
          blueSoft: '#e8f5ff',
          pink: '#f5709a',
          pinkSoft: '#ffeaf1',
          line: '#e8e8e8',
          tab: '#ffe2e1',
        },
      },
      boxShadow: {
        calendar: '0 18px 48px rgba(30, 43, 63, 0.09), 0 2px 10px rgba(30, 43, 63, 0.04)',
      },
    },
  },
  plugins: [],
};
