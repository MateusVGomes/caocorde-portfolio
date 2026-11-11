// Visual do Caocorde: as cores da logo — o laranja do Jorginho (gato), o grafite do Dobby (cachorra) e o turquesa do
// olho do gato como acento. Contrastes e regras de uso em docs/design.md (brand-500/600/700 aguentam texto branco;
// brand-300/400 e acento-300/400 são para texto e ícone no fundo escuro).
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Os componentes usam as classes "slate" (bg-slate-900, text-slate-400...). Aqui o slate deixa de ser o cinza
        // azulado do Tailwind e vira o GRAFITE do Dobby (cinza escuro neutro, um fio de frio, igual ao pelo preto).
        // Contraste do texto: 400 no 900 = 8,6:1; 500 no 900 = 5,2:1 (docs/design.md).
        slate: {
          50: '#F8F8FA', 100: '#F1F1F4', 200: '#E6E6EA', 300: '#D4D4DA', 400: '#B4B4BD', 500: '#8A8A94',
          600: '#5E5E68', 700: '#34343B', 800: '#222227', 900: '#18181C', 950: '#111114',
        },
        // Laranja do Jorginho. 400 = o laranja da logo (#F07A1E): ícone, texto e destaque no escuro.
        // Botão com texto branco: 600 (5,3:1); hover 500 (4,5:1); pressionado 700 (7:1).
        brand: { 50: '#FFF4EA', 100: '#FFE0C7', 200: '#FFB27A', 300: '#FF8A33', 400: '#F07A1E', 500: '#C2560A', 600: '#B04E08', 700: '#963F06' },
        // Turquesa do olho do Jorginho: acento raro (foco do teclado, link, "novo"). Nunca no lugar do laranja.
        acento: { 300: '#5FD4DF', 400: '#2EC4D3', 500: '#1FA9B7', 600: '#14808C' },
      },
      animation: {
        'float-up': 'floatUp 2.5s cubic-bezier(0.25, 1, 0.5, 1) forwards',
        'bounce-subtle': 'bounceSubtle 2s infinite',
        'pulse-glow': 'pulseGlow 2s infinite',
        'fade-in': 'fadeIn .2s ease-out',
      },
      keyframes: {
        floatUp: {
          '0%': { transform: 'translateY(0) scale(0.6)', opacity: '0' },
          '15%': { opacity: '1', transform: 'translateY(-20px) scale(1.2)' },
          '100%': { transform: 'translateY(-260px) scale(0.9)', opacity: '0' },
        },
        bounceSubtle: { '0%, 100%': { transform: 'translateY(-3%)' }, '50%': { transform: 'translateY(0)' } },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 25px rgba(240, 122, 30, 0.30)' },
          '50%': { boxShadow: '0 0 45px rgba(240, 122, 30, 0.50)' },
        },
        fadeIn: { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
      },
    },
  },
};
