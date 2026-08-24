import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        // A chave do Gemini NÃO é mais injetada no bundle. `define` substitui
        // o identificador no código servido ao navegador, o que tornava a
        // credencial legível para qualquer visitante. A inferência passou a
        // ser callable de backend, onde a chave vive em variável de ambiente.
        'process.env.API_KEY': JSON.stringify(''),
        'process.env.GEMINI_API_KEY': JSON.stringify('')
      },
      build: {
        /*
         * Divisão explícita de vendors.
         *
         * O bundle saía num único chunk acima de 500 kB, e o passo
         * `rendering chunks` do Rollup segurava a árvore inteira em memória:
         * o build era morto por falta de memória em máquinas de 8 GB e o
         * renderer do Playwright estourava ao carregar a página, que é a
         * causa real do flake de E2E registrado como INV-P2-044.
         *
         * O agrupamento segue as bibliotecas que dominam o peso e mudam em
         * ritmos diferentes do produto — o que também melhora o cache do
         * navegador entre releases.
         */
        chunkSizeWarningLimit: 900,
        rollupOptions: {
          output: {
            manualChunks: {
              'vendor-react': ['react', 'react-dom'],
              'vendor-firebase': [
                'firebase/app',
                'firebase/auth',
                'firebase/firestore',
                'firebase/functions',
                'firebase/storage',
              ],
              'vendor-charts': ['recharts'],
              'vendor-motion': ['framer-motion'],
              'vendor-icons': [
                '@tabler/icons-react',
                'lucide-react',
                '@phosphor-icons/react',
              ],
              'vendor-query': ['@tanstack/react-query'],
            },
          },
        },
      },
      resolve: {
  alias: {
    '@': path.resolve(__dirname, 'src'),
  }
}
    };
});
