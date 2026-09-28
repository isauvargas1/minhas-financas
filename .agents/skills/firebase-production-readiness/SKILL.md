---
name: firebase-production-readiness
description: Gate bloqueante de prontidão da plataforma Firebase/Google Cloud para produção. Use sempre que uma tarefa criar, alterar, revisar ou aprovar separação DEV/STAGING/PROD, `.firebaserc`, `firebase.json`, App Check, deploy/versionamento de Security Rules e índices, TTL, IAM e service accounts, Secret Manager e variáveis de ambiente, exports e opções de runtime das Cloud Functions (região, timeout, memória, maxInstances, concurrency, retries, agendamentos), Emulator, configuração de Auth e Hosting, budget/quotas, monitoramento de plataforma, backups, PITR ou restore — e antes de qualquer release para STAGING/PROD ou do fechamento dos milestones de hardening.
---

# Firebase Production Readiness

Atue como gate bloqueante da plataforma. Inspecione configuração versionada, código de inicialização, scripts, CI e a evidência registrada da configuração que vive fora do repositório; nunca aprove por descrição.

## Regras de segurança da própria revisão

- Nunca acessar o projeto de produção (`sistema-financeiro-pesso-20698`) por CLI, SDK, console, script ou ferramenta MCP para “conferir” configuração. Verificação em projeto remoto só em DEV/STAGING explicitamente autorizado pelo usuário, somente leitura, com o projeto informado.
- Ferramentas MCP do Firebase: apenas documentação (`developerknowledge_*`). As Firebase Agent Skills oficiais do plugin (`firebase:firebase-basics`, `firebase:firebase-firestore`, `firebase:firebase-auth-basics`, `firebase:firebase-hosting-basics`, `firebase:firebase-security-rules-auditor`) podem ser carregadas como referência técnica.
- Nunca imprimir valores de segredos; verificar apenas nomes, origem e forma de injeção.

## Fronteiras com outras skills

- **Esta skill:** configuração e operação da plataforma — ambientes, App Check, pipeline de Rules/índices, IAM, segredos, runtime das Functions, Emulator, Auth/Hosting, custos/quotas, backup/PITR/restore.
- `multi-tenant-security-review`: semântica de autorização das Rules e dos callables.
- `firestore-scale-cost-review`: forma das queries, índices necessários por query, custo por ação.
- `observability-incident-readiness`: conteúdo de logs, métricas, alertas, runbooks e exercício de DR. Esta skill verifica que a plataforma de monitoramento e os backups existem e que um restore foi testado.
- `privacy-lgpd-data-lifecycle`: prazos de retenção e localização exigidos; esta skill verifica o mecanismo técnico (TTL, backups com retenção, região).
- `billing-entitlement-integrity`: uso correto dos segredos do Stripe.

## Workflow

1. Ler integralmente [references/firebase-production-checklist.md](references/firebase-production-checklist.md).
2. Inventariar ambientes: projetos, aliases, configs web, contas de serviço, credenciais usadas por scripts e CI, e para onde cada comando/script aponta por padrão.
3. Inventariar Functions exportadas e suas opções efetivas (globais + por função), segredos consumidos e gatilhos.
4. Confrontar cada item do checklist com evidência do repositório; para itens de console/GCP, exigir o registro versionado em `docs/production/FIREBASE_PRODUCTION.md`.
5. Executar verificações locais seguras: build, testes de contrato de deploy, suítes Emulator, busca por segredos e por referências ao projeto de produção.
6. Se implementação for pedida, corrigir o que é código/configuração versionada e registrar o que exige ação externa como `EXTERNAL CONFIGURATION REQUIRED` — isso continua sendo `FAIL` até haver evidência.

## Política de decisão

- **Escopo da avaliação.** Em mudança ou fechamento de milestone, avaliar integralmente toda seção do checklist exercitada pelos caminhos alterados, toda invariante que o diff possa violar e todo item que o plano mestre (`docs/production/PRODUCTION_READINESS_PLAN.md` §6, §8 e §11) atribui ao milestone corrente ou a milestones anteriores. Itens atribuídos a milestone posterior e não afetados pelo diff ficam fora do escopo desta execução e são listados em "Fora do escopo desta avaliação" com o ID do plano (PR-\*, E-\*, D-\*); não são `N/A` nem `PASS`, e o veredito declara o escopo a que se aplica. Isso não é ressalva: dentro do escopo, qualquer falha ou evidência ausente é `FAIL`. Em release para STAGING/PROD, no lançamento e em P10, o escopo é o checklist integral e qualquer pendência é `FAIL`.
- `FAIL` para: ausência de separação DEV/STAGING/PROD; script, CI ou default que alcance produção sem guarda explícita; App Check ausente ou não aplicado nos serviços usados; Rules/índices implantáveis sem a suíte Emulator; segredo no cliente, no repositório ou em variável não gerenciada; Function sem região, timeout ou teto de instâncias definidos; função de teste/manual exportada em produção; retry habilitado em gatilho não idempotente; ausência de budget/alertas de custo; PITR ou backups agendados ausentes; restore nunca testado; qualquer item obrigatório sem evidência.
- Configuração externa sem registro versionado (valor esperado, estado verificado, data, responsável, forma de verificação) é `FAIL`.
- `N/A` somente com prova de que o serviço não é usado (ex.: Storage sem SDK, sem Rules e sem bucket referenciado).
- Não existe “PASS com ressalvas”.

## Saída obrigatória

Começar exatamente com `PASS — Firebase production readiness` ou `FAIL — Firebase production readiness`.

Em seguida:

- **Escopo:** ambientes, serviços e arquivos avaliados.
- **Mapa de ambientes:** projeto por ambiente, aliases, configs, credenciais e destino padrão de cada script/CI.
- **Inventário de Functions:** função, tipo, região, timeout, memória, maxInstances, concurrency, retry, segredos, App Check.
- **Matriz de evidência:** uma linha por seção do checklist com `PASS`, `FAIL` ou `N/A` e referência arquivo:linha, saída de comando ou item do registro externo.
- **Configuração externa pendente:** itens `EXTERNAL CONFIGURATION REQUIRED`, com dono e forma de verificação.
- **Achados bloqueantes:** cenário, impacto e remediação.
- **Fora do escopo desta avaliação:** itens do checklist atribuídos a milestone posterior e não afetados pelo diff, com o ID do plano; vazio em release e em P10.
- **Verificação:** comandos executados e resultados.
