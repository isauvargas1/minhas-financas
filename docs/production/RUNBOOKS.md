# Runbooks operacionais

Este documento reúne os procedimentos operacionais do Minhas Finanças em três grupos: os válidos hoje, os proibidos ou obsoletos (com o motivo) e os alvo, a criar nos milestones. Baseline auditada: `main` @ HEAD `9c3ab46`. As lacunas usam os IDs do [plano mestre](PRODUCTION_READINESS_PLAN.md#6-registro-de-blockers), que classifica os runbooks antigos de `docs/investments/` como OUTDATED ([§13](PRODUCTION_READINESS_PLAN.md#13-documentação-existente)). O gate de conteúdo, dono e exercício dos runbooks é a skill `observability-incident-readiness`; o gate dos procedimentos de plataforma (deploy, segredos, restore) é `firebase-production-readiness`. Os gates locais abaixo são a evidência que `regression-release-gate` exige.

> **Regras que valem para todos os runbooks**
> - Nenhum runbook válido toca produção. Firebase durante o desenvolvimento só pelo Emulator, com o projeto `minhas-financas-local`, ou por DEV/STAGING autorizado explicitamente pelo usuário (CLAUDE.md).
> - Agentes não fazem deploy, push, merge nem acesso ao projeto `sistema-financeiro-pesso-20698`, nem leem `.env*` ou segredos. As negações do harness estão em `.claude/settings.json`.
> - Nenhum artefato de P1–P5 é implantado em projeto remoto antes do fechamento de P6 (D-ORD-04).
> - **P6-A (D-19, D-ORD-09, 2026-11-17):** existe uma única produção online, `sistema-financeiro-pesso-20698`, permanente. A publicação nela é só do proprietário, pelo guard (RB-12) e depois do G0; RB-12 a RB-16 são os únicos roteiros que tocam a produção, e nenhum é executado por agentes.
> - Falha de gate não se contorna com `skip`/`only`, timeout maior ou mock excessivo (CLAUDE.md).

Rótulos: **CURRENT**, **TARGET**, **GAP**, **DECISION**, **EXTERNAL CONFIGURATION REQUIRED**.

---

## 1. Runbooks válidos hoje (CURRENT)

Todos foram conferidos em `package.json`, `functions/package.json`, `playwright.config.ts`, `firebase.json` e `.github/workflows/quality-gate.yml` no HEAD. Nenhum exige login na CLI do Firebase nem segredo: o CI roda os mesmos comandos sem credenciais (`.github/workflows/quality-gate.yml:7-8`).

### RB-01 — Instalação do ambiente local

| Campo | Conteúdo |
| --- | --- |
| Pré-condições | Node 24 (`.nvmrc`, `.node-version`; `functions/package.json:15-17`). O CI também valida o Node 22 (`.github/workflows/quality-gate.yml:37`). Java 21 para os emuladores (`.github/workflows/quality-gate.yml:137-140,177-180`). Firebase CLI 15.32.1, a versão validada no gate; o CI a fixa desde a P5-F.1-R3.2 (`.github/workflows/quality-gate.yml:148-151,188-191`). |
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
| Comando | `npm run test:integration:emulator` (`package.json:54`). Sobe Auth e Firestore com `--project minhas-financas-local` e executa, em cadeia (`&&`), a integração das Functions com `FIRESTORE_EMULATOR_HOST` e `GCLOUD_PROJECT` locais (`package.json:32`), as guardas das ferramentas de limpeza e de contas e as 20 suítes de Rules (`test:rules:*`; a 20ª, `test:rules:transactions-reads`, desde o P5-GATE-FINAL). A cadeia fica entre os passos do marco de fase completa (`tools/integracao/marco-da-fase.mjs`: `iniciar` antes do `emulators:exec`, `concluir` como último passo da cadeia e `conferir` depois dele; P5-F.1-R3.2, EST-10). |
| Sucesso | Código 0, a linha `[integração] fase completa: todas as suítes rodaram até o fim` **e** nenhum teste pulado no resumo do `node --test`. Um `skip` indica execução sem Emulator (FIRE-13, INV-16, REL-09). O `firebase emulators:exec` trata SIGINT, SIGTERM, SIGHUP e SIGQUIT como desligamento e sai com 0 mesmo com a cadeia interrompida; sem o marco fechado, o `conferir` reprova a fase (saída 1). Equivale ao job "Integração e Firestore Rules" (`.github/workflows/quality-gate.yml:122-160`). |

### RB-04 — E2E

| Campo | Conteúdo |
| --- | --- |
| Pré-condições | RB-01 (incluindo o Chromium); portas 4000, 4400, 4500, 5001, 8080, 9099, 9150, 9199 (Storage, P6-A), 9299, 9499 e 5173 livres (RB-09). |
| Comando | `npm run test:e2e` (`package.json`): `build:e2e` e depois `node tools/e2e/executar-em-grupos.mjs`, o E2E oficial em grupos (P5-F.1-R3.2). O executor compila as Functions, lista a suíte (`playwright test --list`) e a roda em grupos de arquivos (`--shard=i/N`; N = `E2E_SHARDS`, padrão 3, de 1 a 12), um depois do outro. Em cada grupo, o Playwright sobe Auth, Firestore e Functions com `--project minhas-financas-local`, serve o build por `vite preview` em `127.0.0.1:5173` e, no fim, desliga o Emulator com SIGTERM (`gracefulShutdown`, `playwright.config.ts`). Entre os grupos, o executor espera as portas livres por até 60 s, sem encerrar processo nenhum (`E2E_PORT_WAIT_MS` só encurta esse prazo, para os testes do executor). Argumentos depois de `--` vão para cada grupo (por exemplo, `npm run test:e2e -- e2e/<spec>.spec.ts`). Só são aceitos os que escolhem o que roda e o rastro: arquivos e linhas, `-g`/`--grep`, `--grep-invert`, `--project`, `--trace`, `-x` e `--max-failures`; qualquer outro é recusado, como `--shard`, `--last-failed`, `--list`, `--retries`, `--repeat-each`, `--timeout`, `--workers`, `--config`, `--update-snapshots`, `--debug` e as formas curtas, também combinadas (`-xj2`). |
| Sucesso | Código 0 e, no fim, `[e2e em grupos] ok: N testes, cada um uma vez, todos passaram`: cada teste da lista completa rodou exatamente uma vez, numa tentativa só, e passou. Teste que não rodou, repetido, instável, ignorado, grupo com saída diferente de 0 ou porta que não liberou reprovam a execução. `retries` é 0 também no CI e `forbidOnly` vale sempre (`playwright.config.ts`), então qualquer falha é real. Equivale ao job "E2E" (`.github/workflows/quality-gate.yml`). |
| Observações | Por que em grupos: numa sessão só, o emulador de Functions mantinha um processo por função chamada e a suíte inteira passava de 14 GB, com processo a frio e navegador morto por falta de memória (RR-R31-07). Por grupo ficam o relatório JSON (`test-results/e2e-grupos/grupo-<n>.json`), a saída e os logs do Emulator (`test-results/grupo-<n>/`, com `firebase-debug.log` e `firestore-debug.log`) e, no CI, o HTML (`playwright-report/grupo-<n>/`). `build:e2e` grava no mesmo `dist/` do build de produção (`package.json`): esse `dist/` nunca pode ser publicado (PR-AUTH-04), e um `npm run build` depois dele o substitui, então rode o E2E sempre pelo `npm run test:e2e`, que refaz o build. `E2E_START_EMULATORS=false` reaproveita emuladores já de pé (`playwright.config.ts`), e os grupos passam a dividir esse Emulator, sem o isolamento; eles precisam estar no projeto `minhas-financas-local`, que as specs forçam (`e2e/regression-smoke.spec.ts`). Interrupção: o Playwright de cada grupo roda num grupo de processos próprio; Ctrl+C, SIGTERM, SIGHUP ou SIGQUIT (Ctrl+\) enviados ao executor viram um SIGINT ao Playwright do grupo em curso, que desliga o Emulator pelo caminho limpo; o sinal recebido entre os grupos ou depois do último também conta; os grupos seguintes não rodam e a saída é 128 + o sinal (130, 143, 129 ou 131), nunca "ok" (EST-02, EST-11). Cada sinal recebido vira um SIGINT: o segundo, depois de 1 s, força a saída do Playwright e pode deixar o Emulator de pé (RR-R32-04). Para interromper, use Ctrl+C ou mande o sinal ao grupo de processos (`kill -TERM -- -<pgid>`) ou ao próprio executor (`node tools/e2e/executar-em-grupos.mjs`); um SIGTERM só ao `npm` de cima encerra o `npm` e o `sh`, mas deixa o executor rodando, órfão. Com o sinal ao grupo inteiro, o `npm` e o `sh` saem na hora, e o executor termina o desligamento sozinho (até os 60 s do `gracefulShutdown`): espere a linha final do executor (`[e2e em grupos] FALHOU`) ou as portas livres. Depois de qualquer interrupção, confira as portas (RB-09) antes da próxima execução: o executor só começa com elas livres. |

### RB-05 — Gate completo

| Campo | Conteúdo |
| --- | --- |
| Pré-condições | RB-01; portas livres. |
| Comando | `npm run verify:all` (`package.json`) = RB-02 + RB-03 + RB-04, com o E2E oficial em grupos. |
| Sucesso | Código 0, com a evidência de cada fase até o fim: os resumos do `node --test` de cada suíte de unidade, `[integração] fase completa: todas as suítes rodaram até o fim` (RB-03) e `[e2e em grupos] ok: N testes, cada um uma vez, todos passaram` (RB-04). A saída (comandos, contagens e resultados) é a evidência exigida por `regression-release-gate` no fechamento de milestone. |

### RB-06 — Emuladores para desenvolvimento

| Campo | Conteúdo |
| --- | --- |
| Pré-condições | RB-01. Nunca iniciar emulador sem `--project minhas-financas-local`. |
| Comandos | `npm run emulators` (Firestore + Functions, compila antes; `package.json:19`) · `npm run emulators:firestore` (só Firestore; `package.json:17`) · com Auth, igual ao E2E: `npm --prefix functions run build && firebase emulators:start --only auth,firestore,functions --project minhas-financas-local` (`playwright.config.ts:71`). |
| Sucesso | A Emulator UI responde em `http://127.0.0.1:4000` com os serviços pedidos. As portas vêm de `firebase.json:69-87`, com `singleProjectMode: true`. |
| Frontend contra o Emulator | Única forma verificada: `npm run test:e2e:ui` (`package.json:29`), opcionalmente com `E2E_SERVER=dev` para servidor com HMR (`playwright.config.ts:21-24,96-98`). As duas injetam as variáveis do Emulator. Não usar `npm run dev` com a configuração local (§2; estado anterior à P6-A: hoje `npm run dev` usa só o Emulator, RB-11). |
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
| No CI | Baixar o artefato `playwright-report` (pastas `playwright-report/` e `test-results/`, com o relatório, a saída e os logs do Emulator de cada grupo; retido por 7 dias; `.github/workflows/quality-gate.yml`), por exemplo com `gh run download <RUN_ID> -n playwright-report`. No CI há relatório HTML por grupo, rastro e vídeo retidos na falha e screenshot na falha (`playwright.config.ts`). Abrir com `npx playwright show-report playwright-report/grupo-<n>` e `npx playwright show-trace <arquivo trace.zip em test-results/grupo-<n>/>`. O resumo do executor, no fim do log do job, diz qual grupo e qual teste falharam. |
| Local | Trace, screenshot e vídeo ficam desligados fora do CI (`playwright.config.ts`). Reproduzir uma spec pelo procedimento oficial: `npm run test:e2e -- e2e/<spec>.spec.ts`. Depuração interativa: `npm run test:e2e:ui` (`package.json`). Para o instante de uma falha no Emulator, ver `test-results/grupo-<n>/firebase-debug.log`. |
| Sinais conhecidos | "Page crashed" ou "Target crashed" costumam indicar falta de memória (`playwright.config.ts`). Não há nova tentativa automática, nem no CI: um teste instável aparece como falha e precisa ser tratado (REL-10). "portas ainda em uso depois do grupo" quer dizer que o Emulator do grupo não desligou: ver o log do grupo e RB-09. |
| Sucesso | Causa-raiz identificada e corrigida no código ou no teste, sem aumentar timeout, sem `skip` e sem afrouxar asserção. |

### RB-09 — Liberar portas locais

| Campo | Conteúdo |
| --- | --- |
| Pré-condições | Confirmar que nenhum processo que precise continuar usa as portas: o comando mata qualquer ouvinte com `kill -9`. |
| Comando | `npm run e2e:kill-ports` (portas 4000, 4400, 4500, 5001, 8080, 9099, 9150, 9199 (Storage, P6-A), 9299, 9499 e 5173, as mesmas que o E2E em grupos confere entre os grupos; `package.json:46`). Variante: `npm run test:e2e:clean` (`package.json:47`). |
| Sucesso | `lsof -iTCP:<porta> -sTCP:LISTEN` não retorna nada para as portas acima. |

### RB-10 — Reconciliar saldos de contas no Emulator (P3-J)

| Campo | Conteúdo |
| --- | --- |
| Pré-condições | RB-06 (Emuladores em execução) e `FIRESTORE_EMULATOR_HOST` definido; o projeto é `minhas-financas-local`. A ferramenta recusa rodar sem `FIRESTORE_EMULATOR_HOST` ou com o ID do projeto de produção. |
| Comando | `node tools/accounts/reconciliar-contas.mjs --workspace=<id>` confere, por conta, `balanceCents` × soma dos movimentos em `cash_account_movements` e não altera nada (dry-run, padrão). Com `--reparar`, corrige os saldos divergentes. |
| Sucesso | Código 0: consistente (ou reparado). Código 2: divergência encontrada no dry-run. Código 1: erro. |
| Observações | Ferramenta só local (D-30); a reconciliação agendada de produção fica para a P7. Não cobre divisão de contas nem investimentos, que ainda não movimentam as contas (P4-C e demais); a recorrência registrada como paga move a conta no mesmo commit (P4-B, D-30); o pagamento de fatura de cartão move a conta desde a P4-A. |

---

### RB-11 — Desenvolvimento local contra o Emulator (`npm run dev`, P6-A)

| Campo | Conteúdo |
| --- | --- |
| Pré-condições | RB-01; `firebase-tools@15.32.1` e Java 11+ instalados. Nenhuma variável `VITE_*` no shell (o build recusa). |
| Comandos | `npm run dev`: compila as Functions e roda `firebase emulators:exec --only auth,firestore,functions --project minhas-financas-local --ui` com o Vite no perfil `local` dentro dele (`tools/ambiente/dev.mjs`). `npm run dev -- --plano` só mostra os comandos. `npm run dev -- --sem-dados-salvos` começa vazio e não grava. |
| Sucesso | App em `http://localhost:3000`, conectado só ao Emulator (o módulo `@fenix/emuladores` confere o projeto `minhas-financas-local` antes de conectar). Interface do Emulator na porta 4000. Os dados sintéticos ficam em `.fenix-emulador/` (fora do Git) e voltam na próxima execução. |
| GitHub Codespaces | Encaminhar só a porta 3000, que fica privada por padrão (só a sua conta abre). No perfil `local`, o navegador fala apenas com a porta do Vite: o proxy de mesma origem repassa Auth, Firestore e Functions ao Emulator. Não tornar a porta pública. O E2E (perfil `e2e`) não usa o proxy: conecta direto às portas do Emulator em `127.0.0.1`, a topologia em que foi validado. |
| Observações | `npm run dev` **não** fala mais com a produção: a configuração web vem do perfil (`config/ambientes.json`, `emulador.web`), nunca de `.env*`. A linha "`npm run dev` com a configuração local" da §2 descreve o estado anterior à P6-A. |

### RB-12 — Primeira publicação controlada (G0)

Executada **só pelo proprietário**, numa estação com login de pessoa (`firebase login`, `gcloud auth login`). Agentes não executam nenhum passo. Cada passo depende do anterior; uma recusa do guard não se contorna.

1. **Pré-requisitos externos do G0** ([LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md) §0): G0.11 (parte A do E-00), G0.12 (chave web restrita e Authentication só com Google), G0.13 (alertas mínimos de custo e de erro e IAM mínimo), G0.10 (backup ativo, RB-14) e G0.7 (decisão sobre as 9 vulnerabilidades moderadas das Functions). Registrar cada um no [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md) §16.
   - **Pré-voo somente leitura (P6-B, RB-17), antes de publicar:** `--parte funcoes` e `--parte contas`, com o resultado anotado no §4. Função antiga fora da composição (`excluidaDaPublicacao` ou `foraDoCodigo`) é saneada pelo RB-17 antes do primeiro dado real; contas ativas sem autorização ficam registradas (só contagem e referências mascaradas) para a conferência do passo 6.
2. **Contrato:** preencher em `config/ambientes.json` o `producao.web` (configuração web pública do app, do console do Firebase) e o `producao.liberacao` (`{"gate":"G0","autorizadoPor":"…","autorizadoEm":"AAAA-MM-DD","referencia":"…"}`). `producao.segredos` fica `["GOOGLE_AI_API_KEY"]` (IA incluida por decisao de 2026-11-23; Stripe fora da publicacao); `producao.appCheck` fica `null` até a E-02.
3. **Versão:** commit dessas mudanças e tag `vAAAA.MM.DD` (ou `vX.Y.Z`) no próprio commit, com o worktree limpo. Exige autorização expressa do proprietário para commit e tag.
4. **Gate local:** `npm run verify:all` com saída 0 nesse commit e `regression-release-gate` `PASS` (G0.14).
5. **Publicação, nesta ordem** (homologação independente; os deploys não executam testes automaticamente):
   1. `npm run deploy:firestore -- --project sistema-financeiro-pesso-20698 --confirmar sistema-financeiro-pesso-20698` (Rules e índices);
   2. `npm run deploy:storage -- --project … --confirmar …` (bucket fechado). Se o projeto não tiver o bucket padrão do Storage, o comando falha sem efeito: o app não usa o Storage, então registre e siga para o 5.3 (não é caso de rollback);
   3. `npm run deploy:functions -- --project … --confirmar …` (o guard lista as funções deixadas de fora por segredo não registrado);
   4. `npm run deploy:hosting -- --project … --confirmar …` (faz o `build:release` e a varredura de publicação).
6. **Primeiro acesso:** adicionar o próprio convite (RB-13), entrar com a conta Google do proprietário e conferir o fluxo principal (criar workspace, lançar, ver Relatórios). Se a conta do proprietário já existia (perfil antigo), o mesmo login a reconhece com o convite: a autorização é gravada no perfil e o convite fica vinculado ao `uid`. Rodar RB-15 para provar que as Rules publicadas são as testadas e repetir o pré-voo (RB-17) com `--parte tudo`: `autorizados` = 1 (o proprietário), `revogadosAindaAtivos` = 0 e nenhuma função fora da composição. Só então o G0 recebe o aceite do proprietário (G0.18).
7. **Registro:** anotar no §4 deste documento a data, a tag, os alvos publicados e as funções deixadas de fora.

Se qualquer passo falhar depois do 5.1 (salvo o caso do bucket no 5.2), seguir RB-16 (rollback). Nunca publicar com `firebase deploy` direto: o gancho de predeploy recusa sem `FENIX_PUBLICACAO` do guard. O guard também recusa qualquer `functions/.env*` além de `.env.example` e `.env.local` (o firebase-tools publicaria essas variáveis nas Functions) e `GOOGLE_APPLICATION_CREDENTIALS` no ambiente (chave baixada, E-04).

### RB-13 — Convites do piloto (adicionar, listar, revogar)

| Campo | Conteúdo |
| --- | --- |
| Quem | Só o proprietário, com credenciais padrão do Google (`gcloud auth application-default login` e, se o Authentication pedir projeto de cota, `gcloud auth application-default set-quota-project sistema-financeiro-pesso-20698`). A ferramenta não lê nem imprime credencial. |
| Produção | `node tools/piloto/acesso-piloto.mjs adicionar --project sistema-financeiro-pesso-20698 --confirmar sistema-financeiro-pesso-20698 --email <e-mail>` · `listar --project … --confirmar …` · `revogar --project … --confirmar … --email <e-mail> --motivo <código>` (`fim-do-piloto`, `pedido-do-titular`, `uso-indevido` ou `convite-errado`; sem texto livre) · `remover --project … --confirmar … --email <e-mail>` (só convite já revogado). Recusa sem a liberação G0 registrada, sem `--confirmar` ou com variável `*_EMULATOR_HOST` no ambiente. |
| Emulator | O mesmo com `--project minhas-financas-local` e `FIRESTORE_EMULATOR_HOST`/`FIREBASE_AUTH_EMULATOR_HOST` em loopback (dentro do `firebase emulators:exec`). |
| Efeito | `adicionar` cria ou reativa o convite (`pilot_access/{sha256(e-mail)}`), sem duplicar; no G0 recusa um segundo convite ativo (só o do proprietário). O bootstrap que encontra o perfil sem autorização (conta nova ou pré-existente) valida o convite do e-mail verificado e, na mesma transação, grava `accessStatus: "granted"` no perfil, vincula o convite à conta (`uid`, uso único) e audita `account.access_granted`. `revogar` (P6-B) age sobre a conta vinculada pelo `uid` (mesmo que o e-mail dela tenha mudado): numa transação marca o convite e grava `accessStatus: "revoked"` no perfil (auditoria `account.access_revoked`), o que já recusa Rules e callables na requisição seguinte, mesmo com ID token vigente; depois suspende a conta (Auth desativado, sessões revogadas, auditoria `account.suspended`). Convite nunca usado não autorizou conta nenhuma: só ele é marcado, e uma conta alheia que hoje tenha esse e-mail não é tocada (sem autorização própria, ela já não opera). A revogação parte do **e-mail do convite** (o que aparece no `listar`, com `vinculado=sim` quando já autorizou uma conta), não do e-mail atual da conta: se a pessoa trocou de e-mail, revogue pelo e-mail com que foi convidada. Os dados financeiros ficam intactos e nada é apagado. Toda mudança na lista grava auditoria append-only em `platform_audit_events` (`pilot_access.granted`, `reactivated`, `revoked`, `removed`), pelo id do convite e sem o e-mail. Se o `revogar` disser que o convite foi revogado mas falhar ao suspender (erro do Authentication), repita o comando, que é idempotente e refaz os passos do Auth, e confira no console (Authentication › Usuários) que a conta está desativada. |
| Regras do piloto | O convite vale para o e-mail verificado da conta Google. **P6-B: a autorização é do perfil e negativa por padrão.** Conta pré-existente (perfil e membership ativos de antes da P6-B) não lê, não lista, não grava e não chama nenhuma callable até um login com convite válido; a que já foi autorizada continua entrando sem reler o convite, até ser revogada. Nenhum e-mail ou UID entra no código ou no repositório. |
| Reentrada | Depois de um `revogar` completo a conta fica suspensa: reativar o convite (`adicionar`) não a reabre, e reativar conta suspensa não tem ferramenta nesta fase (PR-ADMIN-01, P7). Se só a primeira etapa do `revogar` aconteceu (perfil `revoked`, conta ainda ativa), um convite reativado e vinculado ao mesmo `uid` a reautoriza no próximo login; o `revogar` repetido conclui a suspensão. |
| Retenção | Convite revogado é removido (`remover`) em até 30 dias, ou na hora a pedido do titular; a conta suspensa e os dados dela seguem o fluxo de exclusão do titular (RB-T07). A saída da ferramenta tem e-mails: não copiá-la para tickets, CI ou chats. |
| Conta recriada | Se a conta do Authentication de um convidado for apagada e recriada (outro `uid`), o convite continua preso ao `uid` antigo e o `adicionar` responde "já ativo": para liberar, `revogar`, `remover` e `adicionar` de novo. Rodar a ferramenta uma vez por vez (o limite de um convite ativo do G0 é conferido na transação; dois `adicionar` simultâneos não são o uso previsto). |
| Contas sem convite | Quem tenta entrar sem convite fica com um usuário no Authentication sem perfil `users/{uid}`. Antes do G1, conferir semanalmente no console (Authentication › Usuários) e excluir os que não têm convite nem perfil (G1.14). |

### RB-14 — Backup e restauração do Firestore da produção

| Passo | Comando (só o proprietário) | Observação |
| --- | --- | --- |
| Ver o plano | `node tools/operacao/backup-firestore.mjs plano --project sistema-financeiro-pesso-20698` | Só imprime os comandos do gcloud. |
| Ativar | `… ativar --project … --confirmar …` | Liga o PITR (7 dias) e cria os agendamentos diário (retenção de 7 dias) e semanal de domingo (14 semanas), só o que faltar. Custo: armazenamento do PITR e dos backups, cobrado à parte (exige faturamento ativo). Permissões: `datastore.databases.update`, `datastore.backupSchedules.create`. |
| Conferir (todo dia) | `… conferir --project …` | Só leitura. Sai 1 se o PITR estiver desligado, faltar um agendamento, a retenção mudar, não houver backup `READY` com até 36 h ou houver backup em falha. É o acompanhamento de falhas até o alerta do G1.9. |
| Ensaiar a restauração | `… ensaiar-restauracao --project … --confirmar … --backup projects/<id>/locations/<local>/backups/<id> --destino restauracao-ensaio-AAAAMMDD` | Sempre num banco **novo**; o `(default)` nunca é destino. O banco restaurado tem dados reais: acesso só do proprietário (nenhum papel novo no IAM), sem exportar nem copiar. Conferir pelo console (contagens das coleções principais) e registrar no [BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md) §10 a hora de criação e a de remoção. Depois de qualquer restauração usada de verdade, reaplicar as eliminações feitas desde o backup (`PRIVACY_LGPD.md` §6.4). |
| Remover o ensaio | `… remover-ensaio --project … --confirmar … --destino restauracao-ensaio-AAAAMMDD` | Só bancos `restauracao-ensaio-*`. O banco restaurado contém dados reais: removê-lo no mesmo dia. |
| Ensaio local | `npm run test:operacao:restauracao` | Amostra sintética no Emulator: exporta, importa e compara o SHA-256 canônico de todos os documentos; uma alteração de um centavo precisa ser detectada. Roda no `verify:all`, no `predeploy:check` e no CI. |

### RB-15 — Conferir as Rules publicadas

1. Com `gcloud auth login` do proprietário, baixar o ruleset em uso (só leitura): `TOKEN=$(gcloud auth print-access-token)`; `curl -sH "Authorization: Bearer $TOKEN" -H "x-goog-user-project: sistema-financeiro-pesso-20698" https://firebaserules.googleapis.com/v1/projects/sistema-financeiro-pesso-20698/releases/cloud.firestore` devolve o `rulesetName`; o mesmo `curl` em `https://firebaserules.googleapis.com/v1/<rulesetName>`, com a saída em `firestore-publicado.json`. Para o Storage, a release é `firebase.storage/<bucket>`. O cabeçalho `x-goog-user-project` indica o projeto de cota exigido com credencial de usuário.
2. Comparar com o commit publicado: `node tools/operacao/comparar-rules.mjs --servico firestore --publicado firestore-publicado.json` (e `--servico storage`). Saída 0: idênticas. Saída 1: diferentes, com a primeira linha divergente; tratar como incidente (RB-16) e republicar pelo guard.
3. Apagar os arquivos baixados depois da comparação; não versioná-los.

### RB-16 — Rollback e incidente do piloto

| Situação | Ação |
| --- | --- |
| Publicação com defeito (Hosting, Functions, Rules) | Republicar a tag anterior pelo guard: `git checkout <tag-anterior>` e o mesmo `npm run deploy:<alvo> -- --project … --confirmar …` (toda publicação corresponde a uma tag, então sempre existe a anterior). No Hosting, o console também permite voltar uma versão (Hosting › histórico de versões); registrar o que foi feito. |
| Dado errado gravado | Não apagar histórico. Corrigir pelos fluxos do app (estorno, anulação) ou, se a perda for ampla, ler a versão anterior pelo PITR (até 7 dias) ou restaurar um backup num banco de ensaio (RB-14) para comparar e corrigir pelo backend. Restaurar sobre o `(default)` não é procedimento deste piloto. |
| Acesso indevido ou suspeita de abuso | Conter primeiro: `revogar` o convite (RB-13), que suspende a conta; se houver risco geral, desativar o site no console do Hosting e suspender as contas no Authentication. Preservar evidência: exportar os logs do Cloud Logging do período antes de qualquer mudança. |
| Incidente com dado pessoal | Regra de ouro: conter e preservar a evidência antes de mudar qualquer coisa. Avaliar quais titulares e dados foram afetados e se há risco ou dano relevante; se houver, comunicar a ANPD e os titulares afetados em **3 dias úteis contados do conhecimento do incidente** (art. 48 da LGPD; Resolução CD/ANPD nº 15/2024), **a validar juridicamente (G1.11)**. Manter o registro do incidente, do critério de risco usado e das ações, também quando não houver comunicação (a mesma resolução exige guardá-lo por prazo mínimo, a confirmar com a validação jurídica). Registrar a linha do tempo, a causa e as ações no [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md). |
| Depois | Registrar no §4 deste documento; abrir item no §6 do plano mestre se a causa for do código. |

### RB-17 — Pré-voo somente leitura e saneamento de Functions antigas (P6-B)

Executado **só pelo proprietário**, no Codespaces, antes da primeira publicação e de novo antes do primeiro dado real (RB-12, passos 1 e 6). Agentes não executam; a rotina não roda no CI (lá só os testes simulados, `tests/tools/preflight-producao.test.mjs`, sem contato remoto).

| Campo | Conteúdo |
| --- | --- |
| Preparação | Login de pessoa: `gcloud auth login` e `gcloud auth application-default login` (projeto de cota, se pedido: `gcloud auth application-default set-quota-project sistema-financeiro-pesso-20698`). `npm --prefix functions ci` e `npm run functions:build` (o inventário do código vem de `functions/lib`). Nenhuma variável `*_EMULATOR_HOST`, `GOOGLE_APPLICATION_CREDENTIALS`, `FIREBASE_TOKEN` ou projeto diferente no ambiente: a ferramenta recusa (saída 3) antes de consultar. |
| Comando | `node tools/operacao/preflight-producao.mjs --project sistema-financeiro-pesso-20698 --confirmar sistema-financeiro-pesso-20698 [--parte funcoes\|contas\|tudo]` (padrão `tudo`). |
| O que lê | Functions: uma chamada `gcloud functions list --format=json` (sem prompts; nunca habilita API). Contas: `users` com `status == "active"`, só os campos `accessStatus` e `createdAt`, em páginas de 200 até 5.000 perfis. Nada é gravado; nenhuma chave, token, e-mail, nome, uid em claro ou dado financeiro sai na tela. |
| Saídas | 0 sem achados; 1 achados; 2 argumentos; 3 recusa das guardas (nada consultado); 4 inconclusivo (sem resposta, tempo esgotado, permissão, credencial ausente ou limite de leitura). Inconclusivo nunca vale como "limpo". |
| Achados de Functions | `excluidaDaPublicacao` (existe no código mas fica fora da publicação por segredo não registrado: IA e Stripe) e `foraDoCodigo` (órfã) estão implantadas com código **antigo**, sem a autorização da P6-B. Ficar fora da publicação não as remove. Os nomes de segredos ligados aparecem só como nomes. |
| Achados de contas | `semAutorizacao`: perfis ativos sem `accessStatus == "granted"`. Antes da publicação da P6-B, o código antigo pode deixá-los operar; depois dela, ficam bloqueados por padrão, sem nenhuma exclusão. `revogadosAindaAtivos`: revogação parcial (repetir o `revogar`, RB-13). As referências são os 12 primeiros hex do SHA-256 do uid e o mês de criação. |
| Saneamento (manual) | Só com autorização expressa do proprietário, registrada no §4 antes de executar, e **um comando por vez**: para cada função listada, o comando impresso pela ferramenta, `firebase functions:delete <nome> --region <regiao> --project sistema-financeiro-pesso-20698` (remove a função implantada; não toca dados do Firestore). Depois de cada um, repetir `--parte funcoes` e anotar a saída. Concluído quando a saída não tiver `excluidaDaPublicacao` nem `foraDoCodigo`. Perfis antigos não são apagados nem migrados: o proprietário decide caso a caso, pelo fluxo do titular (RB-T07), se algum deve ser eliminado. |
| Limites | Contas do Authentication sem perfil não aparecem (não têm acesso; limpeza no RB-13). Com o gcloud antigo, a lista pode omitir funções de 2ª geração: confira também, só lendo, Firebase console › Functions (ou Cloud Run functions no console do Google Cloud). Se o Firestore não responder, confira no console (Firestore › `users`, filtro `status == active`) só o campo `accessStatus`, sem copiar e-mail, nome ou identificadores. |
| Registro | A saída (sem e-mails) pode ir para o §4 deste documento; não colar em chats públicos nem em tickets. |

## 2. Runbooks proibidos ou obsoletos

Não executar. Onde houver substituto, ele está indicado.

> **Atualização P6-A (2026-11-17, D-19).** As linhas abaixo de `deploy:*`, `firebase deploy`, `functions serve`/`shell`/`logs`, `npm run dev`, `limpar-investimentos.mjs` e `rehearsal.sh` descrevem o estado anterior à P6-A e ficam como registro. Agora: os `deploy:*` passam pelo guard de publicação (RB-12) e continuam proibidos a agentes; `serve` e `shell` das Functions usam o Emulator e `logs` foi removido; `npm run dev` roda contra o Emulator (RB-11); a limpeza de investimentos só aceita o Emulator; o `rehearsal.sh` só roda o gate local.

| Runbook ou comando | Onde | Por que (evidência) | ID | Substituto |
| --- | --- | --- | --- | --- |
| `npm run deploy:firestore`, `deploy:functions`, `deploy:safe`, `deploy:hosting`, `deploy:webhook` | `package.json:22-26` | Alvo fixo `sistema-financeiro-pesso-20698`, que é também o ambiente de desenvolvimento. Os gates são parciais: `deploy:functions` só roda `verify:fast`; `deploy:hosting` e `deploy:webhook` só fazem build. Negados no harness | PR-PLAT-01, PR-REL-01; D-ORD-04 | RB-T01 (P6) |
| `firebase deploy` em qualquer forma; `npm --prefix functions run deploy` | `functions/package.json:12` | Sem gate; sem `--project`, cai no `default`, que é produção (`.firebaserc:3`) | ENTRY-19, REL-04 | RB-T01 |
| `npm --prefix functions run logs`; `firebase functions:log` | `functions/package.json:15` | Lê logs do projeto de produção, o que CLAUDE.md proíbe | PR-PLAT-01 | Logs de DEV/STAGING autorizado (P6/P7) |
| `npm --prefix functions run serve`, `shell`, `start` | `functions/package.json:11-13` | Sem `--project`, usam o `default` (produção). `serve` sobe só o emulador de Functions e `shell` executa funções localmente; chamadas do Admin SDK a serviços não emulados podem atingir o projeto real | ENTRY-19 | RB-06 |
| `npm run functions:test:integration` (sem Emulator) | `package.json:15` | Testes com `skip` condicional passam sem executar (`functions/src/crons/__tests__/investmentDrift.integration.test.ts:105`). `goalProgressRebuild.integration.test.ts` não tem guarda e faz `recursiveDelete` no projeto de `GCLOUD_PROJECT` (`functions/src/investments/__tests__/goalProgressRebuild.integration.test.ts:28,35-38,53`) | REL-09, FIRE-13 | RB-03, RB-07 |
| `npm run dev` com a configuração local | `package.json:7`; `src/lib/firebase.ts:7-14,47-62` | Sem `VITE_USE_FIREBASE_EMULATORS=true`, o app se conecta ao projeto configurado no arquivo local, hoje o único projeto, que é produção | PR-PLAT-01 | RB-06 (`test:e2e:ui`, `E2E_SERVER=dev`) |
| `docs/investments/PRODUCTION_DEPLOYMENT_CHECKLIST.md` | — | OUTDATED. `npm run deploy:* --project <PROJETO>` não troca o alvo, porque o npm consome a flag (linhas 103 e 125; REL-03). Fala em "53 funções" contra 47 no HEAD (122, 129). Usa como evidência `firebase functions:secrets:access`, que **imprime o segredo** (61). A ordem canônica não tem backup e prevê um rollout de flag inexistente (20-25) | REL-03, FIRE-14, PR-DOCS-01 | RB-T01, RB-T02, [BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md) |
| `docs/investments/CASH_BACKFILL_RUNBOOK.md` | — | Manda operar por "Configurações › Cadastros › Operação do domínio patrimonial" (`docs/investments/CASH_BACKFILL_RUNBOOK.md:56`), superfície removida (painel e callables de rebuild/backfill de investimentos saíram na P4-D, plano §19.4) | REL-14 | RB-T04 |
| `docs/investments/TTL_MANIFEST.md` como procedimento | — | Ativação por loop `gcloud` manual (51-70). Cita `investment_audit_logs`, coleção inexistente (44, 118). OUTDATED | FIRE-08, RULES-13 | RB-T10 |
| `docs/investments/OPERATIONAL_LIMITS.md` | — | OUTDATED: cita constantes e callables que não existem no HEAD (34, 43) | REL-14 | — |
| `tools/investments/limpar-investimentos.mjs` | `tools/investments/limpar-investimentos.mjs:59,88,144-149,352,409` | Hard delete do ledger de investimentos e de transações, com override para o ID de produção. A suíte de guarda valida esse override como suportado (REL-02) | PR-PLAT-02 | Seed/reset só no Emulator (P6). O único uso permitido é a própria suíte de guarda dentro de RB-03 |
| `tools/staging/rehearsal.sh` | `tools/staging/rehearsal.sh:21-41,65,70` | Não existe projeto de staging (`.firebaserc:1-5`). O script chama `deploy:*` com `-- --project` sobre um alvo já fixado (REL-03). Os passos estão obsoletos: "53 funções" (72), histórico legado (91), `CASH_BACKFILL_RUNBOOK` (98), "flag ligada" (105), "seis coleções" e `investment_operation_leases` (139-142). Negado no harness | PR-PLAT-01, REL-03, FIRE-14 | RB-T01 (deploy em STAGING pelo CD, com smoke) |
| ~~Área operacional de investimentos (`InvestmentOperationsPanel`)~~ | Removida na P4-D | Componente e callables de rebuild/backfill de investimentos removidos (D-15, plano §19.4); o rebuild de caixa não tem superfície | INV-05; D-15 (tomada na P4-D) | RB-T04 |
| Console, SDK, CLI ou ferramentas MCP do Firebase contra `sistema-financeiro-pesso-20698` | CLAUDE.md | Proibido a agentes em qualquer forma | — | Emulator (RB-06) |

---

## 3. Runbooks alvo (TARGET)

Nenhum destes procedimentos existe no HEAD. Cada um é criado e exercitado no milestone indicado e depois registrado em §4. Os donos são papéis, a nomear em [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) (DECISION D-21 para a identidade do fornecedor e do encarregado; D-28 para a escala de plantão).

| ID | Runbook | Milestone | Dono (papel) | Pré-requisitos | IDs |
| --- | --- | --- | --- | --- | --- |
| RB-T01 | Deploy por CD e rollback | P6 | Responsável de plataforma | E-01, E-04, E-12; D-19 | PR-REL-01, PR-PLAT-01, PR-AUTH-04 |
| RB-T02 | Rotação de segredo (inclui a chave Gemini) | E-00 parte A (contenção e revogação) imediata; chave nova e procedimento geral em P6 (E-05; Stripe sem fallback desde P2A) | Responsável de plataforma | E-05 | PR-AI-02, PR-BILL-05 |
| RB-T03 | Replay de webhook Stripe | P2A (idempotência e registro, entregues), P7 (fila de falhas, alerta, replay, reconciliação periódica) | Responsável de billing | E-06, E-08 | PR-BILL-06, PR-BILL-01, PR-OBS-01 |
| RB-T04 | Reconciliação e rebuild financeiro por domínio | P3–P5 (rebuild por domínio), P7 (jobs com alerta) | Responsável do domínio financeiro | RB-T09 | PR-TX-04, INV-05, PR-OBS-01 (PR-CC-04 resolvido na P4-A) |
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

- **CURRENT:** os segredos são declarados por função (ver [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md#8-secret-manager-e-parâmetros)). A chave Gemini esteve embutida no bundle público no passado, sem contenção nem revogação comprovadas (PR-AI-02; E-00, parte A, abaixo). Não há procedimento geral nem dono da rotação de segredos (E-05, P6).
- **Ação imediata E-00, parte A: contenção e revogação** (D-ORD-06; fora do repositório, feita pelo titular da conta Google Cloud; passo a passo em [`evidence/p5-gate-final/E-00-CHAVE-GEMINI.md`](evidence/p5-gate-final/E-00-CHAVE-GEMINI.md) §2):
  1. Listar toda chave com acesso à Generative Language API criada até 2026-08-24, inclusive (na dúvida, todas) e toda chave cujo valor esteve numa `VITE_*` de um build publicado, em qualquer data. A chave web do Firebase não é excluída: segue o passo 4.
  2. Revisar o uso por credencial desde 2026-01-22.
  3. Excluir as chaves do passo 1 e conferir `API_KEY_INVALID` (400; um 403 não prova a exclusão) pelo menos 30 minutos depois; guardar o registro de exclusão e confirmar que não houve restauração (`UndeleteKey`), porque a exclusão é reversível por 30 dias. O teste vale para todo valor achado, inclusive no Secret Manager; só sem o valor em lugar nenhum vale a prova alternativa do D-ORD-08 (E-00 §3, linha 2). É esse passo que elimina o risco, e ele não espera a chave nova: sem usuários reais em produção (plano §1), as callables de IA podem ficar indisponíveis até a parte B. Com a chave revogada montada, elas falham na chamada ao provedor; `readApiKey` só recusa chave ausente ou curta (`functions/src/ai/callables.ts:133-142`).
  4. Desativar as APIs de IA no projeto do Firebase logo depois da exclusão; restringir as chaves que continuam válidas, inclusive a chave web do Firebase (sem nenhuma API de IA ou de ML na lista, como a Firebase AI Logic API e a ML Kit API, com o teste da chave web dando 403 e o app funcionando; o referenciador HTTP é do E-03, na P6, pelo D-ORD-07; se não puder ser restrita ou se houver abuso, substituída por build verificado (E-00 passo 5, item 7) e a antiga excluída, com publicação decidida por humano); inventariar as `VITE_*` não públicas publicadas e revogá-las, ou girá-las com a credencial anterior invalidada na hora; limpar as estações; avaliar o impacto aos titulares com base no uso e nas `VITE_*`, com a conclusão sobre risco relevante ([INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) §6.6).
  5. Registrar a evidência linha a linha em [SECURITY_MODEL.md](SECURITY_MODEL.md) §9.4 (linhas 1, 2 e 5 a 9) e na matriz do §4 do E-00. O roteiro detalhado, com console, evidência, risco e condição para prosseguir em cada passo, é o §2 do E-00.
- **Parte B, credenciais novas (E-05, P6; antes de a IA rodar em qualquer ambiente remoto):**
  1. Criar uma chave nova por ambiente, restrita à Generative Language API e com quota.
  2. Gravá-la como nova versão de `GOOGLE_AI_API_KEY` sem exibir o valor (por exemplo, `gcloud secrets versions add GOOGLE_AI_API_KEY --data-file=- --project=<PROJECT_ID>`) e desativar as versões antigas.
  3. A versão do segredo é fixada no deploy da função. O redeploy das callables de IA é decisão e execução humanas; agentes não fazem deploy (CLAUDE.md).
  4. Registrar nas linhas 3 e 4 da §9.4 e no E-05 de [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md).
- **TARGET — procedimento geral** (P6; os segredos Stripe não têm fallback desde P2A): gerar a credencial nova no provedor, com test/live separados → adicionar a versão no Secret Manager do ambiente → deploy pelo CD → verificar em STAGING (checkout e entrega de webhook com código 200) → promover → desativar e destruir a versão antiga → revogar a credencial antiga no provedor.
- **Verificação:** só por metadados (`gcloud secrets versions list <NOME> --project=<PROJECT_ID>`); nunca `functions:secrets:access`.
- **Sucesso:** nenhuma versão antiga ativa, credencial antiga revogada, zero erro de autenticação com o provedor e registro atualizado (E-05).

### RB-T03 — Replay de webhook Stripe

- **CURRENT:** o webhook trata 13 tipos de evento (`functions/src/billing/webhook.ts:190-300`), registra e deduplica por `event.id` em `billing_webhook_events/{event.id}` (`functions/src/billing/webhook.ts:473-476`), relê o estado no Stripe sob lease com geração em vez de aplicar o payload e não ecoa erro do SDK (`functions/src/billing/webhook.ts:857-860,892-895`). Sinais de log: `billing_webhook.failed` (ERROR, `errorCode` estável, `stripeEventId`), `billing_webhook.contention` (WARNING, `lease_contention`), `billing_webhook.processed`, `billing_webhook.signature_invalid` e `billing_webhook.body_too_large` (413 antes da assinatura). Não gera alerta nem tem fila de falhas ou replay administrativo (P7); o reenvio pelo painel do Stripe de um evento já `processed` é no-op.
- **CURRENT (P2A) e TARGET (P7):** o registro por evento foi entregue em P2A como recibo `billing_webhook_events/{event.id}` (tipo, `livemode`, `status`, `outcome`, `reason`, TTL de 90 dias), com processamento idempotente e ordem pela releitura do Stripe sob lease com geração ([BILLING_ENTITLEMENTS.md](BILLING_ENTITLEMENTS.md)). Tentativas e último erro não existem hoje: ficam para a fila de falhas, com consulta paginada, alerta e ferramenta de replay auditada, tudo em **P7** (PR-OBS-01).
- **Procedimento TARGET:**
  1. O alerta de falha (E-08) sobre `billing_webhook.failed` (por `errorCode`) ou `billing_webhook.contention` leva, pelo `stripeEventId`, ao recibo `billing_webhook_events/{event.id}` (recibo `processing` indica entrega que não chegou ao commit) e à fila de falhas (P7), ou ao painel do Stripe (endpoint › eventos com falha).
  2. Corrigir a causa (segredo, deploy ou bug) antes de qualquer reenvio.
  3. Reenviar o evento original, com o mesmo `event.id`, pelo painel ou API do Stripe, ou reprocessar pela ferramenta administrativa (RB-T09).
  4. `event.id` já processado vira no-op; o estado vem sempre da releitura atual do Stripe, então um evento mais antigo não sobrescreve um estado mais novo.
  5. Conferir que o estado de assinatura é igual ao do Stripe e que a auditoria foi gravada.
- **Sucesso:** zero eventos em falha e estado conciliado com o Stripe.

### RB-T04 — Reconciliação e rebuild financeiro por domínio

| Domínio | Ferramenta CURRENT | Como é acionada hoje | TARGET | Milestone |
| --- | --- | --- | --- | --- |
| Investimentos | Nenhuma callable pública de rebuild, recálculo ou backfill desde a P4-D (D-15, plano §19.4); `processInvestmentDriftScan` diário, que compara só projeções (`functions/src/crons/investmentDrift.ts`) | Cron agendado, sem superfície | Deriva do ledger contra as posições em todos os tenants, com alerta; reparo operacional pela ferramenta auditada (RB-T09) | P6/P7 |
| Caixa | `rebuildCashPeriods`, com simulação e saída de reconciliação, papel owner/admin e 100 chamadas/h; desde P3-B com cerca de corte, recomeço controlado (`restarted` com o motivo) e publicação numa única transação (`functions/src/cash/rebuild.ts:410-766`). Repetir a chamada até `completed: true`; `needsRebuild` em `cash_period_events/projection_state` indica que o gatilho percebeu divergência | Mesmo painel sem montagem | Retry com cerca entregue (D-38, P3-B); falta o job de deriva de caixa com alerta | P3 (PR-TX-04), P7 |
| Cartões | `rebuildCardInvoicesForCard`, `recalculateCardLimit` (`functions/src/cards/callables.ts`; owner/admin; perfil pesado) | Callables (P4-A); a superfície na tela de cartões não consta da folha de fatos | Rotina de fechamento com releitura transacional e páginas de 200 (`processCreditCardInvoiceClosing`, P4-A, PR-CC-04 resolvido); reconciliação compras × faturas × limite com alerta | P7 (alerta) |
| Metas | Nenhuma (`recalculateGoalInvestmentProgress` removida na P4-D) | — | Job de deriva da projeção única de progresso; reparo futuro (P6/P7) | P7 (plano §8) |
| Contas/carteiras (P3-J) | `tools/accounts/reconciliar-contas.mjs` (RB-10): saldo × soma dos movimentos, só no Emulator, dry-run por padrão e `--reparar` | Linha de comando local | Reconciliação agendada com alerta | P7 |
| Recebíveis, divisão (recorrentes: trilha `recurring_events` desde a P4-B; empréstimos: escrita só pelo backend desde a P3-H, com `loan_events` append-only) | Nenhuma: os dados são gravados pelo cliente (PR-RULES-01) | — | Ledger ou eventos no backend, com rebuild idempotente | P3, P4, P7 |

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

- **CURRENT:** 13 `fieldOverrides` de TTL versionados em `firestore.indexes.json` (lista em [DATA_RETENTION_LIFECYCLE.md](DATA_RETENTION_LIFECYCLE.md) §2.2); publicação e estado por ambiente NÃO VERIFICADOS (E-07). A política só passa a valer depois de publicada (`functions/src/shared/retention.ts:17-20`).
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


### AUTORIZACAO-PILOTO-20261123

Em 23/11/2026, o proprietario autorizou expressamente a inclusao da IA no G0, o adiamento do Stripe e a remocao controlada das seguintes 22 Functions antigas:

- `archiveInvestmentAsset`
- `createInvestmentContribution`
- `rebuildInvestmentProjections`
- `recordInvestmentValuation`
- `seedLegacySettingsCatalog`
- `settleInvestmentRedemption`
- `registerCreditCardInvoicePayment`
- `recalculateInvestmentPosition`
- `closeCreditCardInvoice`
- `reopenCreditCardInvoice`
- `archiveInvestmentAccount`
- `backfillInvestmentWorkspace`
- `registerInvestmentImportBatch`
- `saveInvestmentAsset`
- `onboardInvestmentWorkspace`
- `processCreditCardInvoiceOperationalAlerts`
- `saveInvestmentAccount`
- `reverseCreditCardInvoicePayment`
- `createInvestmentRedemption`
- `recalculateGoalInvestmentProgress`
- `stripeWebhook`
- `createCheckoutSession`

Preservar e atualizar no deploy: `extractTransactionFromContent` e `analyzeFinancialQuestion`.

A autorizacao nao inclui exclusao de dados, contas, bancos, segredos ou outros recursos. Nao constitui liberacao antecipada do G0.

## 5. Registro E-12 — GitHub

Registro canônico de E-12 (resumido em [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md#16-registro-de-configuração-externa)). Todos os itens estão em **EXTERNAL CONFIGURATION REQUIRED**, com estado `NÃO VERIFICADO`. A verificação é somente leitura. A auditoria encontrou `HEAD == origin/main`, 29 de 64 commits chamados "Salvando" e um único merge (REL-06).

| ID | Item | Valor esperado | Estado | Verificação (somente leitura) | Data | Responsável |
| --- | --- | --- | --- | --- | --- | --- |
| E-12 | Proteção de `main` | PR obrigatório com revisão; sem push direto nem force-push | NÃO VERIFICADO | `gh api repos/{owner}/{repo}/branches/main/protection` | — | a designar |
| E-12 | Checks obrigatórios | "Build e testes unitários (Node 22)", "Build e testes unitários (Node 24)", "Integração e Firestore Rules", "E2E" (`.github/workflows/quality-gate.yml:28,132,172`) | NÃO VERIFICADO | idem (`required_status_checks`) | — | a designar |
| E-12 | Revisão por CODEOWNERS | `CODEOWNERS` versionado para `firestore.rules`, `firestore.indexes.json`, `firebase.json`, `functions/src`, `package.json`, com revisão obrigatória | NÃO VERIFICADO | idem (`require_code_owner_reviews`) e leitura do arquivo | — | a designar |
| E-12 | Environments de deploy | `staging` e `production` com revisores obrigatórios e restrição de branch/tag | NÃO VERIFICADO | `gh api repos/{owner}/{repo}/environments` | — | a designar |
| E-12 | Segredos do repositório | nenhuma credencial de PROD; deploy por Workload Identity Federation | NÃO VERIFICADO | `gh secret list`; `gh secret list --env production` (só nomes) | — | a designar |
| E-12 | Secret scanning e Dependabot | ativos | NÃO VERIFICADO | `gh api repos/{owner}/{repo}` (`security_and_analysis`) | — | a designar |


## Política de homologação independente — 2026-11-23

Decisão expressa do proprietário: separar a homologação da publicação.

- `verify:fast`, `verify:all` e `predeploy:check` são executados
  separadamente, por decisão do operador.
- Nenhum comando `deploy:*` dispara suítes de testes.
- `deploy:release` publica Firestore, Storage, Functions e Hosting
  sequencialmente, interrompendo na primeira falha.
- As proteções operacionais, a compilação necessária, a validação
  dos artefatos e a composição segura das Functions permanecem.
- O operador responde pela homologação da versão publicada.
- O sucesso do deploy não equivale a aprovação dos gates.
- Esta decisão não dispensa requisitos legais, de privacidade,
  de segurança nem de liberação de usuários reais.


### Publicacao em lotes de Functions

Publicacoes de mais de cinco Functions sao divididas em lotes
sequenciais, com intervalo de 65 segundos entre lotes.

O parametro --funcoes permite selecionar nomes exatos para
retomada, respeitando o inventario e os segredos autorizados.

Registrar LOTE_CONFIRMADO para cada lote concluido.
Interromper na primeira falha e reconciliar o estado remoto.
Nao repetir suites de homologacao durante a publicacao.
Nao utilizar --force.
