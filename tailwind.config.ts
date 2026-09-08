import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        cricket: {
          50: '#f2f8f4',
          100: '#e1f0e6',
          200: '#c3e2cd',
          300: '#96cdab',
          400: '#63b283',
          500: '#3e9663',
          600: '#2d7a4e',
          700: '#266140',
          800: '#224e35',
          900: '#1d412e',
          950: '#0f241a',
        },
        pitch: {
          50: '#faf8f5',
          100: '#f3eee6',
          200: '#e6dbcc',
          300: '#d5c2ab',
          400: '#c2a587',
          500: '#b48f6d',
          600: '#a3795b',
          700: '#865f49',
          800: '#6d4e3e',
          900: '#594135',
          950: '#30211a',
        }
      },
    },
  },
  plugins: [],
};
export default config;
