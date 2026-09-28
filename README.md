# Minhas Finanças

Aplicação web de gestão financeira PF/PJ em evolução para SaaS multiworkspace, com frontend em React/Vite/TypeScript e backend em Firebase.

> **Estado do programa:** o plano mestre de prontidão para produção está em [`docs/production/PRODUCTION_READINESS_PLAN.md`](docs/production/PRODUCTION_READINESS_PLAN.md). Ele registra os blockers auditados, a arquitetura alvo e os milestones. As instruções para agentes estão em [`AGENTS.md`](AGENTS.md) e [`CLAUDE.md`](CLAUDE.md).

## Stack

- Frontend: React 18, Vite 6 e TypeScript
- Backend: Firebase Authentication, Cloud Firestore e Cloud Functions v2 (`southamerica-east1`)
- Pagamentos: Stripe (checkout e webhook)
- IA: Gemini, chamado somente pelo backend
- Estilização: Tailwind CSS, hoje carregado em runtime via CDN em `index.html` (não é dependência do build; ver PR-PLAT-03 no plano mestre)
- Testes: `node:test` (unitários e integração), Firebase Emulator (Firestore Rules e integração) e Playwright (E2E)

`firebase.json` declara Firestore (Rules e índices), Functions, Hosting (SPA servindo `dist/`) e os emuladores de Auth, Firestore e Functions.

## Instalação

Na raiz do projeto:

```bash
npm install
npm --prefix functions install
```

## Variáveis de ambiente

Nunca versione valores. `.env*` está no `.gitignore`.

| Onde | Variável | Uso |
| --- | --- | --- |
| Frontend (`.env.local`) | `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` | Configuração pública do app Firebase |
| Frontend | `VITE_USE_FIREBASE_EMULATORS`, `VITE_E2E_MODE` | Emuladores e modo E2E (definidos por `npm run build:e2e`) |
| Functions (Secret Manager) | `GOOGLE_AI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_ALLOWED_PRICE_IDS`, `APP_ALLOWED_ORIGINS` | Segredos e allowlists declarados nas funções que os usam |

## Runtime do Node

O runtime de deploy das Cloud Functions é o **Node 24** (`functions/package.json` → `engines.node`), e `.nvmrc`/`.node-version` declaram a mesma versão. O CI executa build, lint, verificação de tipos e testes unitários em Node 22 e 24.

```bash
nvm install 24 && nvm use 24
npm ci && npm ci --prefix functions
```

## Gates

| Comando | O que cobre |
| ------- | ----------- |
| `npm run verify:fast` | tipos, lint das Functions, build do frontend e das Functions, unitários dos dois lados |
| `npm run test:integration:emulator` | integração das Functions, guarda da ferramenta de limpeza e as seis suítes de Firestore Rules no Emulator (projeto `minhas-financas-local`) |
| `npm run test:e2e` | build E2E servido por `vite preview` mais a suíte Playwright, contra o Emulator |
| `npm run verify:all` | os três acima, em sequência |

O workflow `.github/workflows/quality-gate.yml` executa esses gates em todo push para `main` e em pull requests.

## Deploy

**Não use os scripts `deploy:*` sem autorização explícita.** Hoje existe um único projeto Firebase (`.firebaserc` → `sistema-financeiro-pesso-20698`), fixado em todos os scripts `deploy:*`; não há separação DEV/STAGING/PROD (PR-PLAT-01 no plano mestre). `deploy:firestore` executa as suítes de Rules antes de publicar; `deploy:safe` executa `verify:fast` e a suíte de integração; `deploy:hosting` gera um novo build com as variáveis locais de quem executa e publica `dist/`, sem gate de testes. Agentes de IA não executam deploy, push ou merge, conforme `CLAUDE.md`.
