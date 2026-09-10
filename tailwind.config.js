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
        // 앱 전체 카드의 기준 그림자. 홈/마이페이지의 정돈된 톤에 맞춰
        // 예전 캘린더식(18px/48px)보다 훨씬 얕고 자연스럽게 유지한다.
        calendar: '0 6px 20px rgba(30, 43, 63, 0.06), 0 1px 4px rgba(30, 43, 63, 0.03)',
        card: '0 4px 14px rgba(30, 43, 63, 0.05)',
      },
    },
  },
  plugins: [],
};
