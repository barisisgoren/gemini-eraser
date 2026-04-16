module.exports = {
  content: [
    './public/**/*.html',
    './src/**/*.{js,html}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: '#F97316',
        'primary-hover': '#EA580C',
        secondary: '#DC2626',
        accent: '#FACC15',
        ink: '#140C08',
        dark: '#140C08',
        success: '#F97316',
        warn: '#CA8A04',
        err: '#DC2626',
        info: '#FB923C',
      },
      boxShadow: {
        soft: '0 30px 80px -40px rgba(234, 88, 12, 0.45)',
        card: '0 24px 70px -40px rgba(20, 12, 8, 0.45)',
      },
    },
  },
};
