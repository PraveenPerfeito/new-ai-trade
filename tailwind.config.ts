import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        terminal: {
          bg:      '#06080f',
          surface: '#0b0e1a',
          card:    '#0f1422',
          border:  '#1a2035',
          bright:  '#1e2540',
          text:    '#e2e8f0',
          muted:   '#64748b',
          dim:     '#374151',
        },
        bull: {
          DEFAULT: '#00d084',
          muted:   '#00d08415',
          bright:  '#00ff9d',
          text:    '#4ade80',
          glow:    '#00d08440',
        },
        bear: {
          DEFAULT: '#ff3b5c',
          muted:   '#ff3b5c15',
          bright:  '#ff6b85',
          text:    '#f87171',
          glow:    '#ff3b5c40',
        },
        signal: {
          high:   '#f59e0b',
          medium: '#3b82f6',
          low:    '#6b7280',
          purple: '#8b5cf6',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Cascadia Code', 'monospace'],
      },
      animation: {
        'pulse-slow':   'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in':      'fadeIn 0.3s ease-out',
        'slide-up':     'slideUp 0.3s ease-out',
        'slide-in':     'slideIn 0.35s ease-out',
        'shimmer':      'shimmer 1.8s infinite',
        'spin-slow':    'spin 3s linear infinite',
        'ping-slow':    'ping 2s cubic-bezier(0, 0, 0.2, 1) infinite',
        'bar-pulse':    'barPulse 2.5s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%':   { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)',    opacity: '1' },
        },
        slideIn: {
          '0%':   { transform: 'translateX(-8px)', opacity: '0' },
          '100%': { transform: 'translateX(0)',    opacity: '1' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition:  '200% 0' },
        },
        barPulse: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.65' },
        },
      },
      boxShadow: {
        'glass':       '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)',
        'card':        '0 4px 24px rgba(0,0,0,0.3)',
        'glow-bull':   '0 0 20px rgba(0,208,132,0.25), 0 0 40px rgba(0,208,132,0.1)',
        'glow-bear':   '0 0 20px rgba(255,59,92,0.25), 0 0 40px rgba(255,59,92,0.1)',
        'glow-signal': '0 0 20px rgba(59,130,246,0.2)',
      },
    },
  },
  plugins: [],
};

export default config;
