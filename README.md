# Minhas Finanças

Aplicação web de gestão financeira PF/PJ em evolução para SaaS multiusuário, com frontend em React/Vite/TypeScript e backend em Firebase.

## Stack oficial

- Frontend: React, Vite e TypeScript
- Backend: Firebase Authentication, Cloud Firestore e Cloud Functions
- Estilização: Tailwind CSS
- Testes E2E: Playwright
- Deploy atual: Firestore Rules, Firestore Indexes e Cloud Functions

> O `firebase.json` atual não possui configuração de Firebase Hosting. O deploy seguro documentado aqui cobre Firestore e Functions.

## Instalação

Na raiz do projeto:

```bash
npm install
npm --prefix functions install
## Runtime do Node

O runtime de deploy das Cloud Functions é o **Node 24**
(`functions/package.json` → `engines.node`), e `.nvmrc`/`.node-version`
declaram a mesma versão para quem usa gerenciador de versão.

O ambiente de desenvolvimento em Codespaces roda hoje **Node 22**. A
divergência é conhecida e não quebra nada: o gate de CI executa build, lint,
verificação de tipos e testes unitários **nas duas versões**, de modo que o
runtime realmente implantado é exercitado a cada mudança — que era exatamente a
lacuna registrada na auditoria de prontidão ("runtime testado ≠ runtime
implantado, nunca exercitado").

Para alinhar o ambiente local:

```bash
nvm install 24 && nvm use 24
npm ci && npm ci --prefix functions
```

## Gates

| Comando | O que cobre |
| ------- | ----------- |
| `npm run verify:fast` | tipos, lint das Functions, build do frontend e das Functions, unitários dos dois lados |
| `npm run test:integration:emulator` | suíte de integração e as cinco suítes de Firestore Rules no Emulator |
| `npm run test:e2e` | build de produção servido por `vite preview` mais a suíte Playwright |
| `npm run verify:all` | os três acima, em sequência |

Os caminhos de deploy dependem dos gates: `deploy:firestore` executa a suíte de
Rules antes de publicar `firestore.rules` e os índices, e `deploy:safe` executa
`verify:fast` mais a suíte de integração completa. Publicar regras sem executar
as asserções de isolamento não é possível pelos scripts do repositório.
