/** Nail Time & Spa design tokens */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        porcelain: '#F7F4F2',
        blush: '#EADBD9',
        rose: '#A94F61',
        rosedeep: '#7D3546',
        ink: '#261B1F',
        gold: '#9B7848',
        sagegray: '#70686B',
        mist: '#EEEAE7',
        success: '#31705A',
        danger: '#A13F50'
      },
      fontFamily: {
        body: ['"Noto Sans Thai"', 'system-ui', 'sans-serif'],
        display: ['"Noto Serif Thai"', 'serif']
      },
      boxShadow: {
        panel: '0 1px 2px rgba(38,27,31,.04), 0 12px 32px rgba(68,47,53,.06)',
        lift: '0 18px 48px rgba(68,47,53,.12)'
      }
    }
  },
  plugins: []
}
