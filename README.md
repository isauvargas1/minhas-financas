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