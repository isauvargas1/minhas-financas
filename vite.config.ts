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
      resolve: {
  alias: {
    '@': path.resolve(__dirname, 'src'),
  }
}
    };
});
