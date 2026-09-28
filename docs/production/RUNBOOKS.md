# Runbooks operacionais

Este documento reúne os procedimentos operacionais do Minhas Finanças em três grupos: os válidos hoje, os proibidos ou obsoletos (com o motivo) e os alvo, a criar nos milestones. Baseline auditada: `main` @ HEAD `9c3ab46`. As lacunas usam os IDs do [plano mestre](PRODUCTION_READINESS_PLAN.md#6-registro-de-blockers), que classifica os runbooks antigos de `docs/investments/` como OUTDATED ([§13](PRODUCTION_READINESS_PLAN.md#13-documentação-existente)). O gate de conteúdo, dono e exercício dos runbooks é a skill `observability-incident-readiness`; o gate dos procedimentos de plataforma (deploy, segredos, restore) é `firebase-production-readiness`. Os gates locais abaixo são a evidência que `regression-release-gate` exige.

> **Regras que valem para todos os runbooks**
> - Nenhum runbook válido toca produção. Firebase durante o desenvolvimento só pelo Emulator, com o projeto `minhas-financas-local`, ou por DEV/STAGING autorizado explicitamente pelo usuário (CLAUDE.md).
> - Agentes não fazem deploy, push, merge nem acesso ao projeto `sistema-financeiro-pesso-20698`, nem leem `.env*` ou segredos. As negações do harness estão em `.claude/settings.json`.
> - Nenhum artefato de P1–P5 é implantado em projeto remoto antes do fechamento de P6 (D-ORD-04).
> - Falha de gate não se contorna com `skip`/`only`, timeout maior ou mock excessivo (CLAUDE.md).

Rótulos: **CURRENT**, **TARGET**, **GAP**, **DECISION**, **EXTERNAL CONFIGURATION REQUIRED**.

---

## 1. Runbooks válidos hoje (CURRENT)

Todos foram conferidos em `package.json`, `functions/package.json`, `playwright.config.ts`, `firebase.json` e `.github/workflows/quality-gate.yml` no HEAD. Nenhum exige login na CLI do Firebase nem segredo: o CI roda os mesmos comandos sem credenciais (`.github/workflows/quality-gate.yml:7-8`).

### RB-01 — Instalação do ambiente local

| Campo | Conteúdo |
| --- | --- |
| Pré-condições | Node 24 (`.nvmrc`, `.node-version`; `functions/package.json:15-17`). O CI também valida o Node 22 (`.github/workflows/quality-gate.yml:37`). Java 17 para os emuladores (`.github/workflows/quality-gate.yml:89-92`). Firebase CLI instalada; o CI usa `firebase-tools@latest`, sem versão fixa (`.github/workflows/quality-gate.yml:100-101`; FIRE-13). |
| Comandos | `npm ci` · `npm ci --prefix functions` (`.github/workflows/quality-gate.yml:49-53`) · `npx playwright install --with-deps chromium` (`.github/workflows/quality-gate.yml:147-148`) |
| Sucesso | Os três comandos terminam com código 0; `node --version` informa v24. |
| Observações | Os gates não precisam de `.env.local`: `build:e2e` e o Playwright injetam a configuração do Emulator (`package.json:27`; `playwright.config.ts:26-36`). |

### RB-02 — Gate rápido

| Campo | Conteúdo |
| --- | --- |
| Pré-condições | RB-01. |
| Comando | `npm run verify:fast` (`package.json:37`): `typecheck` → `functions:lint` → `build` → `functions:build` → `functions:test:unit` → `test:unit:investments` (`package.json:8-14`). |
| Sucesso | Código 0. Equivale ao job "Build e testes unitários" do CI em Node 22 e 24 (`.github/workflows/quality-gate.yml:27-72`). |
| Observações | `test:unit:investments` enumera 13 arquivos à mão (`package.json:14`; REL-10). Teste novo em `tests/unit` precisa ser incluído na lista, senão não roda. |

### RB-03 — Integração e Firestore Rules no Emulator

| Campo | Conteúdo |
| --- | --- |
| Pré-condições | RB-01; portas 8080 e 9099 livres (RB-09). |
| Comando | `npm run test:integration:emulator` (`package.json:36`). Sobe Auth e Firestore com `--project minhas-financas-local` e executa a integração das Functions com `FIRESTORE_EMULATOR_HOST` e `GCLOUD_PROJECT` locais (`package.json:16`), a guarda da ferramenta de limpeza (`package.json:32`) e as 6 suítes de Rules (`package.json:33-35,39-41`). |
| Sucesso | Código 0 **e** nenhum teste pulado no resumo do `node --test`. Um `skip` indica execução sem Emulator (FIRE-13, INV-16, REL-09). Equivale ao job "Integração e Firestore Rules" (`.github/workflows/quality-gate.yml:74-110`). |

### RB-04 — E2E

| Campo | Conteúdo |
| --- | --- |
| Pré-condições | RB-01 (incluindo o Chromium); portas 4000, 5001, 5173, 8080 e 9099 livres (RB-09). |
| Comando | `npm run test:e2e` (`package.json:28`): `build:e2e` (`package.json:27`) e depois `playwright test`. O Playwright compila as Functions, sobe Auth, Firestore e Functions com `--project minhas-financas-local` (`playwright.config.ts:66-89`) e serve o build por `vite preview` em `127.0.0.1:5173` (`playwright.config.ts:90-105`). |
| Sucesso | Código 0 com todas as specs aprovadas. Localmente `retries` é 0 (`playwright.config.ts:46`), então qualquer falha é real. Equivale ao job "E2E" (`.github/workflows/quality-gate.yml:112-155`). |
| Observações | `build:e2e` grava no mesmo `dist/` do build de produção (`package.json:9,27`). Esse `dist/` nunca pode ser publicado (PR-AUTH-04). `E2E_START_EMULATORS=false` reaproveita emuladores já de pé (`playwright.config.ts:6`); eles precisam estar no projeto `minhas-financas-local`, que as specs forçam (`e2e/regression-smoke.spec.ts:20,45-48`). |

### RB-05 — Gate completo

| Campo | Conteúdo |
| --- | --- |
| Pré-condições | RB-01; portas livres. |
| Comando | `npm run verify:all` (`package.json:38`) = RB-02 + RB-03 + RB-04. |
| Sucesso | Código 0. A saída (comandos e resultados) é a evidência exigida por `regression-release-gate` no fechamento de milestone. |

### RB-06 — Emuladores para desenvolvimento

| Campo | Conteúdo |
| --- | --- |
| Pré-condições | RB-01. Nunca iniciar emulador sem `--project minhas-financas-local`. |
| Comandos | `npm run emulators` (Firestore + Functions, compila antes; `package.json:19`) · `npm run emulators:firestore` (só Firestore; `package.json:17`) · com Auth, igual ao E2E: `npm --prefix functions run build && firebase emulators:start --only auth,firestore,functions --project minhas-financas-local` (`playwright.config.ts:71`). |
| Sucesso | A Emulator UI responde em `http://127.0.0.1:4000` com os serviços pedidos. As portas vêm de `firebase.json:59-78`, com `singleProjectMode: true`. |
| Frontend contra o Emulator | Única forma verificada: `npm run test:e2e:ui` (`package.json:29`), opcionalmente com `E2E_SERVER=dev` para servidor com HMR (`playwright.config.ts:21-24,96-98`). As duas injetam as variáveis do Emulator. Não usar `npm run dev` com a configuração local (§2). |
| Observações | `npm run emulators:functions` (`package.json:18`) sobe só as Functions: sem o emulador do Firestore, o Admin SDK das funções emuladas sai para o Firestore real do projeto `minhas-financas-local`. Não usar; use `npm run emulators`. Para encerrar, use Ctrl+C; se sobrar processo, RB-09. |

### RB-07 — Uma suíte isolada no Emulator

| Campo | Conteúdo |
| --- | --- |
| Pré-condições | RB-01; portas 8080 e 9099 livres. |
| Comando | `firebase emulators:exec --only auth,firestore --project minhas-financas-local "npm run test:rules:m4"`, na mesma forma de `predeploy:rules` (`package.json:21`). Suítes disponíveis: `test:rules:goals` (`package.json:33`), `test:rules:investments` (`:34`), `test:rules:investment-domain` (`:35`), `test:rules:investment-m3` (`:39`), `test:rules:m4` (`:40`), `test:rules:adjacent` (`:41`), `test:tools:limpeza` (`:32`) e `functions:test:integration:emulator` (`:16`). As 6 de Rules de uma vez: `npm run predeploy:rules` (`package.json:21`), só local apesar do nome. |
| Sucesso | Código 0, sem testes pulados. |
| Observações | Fora do `emulators:exec`, as suítes de Rules e a guarda falham de imediato por falta de `FIRESTORE_EMULATOR_HOST` (`tests/firestore/goals.rules.integration.test.mjs:21-23`; `tests/firestore/adjacent-modules.rules.integration.test.mjs:42-44`; `tests/tools/limpar-investimentos.guard.test.mjs:24-25`). É o comportamento esperado. |

### RB-08 — Investigar falha de E2E

| Campo | Conteúdo |
| --- | --- |
| No CI | Baixar o artefato `playwright-report` (pastas `playwright-report/` e `test-results/`, retido por 7 dias; `.github/workflows/quality-gate.yml:157-165`), por exemplo com `gh run download <RUN_ID> -n playwright-report`. No CI há relatório HTML, trace na primeira nova tentativa, screenshot na falha e vídeo retido na falha (`playwright.config.ts:46-56`). Abrir com `npx playwright show-report playwright-report` e `npx playwright show-trace <arquivo trace.zip em test-results/>`. |
| Local | Trace, screenshot e vídeo ficam desligados fora do CI (`playwright.config.ts:54-56`). Reproduzir uma spec: `npm run build:e2e && npx playwright test e2e/<spec>.spec.ts`. Depuração interativa: `npm run test:e2e:ui` (`package.json:29`). |
| Sinais conhecidos | "Page crashed" ou "Target crashed" costumam indicar falta de memória (`playwright.config.ts:57-64,72-81`). Um teste que passou só na segunda tentativa do CI (`retries: 2`) é instável e precisa ser tratado (REL-10). |
| Sucesso | Causa-raiz identificada e corrigida no código ou no teste, sem aumentar timeout, sem `skip` e sem afrouxar asserção. |

### RB-09 — Liberar portas locais

| Campo | Conteúdo |
| --- | --- |
| Pré-condições | Confirmar que nenhum processo que precise continuar usa as portas: o comando mata qualquer ouvinte com `kill -9`. |
| Comando | `npm run e2e:kill-ports` (portas 4000, 4400, 4500, 5001, 8080, 9099, 9150 e 5173; `package.json:30`). Variante: `npm run test:e2e:clean` (`package.json:31`). |
| Sucesso | `lsof -iTCP:<porta> -sTCP:LISTEN` não retorna nada para as portas acima. |

---

## 2. Runbooks proibidos ou obsoletos

Não executar. Onde houver substituto, ele está indicado.

| Runbook ou comando | Onde | Por que (evidência) | ID | Substituto |
| --- | --- | --- | --- | --- |
| `npm run deploy:firestore`, `deploy:functions`, `deploy:safe`, `deploy:hosting`, `deploy:webhook` | `package.json:22-26` | Alvo fixo `sistema-financeiro-pesso-20698`, que é também o ambiente de desenvolvimento. Os gates são parciais: `deploy:functions` só roda `verify:fast`; `deploy:hosting` e `deploy:webhook` só fazem build. Negados no harness | PR-PLAT-01, PR-REL-01; D-ORD-04 | RB-T01 (P6) |
| `firebase deploy` em qualquer forma; `npm --prefix functions run deploy` | `functions/package.json:12` | Sem gate; sem `--project`, cai no `default`, que é produção (`.firebaserc:3`) | ENTRY-19, REL-04 | RB-T01 |
| `npm --prefix functions run logs`; `firebase functions:log` | `functions/package.json:13` | Lê logs do projeto de produção, o que CLAUDE.md proíbe | PR-PLAT-01 | Logs de DEV/STAGING autorizado (P6/P7) |
| `npm --prefix functions run serve`, `shell`, `start` | `functions/package.json:9-11` | Sem `--project`, usam o `default` (produção). `serve` sobe só o emulador de Functions e `shell` executa funções localmente; chamadas do Admin SDK a serviços não emulados podem atingir o projeto real | ENTRY-19 | RB-06 |
| `npm run functions:test:integration` (sem Emulator) | `package.json:15` | Testes com `skip` condicional passam sem executar (`functions/src/creditCards/__tests__/failureObservability.integration.test.ts:46-50`). `goalProgressRebuild.integration.test.ts` não tem guarda e faz `recursiveDelete` no projeto de `GCLOUD_PROJECT` (`functions/src/investments/__tests__/goalProgressRebuild.integration.test.ts:28,35-38,53`) | REL-09, FIRE-13 | RB-03, RB-07 |
| `npm run dev` com a configuração local | `package.json:7`; `src/lib/firebase.ts:7-14,47-62` | Sem `VITE_USE_FIREBASE_EMULATORS=true`, o app se conecta ao projeto configurado no arquivo local, hoje o único projeto, que é produção | PR-PLAT-01 | RB-06 (`test:e2e:ui`, `E2E_SERVER=dev`) |
| `docs/investments/PRODUCTION_DEPLOYMENT_CHECKLIST.md` | — | OUTDATED. `npm run deploy:* --project <PROJETO>` não troca o alvo, porque o npm consome a flag (linhas 103 e 125; REL-03). Fala em "53 funções" contra 47 no HEAD (122, 129). Usa como evidência `firebase functions:secrets:access`, que **imprime o segredo** (61). A ordem canônica não tem backup e prevê um rollout de flag inexistente (20-25) | REL-03, FIRE-14, PR-DOCS-01 | RB-T01, RB-T02, [BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md) |
| `docs/investments/CASH_BACKFILL_RUNBOOK.md` | — | Manda operar por "Configurações › Cadastros › Operação do domínio patrimonial" (`docs/investments/CASH_BACKFILL_RUNBOOK.md:56`), superfície sem ponto de montagem (`src/components/SettingsView.tsx:741-752`) | REL-14 | RB-T04 |
| `docs/investments/TTL_MANIFEST.md` como procedimento | — | Ativação por loop `gcloud` manual (51-70). Cita `investment_audit_logs`, coleção inexistente (44, 118). OUTDATED | FIRE-08, RULES-13 | RB-T10 |
| `docs/investments/OPERATIONAL_LIMITS.md` | — | OUTDATED: cita constantes e callables que não existem no HEAD (34, 43) | REL-14 | — |
| `tools/investments/limpar-investimentos.mjs` | `tools/investments/limpar-investimentos.mjs:59,88,144-149,352,409` | Hard delete do ledger de investimentos e de transações, com override para o ID de produção. A suíte de guarda valida esse override como suportado (REL-02) | PR-PLAT-02 | Seed/reset só no Emulator (P6). O único uso permitido é a própria suíte de guarda dentro de RB-03 |
| `tools/staging/rehearsal.sh` | `tools/staging/rehearsal.sh:21-41,65,70` | Não existe projeto de staging (`.firebaserc:1-5`). O script chama `deploy:*` com `-- --project` sobre um alvo já fixado (REL-03). Os passos estão obsoletos: "53 funções" (72), histórico legado (91), `CASH_BACKFILL_RUNBOOK` (98), "flag ligada" (105), "seis coleções" e `investment_operation_leases` (139-142). Negado no harness | PR-PLAT-01, REL-03, FIRE-14 | RB-T01 (deploy em STAGING pelo CD, com smoke) |
| Área operacional de investimentos (`InvestmentOperationsPanel`) | `src/components/SettingsView.tsx:741-752` | Componente sem ponto de montagem; rebuild e backfill de investimentos e caixa não têm superfície | INV-05; D-15 | RB-T04 |
| Console, SDK, CLI ou ferramentas MCP do Firebase contra `sistema-financeiro-pesso-20698` | CLAUDE.md | Proibido a agentes em qualquer forma | — | Emulator (RB-06) |

---

## 3. Runbooks alvo (TARGET)

Nenhum destes procedimentos existe no HEAD. Cada um é criado e exercitado no milestone indicado e depois registrado em §4. Os donos são papéis, a nomear em [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) (DECISION D-21 para a identidade do fornecedor e do encarregado; D-28 para a escala de plantão).

| ID | Runbook | Milestone | Dono (papel) | Pré-requisitos | IDs |
| --- | --- | --- | --- | --- | --- |
| RB-T01 | Deploy por CD e rollback | P6 | Responsável de plataforma | E-01, E-04, E-12; D-19 | PR-REL-01, PR-PLAT-01, PR-AUTH-04 |
| RB-T02 | Rotação de segredo (inclui a chave Gemini) | E-00 imediato; procedimento geral em P6 (Stripe em P2) | Responsável de plataforma | E-05 | PR-AI-02, PR-BILL-05 |
| RB-T03 | Replay de webhook Stripe | P2 (idempotência e registro), P7 (fila, alerta, replay) | Responsável de billing | E-06, E-08 | PR-BILL-06, PR-BILL-01, PR-OBS-01 |
| RB-T04 | Reconciliação e rebuild financeiro por domínio | P3–P5 (rebuild por domínio), P7 (jobs com alerta) | Responsável do domínio financeiro | RB-T09 | PR-TX-04, PR-CC-04, INV-05, PR-OBS-01 |
| RB-T05 | Restore do Firestore | P7 | Responsável de plataforma | E-07, D-27 | PR-BKP-01 |
| RB-T06 | Suspensão de usuário e revogação de sessão | P1 (mecanismo), P7 (operação administrativa) | Suporte + segurança | D-06, D-10 | AUTH-09, PR-OBS-02, PR-ADMIN-01 |
| RB-T07 | Atendimento a solicitação de titular | P8 | Encarregado de dados | D-07, D-18, D-21, E-09 | PR-AUTH-01, PR-PRIV-01, PR-CR-05 |
| RB-T08 | Resposta a incidente | P7 | Coordenador de incidente | D-21, D-28, D-32, E-08 | PR-OBS-02, PR-OBS-01 |
| RB-T09 | Ações administrativas de suporte auditadas | P7 | Suporte | D-10, D-32 | PR-ADMIN-01 |
| RB-T10 | Alteração de política de TTL | P6 | Responsável de plataforma | E-07 | FIRE-08, RULES-13 |

### RB-T01 — Deploy por CD e rollback (P6)

- **CURRENT:** não há pipeline de deploy; o deploy sai da estação do desenvolvedor (`.github/workflows/quality-gate.yml` não tem job de deploy; `package.json:22-26`).
- **TARGET — deploy:**
  1. Merge em `main` por PR com os checks obrigatórios (E-12, §5).
  2. Um workflow de deploy com `needs` no `quality-gate` cria uma tag SemVer imutável e injeta a versão/SHA no bundle e nas Functions (REL-13).
  3. Deploy em STAGING pelo environment `staging`, com Workload Identity Federation, na ordem: índices (aguardar READY) → Rules → Functions → Hosting (build do ambiente).
  4. Smoke automatizado em STAGING: login, leitura, uma callable de escrita idempotente, tentativa de acesso cruzado entre tenants negada, evento de webhook de teste.
  5. Aprovação humana no environment `production` e promoção da **mesma** tag.
  6. Verificação pós-deploy: inventário de Functions igual ao contrato (E-01), Rules iguais ao commit e 30 min sem pico nos alertas (E-08).
- **TARGET — rollback:** reexecutar o workflow com a tag anterior (Functions, Rules, Hosting). Índices não são removidos no rollback sem conferir consumidores. Se houve escrita incorreta de dados, seguir o cenário 1 de [BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md#7-cenários-de-dr).
- **Sucesso:** a tag publicada é a tag aprovada, o smoke passa e o registro em §4 está completo.

### RB-T02 — Rotação de segredo

- **CURRENT:** os segredos são declarados por função (ver [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md#8-secret-manager-e-parâmetros)). A chave Gemini esteve embutida no bundle público no passado, sem rotação comprovada (PR-AI-02). Não há procedimento nem dono de rotação.
- **Ação imediata E-00** (D-ORD-06; fora do repositório, feita pelo titular da conta Google Cloud):
  1. Listar toda chave de IA que já esteve em arquivo local ou em bundle publicado.
  2. Criar uma chave nova por ambiente, restrita à Generative Language API e com quota.
  3. Gravar a chave como nova versão de `GOOGLE_AI_API_KEY` sem exibir o valor (por exemplo, `gcloud secrets versions add GOOGLE_AI_API_KEY --data-file=- --project=<PROJECT_ID>`).
  4. Revogar a chave antiga no provedor. É esse passo que elimina o risco. Até as funções montarem a nova versão, a chave revogada continua montada e as callables de IA falham na chamada ao provedor; `readApiKey` só recusa chave ausente ou curta (`functions/src/ai/callables.ts:107-116`).
  5. A versão do segredo é fixada no deploy da função. O redeploy das duas callables de IA é decisão e execução humanas; agentes não fazem deploy (CLAUDE.md).
  6. Registrar a evidência (data, identificador da chave revogada, restrições da nova, responsável) em [SECURITY_MODEL.md](SECURITY_MODEL.md).
- **TARGET — procedimento geral** (P6; segredos Stripe em P2): gerar a credencial nova no provedor, com test/live separados → adicionar a versão no Secret Manager do ambiente → deploy pelo CD → verificar em STAGING (checkout e entrega de webhook com código 200) → promover → desativar e destruir a versão antiga → revogar a credencial antiga no provedor.
- **Verificação:** só por metadados (`gcloud secrets versions list <NOME> --project=<PROJECT_ID>`); nunca `functions:secrets:access`.
- **Sucesso:** nenhuma versão antiga ativa, credencial antiga revogada, zero erro de autenticação com o provedor e registro atualizado (E-05).

### RB-T03 — Replay de webhook Stripe

- **CURRENT:** o webhook trata só `checkout.session.completed` (`functions/src/webhooks/stripe.ts:60`), não registra nem deduplica `event.id` (`functions/src/webhooks/stripe.ts:49-110`), ecoa `error.message` (`functions/src/webhooks/stripe.ts:53-57`) e não gera alerta. Não existe replay seguro: um reenvio pelo painel do Stripe reaplica o evento sem deduplicação nem controle de ordem.
- **TARGET (P2):** cada evento é registrado em `stripe_events` (id = `event.id`, tipo, `created`, status, tentativas, último erro, TTL), com processamento idempotente e ordenado por `event.created` ([BILLING_ENTITLEMENTS.md](BILLING_ENTITLEMENTS.md)). **(P7):** consulta paginada de falhas, alerta e ferramenta de replay auditada.
- **Procedimento TARGET:**
  1. O alerta de falha (E-08) leva aos eventos com status de falha em `stripe_events`, ou no painel do Stripe (endpoint › eventos com falha).
  2. Corrigir a causa (segredo, deploy ou bug) antes de qualquer reenvio.
  3. Reenviar o evento original, com o mesmo `event.id`, pelo painel ou API do Stripe, ou reprocessar pela ferramenta administrativa (RB-T09).
  4. `event.id` já processado vira no-op; evento mais antigo que o estado atual é ignorado com registro.
  5. Conferir que o estado de assinatura é igual ao do Stripe e que a auditoria foi gravada.
- **Sucesso:** zero eventos em falha e estado conciliado com o Stripe.

### RB-T04 — Reconciliação e rebuild financeiro por domínio

| Domínio | Ferramenta CURRENT | Como é acionada hoje | TARGET | Milestone |
| --- | --- | --- | --- | --- |
| Investimentos | `rebuildInvestmentProjections`, `recalculateInvestmentPosition`, `recalculateGoalInvestmentProgress`, `backfillInvestmentWorkspace` (`functions/src/investments/callables.ts:188-200,244-256`); `processInvestmentDriftScan` diário, que compara só projeções (`functions/src/crons/investmentDrift.ts:104-146,325-330`) | Painel sem ponto de montagem (`src/components/SettingsView.tsx:741-752`) | Deriva do ledger contra as posições em todos os tenants, com alerta; execução pela ferramenta auditada (RB-T09) | P4 (D-15), P7 |
| Caixa | `rebuildCashPeriods`, com simulação e saída de reconciliação, papel owner/admin e 100 chamadas/h (`functions/src/cash/rebuild.ts:55,111-115,117-245,247-262`) | Mesmo painel sem montagem | Projeção atualizada na callable autoritativa ou retry com cerca de versão; job de deriva de caixa com alerta | P3 (PR-TX-04, D-38), P7 |
| Cartões | `rebuildCardInvoicesForCard`, `recalculateCardLimit` (`functions/src/creditCards/callables.ts:163-187`) | Tela de cartões (`src/components/CreditCardsView.tsx:673-674`) | Cron com releitura transacional e cursor (PR-CC-04); reconciliação compras × faturas × limite com alerta | P4, P7 |
| Metas | `recalculateGoalInvestmentProgress` | Painel sem montagem | Job de deriva da projeção única de progresso | P5, P7 |
| Empréstimos, recebíveis, divisão, recorrentes | Nenhuma: os dados são gravados pelo cliente (PR-RULES-01) | — | Ledger ou eventos no backend, com rebuild idempotente | P3, P4, P7 |

- **Procedimento TARGET:**
  1. Executar em simulação e comparar com o valor exibido.
  2. Se houver divergência, investigar a causa (evento perdido, corrida, bug) antes de aplicar.
  3. Aplicar com motivo obrigatório e chave de idempotência, pela ferramenta auditada. A correção é sempre por evento compensatório ou reconstrução de projeção, nunca apagando histórico.
  4. Reconciliar de novo e registrar.
- **Sucesso:** reconciliação sem divergência e auditoria gravada.

### RB-T05 — Restore do Firestore (P7)

Procedimento completo, cenários, RPO/RTO e evidência em [BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md#6-runbook-de-restore). Só é válido depois de ensaiado em STAGING.

### RB-T06 — Suspensão de usuário e revogação de sessão

- **CURRENT:** não há suspensão, desativação nem revogação; nenhum trigger ou callable de conta em `functions/src/index.ts:13-37` (AUTH-09). As Rules já condicionam o acesso ao status do membership (`firestore.rules:10-15`).
- **TARGET:** P1 entrega o mecanismo (suspensão com revogação de sessão; §8 do plano). P7 entrega a operação administrativa com custom claim `platformAdmin` e registro em `admin_audit_logs` (PR-ADMIN-01).
- **Procedimento TARGET:**
  1. Registrar a solicitação: motivo, solicitante, evidência.
  2. O operador, com `platformAdmin` e MFA, chama a callable administrativa de suspensão (nome definido em P1; ver [AUTH_RBAC_WORKSPACES.md](AUTH_RBAC_WORKSPACES.md)). Ela desativa o usuário no Authentication, revoga os refresh tokens e marca os memberships como suspensos. As callables relêem o membership dentro da transação, então a recusa vale imediatamente no backend.
  3. Registrar em `admin_audit_logs` e comunicar o owner do workspace quando aplicável.
  4. A reativação segue o fluxo inverso, também auditado.
- **Sucesso:** usuário sem leitura nem escrita (teste de fumaça) e auditoria completa.

### RB-T07 — Atendimento a solicitação de titular (P8)

- **CURRENT:** não há canal do titular, exportação nem exclusão de conta (PR-AUTH-01, PR-PRIV-01).
- **Procedimento TARGET** (detalhes em [PRIVACY_LGPD.md](PRIVACY_LGPD.md)):
  1. Receber pelo canal do encarregado (D-21, E-09) e registrar data e prazo. O prazo legal é confirmado com o jurídico.
  2. Verificar a identidade por autenticação recente.
  3. Executar pela callable de exportação ou exclusão de P8:
     - workspace com o titular como único owner: eliminação do workspace;
     - workspace compartilhado: remoção do membership e anonimização do ator (D-07);
     - cancelamento da assinatura no Stripe;
     - bloqueio do que houver retenção legal (D-18).
  4. Responder ao titular e registrar a execução para que um restore futuro a reaplique ([BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md#9-lgpd-e-backups)).
- **Sucesso:** resposta dentro do prazo, execução auditada e registro disponível para reaplicação.

### RB-T08 — Resposta a incidente (P7)

Severidades, papéis, fluxo e playbooks (inclusive segredo exposto e incidente com dados pessoais) estão em [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md). Este documento fornece os procedimentos executáveis usados pelos playbooks de lá: RB-T02, RB-T03, RB-T04, RB-T05 e RB-T06.

### RB-T09 — Ações administrativas de suporte auditadas (P7, D-10)

- **CURRENT:** `isAdmin` é lido pelo cliente de `users/{uid}` (`src/contexts/AuthContext.tsx:55-61`), o painel é placeholder (`src/components/AdminDashboard.tsx:39,51,63`) e não há nenhuma callable administrativa. Hoje, qualquer suporte exigiria o console com credenciais amplas e sem registro (PR-ADMIN-01).
- **TARGET, se a D-10 decidir implementar:** custom claim `platformAdmin` concedido por script auditado, com MFA; callables de menor privilégio (consulta somente leitura de tenant e assinatura, execução de solicitação de titular, reatribuição de dados, disparo de rebuild e replay), cada uma gravando em `admin_audit_logs` (imutável, com Rules negando o cliente); acesso ao console só em break-glass registrado.
- **TARGET, se a D-10 decidir remover:** remover o painel e a leitura de `isAdmin`. As operações acima ficam restritas a break-glass documentado.
- **Procedimento TARGET:** chamado registrado → justificativa → ação pela callable → registro em `admin_audit_logs` → comunicação ao solicitante.

### RB-T10 — Alteração de política de TTL (P6)

- **CURRENT:** ativação manual por coleção (`functions/src/shared/retention.ts:17-20`); nenhum `fieldOverrides` (`firestore.indexes.json:806`).
- **Procedimento TARGET:**
  1. PR que altera os `fieldOverrides` com `ttl: true`, junto com o teste que os compara com a lista do código.
  2. Deploy em STAGING pelo CD e conferência com `gcloud firestore fields ttls list --project=<STAGING>`.
  3. Confirmar que nenhuma coleção de ledger, fato financeiro ou auditoria recebeu TTL.
  4. Promoção para PROD com aprovação.
- **Atenção:** o que a TTL apaga só volta por PITR ou backup ([BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md)).

---

## 4. Registro de execução

Toda execução de RB-T01…RB-T10 em DEV, STAGING ou PROD e todo exercício (drill) são registrados aqui. Nenhuma execução existe na baseline.

| Data | Runbook | Ambiente | Executor | Motivo ou chamado | Resultado | Evidência |
| --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — | — |

---

## 5. Registro E-12 — GitHub

Registro canônico de E-12 (resumido em [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md#16-registro-de-configuração-externa)). Todos os itens estão em **EXTERNAL CONFIGURATION REQUIRED**, com estado `NÃO VERIFICADO`. A verificação é somente leitura. A auditoria encontrou `HEAD == origin/main`, 29 de 64 commits chamados "Salvando" e um único merge (REL-06).

| ID | Item | Valor esperado | Estado | Verificação (somente leitura) | Data | Responsável |
| --- | --- | --- | --- | --- | --- | --- |
| E-12 | Proteção de `main` | PR obrigatório com revisão; sem push direto nem force-push | NÃO VERIFICADO | `gh api repos/{owner}/{repo}/branches/main/protection` | — | a designar |
| E-12 | Checks obrigatórios | "Build e testes unitários (Node 22)", "Build e testes unitários (Node 24)", "Integração e Firestore Rules", "E2E" (`.github/workflows/quality-gate.yml:28,75,113`) | NÃO VERIFICADO | idem (`required_status_checks`) | — | a designar |
| E-12 | Revisão por CODEOWNERS | `CODEOWNERS` versionado para `firestore.rules`, `firestore.indexes.json`, `firebase.json`, `functions/src`, `package.json`, com revisão obrigatória | NÃO VERIFICADO | idem (`require_code_owner_reviews`) e leitura do arquivo | — | a designar |
| E-12 | Environments de deploy | `staging` e `production` com revisores obrigatórios e restrição de branch/tag | NÃO VERIFICADO | `gh api repos/{owner}/{repo}/environments` | — | a designar |
| E-12 | Segredos do repositório | nenhuma credencial de PROD; deploy por Workload Identity Federation | NÃO VERIFICADO | `gh secret list`; `gh secret list --env production` (só nomes) | — | a designar |
| E-12 | Secret scanning e Dependabot | ativos | NÃO VERIFICADO | `gh api repos/{owner}/{repo}` (`security_and_analysis`) | — | a designar |
