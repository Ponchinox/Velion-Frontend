/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        /* ── Surfaces ── */
        app:    '#F3F4F6',   /* fondo gris muy claro */
        card:   '#FFFFFF',   /* tarjetas blancas */
        panel:  '#FFFFFF',   /* sidebar blanco */

        /* ── Borders ── */
        line:       '#E5E7EB',  /* gray-200 */
        'line-strong': '#D1D5DB', /* gray-300 */

        /* ── Text ── */
        hi:   '#111827',   /* gray-900 — título */
        mid:  '#374151',   /* gray-700 — body */
        lo:   '#6B7280',   /* gray-500 — secundario */
        muted:'#9CA3AF',   /* gray-400 — placeholder */

        /* ── Brand / Accent ── */
        brand: {
          DEFAULT: '#2563EB',  /* blue-600 — acento corporativo */
          hover:   '#1D4ED8',  /* blue-700 */
          light:   '#EFF6FF',  /* blue-50  — fondo tenue en activos */
          muted:   '#BFDBFE',  /* blue-200 */
        },

        /* ── Semánticos ── */
        success:  '#16A34A',
        danger:   '#DC2626',
        warning:  '#D97706',
      },

      fontFamily: {
        sans:    ['"Plus Jakarta Sans"', 'sans-serif'],
        heading: ['"Plus Jakarta Sans"', 'sans-serif'],
        mono:    ['"Space Mono"', 'monospace'],
      },

      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        xs:    ['0.75rem',   { lineHeight: '1.125rem' }],
        sm:    ['0.875rem',  { lineHeight: '1.375rem' }],
        base:  ['1rem',      { lineHeight: '1.625rem' }],
        lg:    ['1.125rem',  { lineHeight: '1.75rem' }],
        xl:    ['1.25rem',   { lineHeight: '1.875rem' }],
        '2xl': ['1.5rem',    { lineHeight: '2rem' }],
        '3xl': ['1.875rem',  { lineHeight: '2.375rem' }],
      },

      borderRadius: {
        sm:  '6px',
        DEFAULT: '8px',
        md:  '10px',
        lg:  '12px',
        xl:  '16px',
        full:'9999px',
      },

      boxShadow: {
        card: '0 1px 3px 0 rgb(0 0 0 / 0.07), 0 1px 2px -1px rgb(0 0 0 / 0.07)',
        'card-md': '0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.06)',
        'input-focus': '0 0 0 3px rgb(37 99 235 / 0.15)',
      },

      spacing: {
        sidebar: '18rem',   /* w-72 */
        topbar:  '64px',
      },

      transitionDuration: {
        fast: '120ms',
        base: '200ms',
      },
    },
  },
  plugins: [],
}
