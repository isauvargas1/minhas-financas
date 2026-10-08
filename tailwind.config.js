/**
 * Tailwind local, no build do Vite (P2C-H2; antecipa a parte de CSS de
 * PR-PLAT-03).
 *
 * Antes, o `index.html` carregava o Play CDN (`cdn.tailwindcss.com`) e
 * declarava esta mesma configuração em `tailwind.config` global, em tempo de
 * execução. O tema abaixo é o mesmo, transferido sem mudança: modo escuro por
 * classe, Poppins, cores semânticas ligadas às variáveis CSS do tema, cores
 * legadas `dark-*` ainda usadas e o raio `card`.
 *
 * Varredura: todas as classes do produto estão literais no código-fonte. Não
 * há classe montada por interpolação (`bg-${...}`) nem classe vinda de dados,
 * então não há safelist.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ['./index.html', './index.tsx', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Poppins', 'sans-serif'],
      },
      colors: {
        // Cores semânticas ligadas às variáveis CSS do tema.
        primary: 'var(--color-primary)',
        background: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        'on-surface': 'var(--color-text)',
        muted: 'var(--color-text-secondary)',
        border: 'var(--color-border)',
        // Texto na cor do espaço sobre fundo escuro (UX-H1, V-06). A cor
        // primária vem do espaço de trabalho (WorkspaceContext) e não muda com
        // o modo; no escuro, o texto usa um tom mais claro do mesmo matiz,
        // como as variantes `dark:text-indigo-400` já fazem no produto.
        'primary-on-dark': 'color-mix(in srgb, var(--color-primary) 60%, white)',

        // Legado ainda usado pelos componentes.
        dark: {
          100: '#1E293B',
          200: '#0F172A',
          300: '#0B1120',
        },
      },
      borderRadius: {
        card: 'var(--radius)',
      },
    },
  },
  plugins: [],
};
