# P5-F — vereditos das skills e auditoria independente

**Escopo das revisões.** Diff do worktree contra `1730a1df`, avaliado na árvore `9cc4e445565313dae409725571fb72be801f6cb8`. É a árvore do `verify:all` final (saída 0, 2.937 testes); depois dele só a documentação mudou ([`execucoes.md`](execucoes.md)).

**Evidências usadas:**
- [`matriz-cobertura.md`](matriz-cobertura.md): classificação de cada ponto monetário;
- [`mutantes.md`](mutantes.md): 59/59 mutantes de unidade e guarda, 15/15 das Rules e os mutantes do E2E (varredura e logs);
- [`cache-sdk.md`](cache-sdk.md): cache em memória do SDK na troca de conta;
- [`visual/LEIAME.md`](visual/LEIAME.md): antes e depois, a11y, teclado e transbordamento;
- [`execucoes.md`](execucoes.md): comandos e resultados.

Cada skill foi aplicada no escopo definido pela própria política: as seções do checklist exercitadas pelo diff e as invariantes que ele poderia violar. Itens de milestones posteriores não afetados aparecem como fora do escopo, com o ID do plano.

## PASS — Financial domain integrity

**Escopo.**
- Conversão só de exibição: centavos autoritativos → minutos equivalentes, calculada na renderização (`src/modules/work-time/calculation.ts`, `presentation.ts`, `display.tsx`).
- Uma preferência pessoal fora do domínio financeiro (`users/{uid}/private_preferences/work_time_equivalent`).
- 31 telas passam a pedir `useMoneyDisplay()` nos pontos T e G da matriz.
- Nenhuma operação, callable, gatilho, projeção, relatório autoritativo ou Rule financeira mudou: `git diff --quiet 1730a1df -- functions firestore.indexes.json firebase.json` sai com 0.
- PF e PJ usam o mesmo caminho de exibição (E2E 2).

**Mapa de autoridade.**

| Número | Fonte oficial | Quem grava | Efeito da P5-F |
| --- | --- | --- | --- |
| Saldos, lançamentos, faturas, empréstimos, recebíveis, recorrências, investimentos, metas, divisão | As mesmas da base (Functions com Admin SDK) | Inalterado | Só lidos. O ponto T mostra a conversão dos mesmos `cents`; nada volta ao backend |
| Indicadores de Relatórios e Dashboard | `getFinancialReport` (DTO inalterado) e adaptador | Inalterado | `FinancialKPI.cents` e os gráficos em reais (`centavos ÷ 100`) são view models. O centavo do gráfico é recuperado por `Math.round(valor × 100)`, exato até 10¹⁵ e provado no teste |
| Renda de referência e carga mensal | Documento privado do titular | Só o próprio titular, pelo cliente, com o contrato validado nas Rules (`firestore.rules:1165-1192`, `1230-1235`) | Não é número financeiro do workspace: nenhuma Function, projeção ou relatório lê |
| Minutos equivalentes e valor por hora | Nenhuma | Ninguém (calculados na tela) | Proibido gravar. Guarda K6/G12, E2E 4 e a varredura do Firestore |

**Semântica dos movimentos.** Nenhum movimento novo, alterado ou reclassificado. A conversão não muda caixa, ativos, passivos, receita, despesa, principal, rendimento nem valorização: é a mesma grandeza, em outra unidade de exibição. Valores negativos espelham os positivos, e o sinal é preservado (`-≈ 2 h 10 min`).

**Matriz de evidência.**

| Seção do checklist | Resultado | Evidência |
| --- | --- | --- |
| Representação e tempo | PASS | Entrada em centavos inteiros; BigInt em `round(|c| × minutos ÷ renda)`, meio minuto para longe de zero (`calculation.ts`). Fora do inteiro seguro ou com valor não inteiro, mostra BRL. A renda é lida por `parseBrlToCents`, sem ponto flutuante. Nenhuma data persistida nova |
| Semântica financeira | PASS | Nada reclassificado. Pontos que movem dinheiro ficam em BRL: entradas, confirmações, termos, históricos (128 pontos R-* antes da revisão 3, 129 depois). M1: ação na linha em BRL e anulação com o valor exato em reais no modo tempo |
| Autoridade e atomicidade | PASS | Nenhuma escrita financeira nova. A única escrita nova é a preferência, um documento só, `setDoc`/`updateDoc`/`deleteDoc` atômicos (`api.ts:50-61`), com Rules estritas |
| Operações críticas e eventos | N/A | Provado: nenhuma operação, evento, idempotência ou auditoria financeira mudou (diff vazio em `functions/`); a guarda `work-time-guard.test.ts:58-93` impede a Function, a IA, as notificações, os relatórios e os DTOs de tocar a preferência |
| Histórico e auditabilidade | PASS | Nenhum histórico financeiro apagado ou alterado. Apagar a preferência é eliminação de dado pessoal do titular, não de histórico financeiro. Os históricos (R-HA) ficam em BRL |
| Fontes, totais, projeções e relatórios | PASS | DTO do `getFinancialReport` sem campo novo (guarda `:82-93`; mutante G12). Totais, filtros, ordenação e exportação continuam em centavos. Gráficos: só eixo e tooltip mudam, com os dados idênticos |
| Substituição de domínio e legado | N/A | Provado: a P5-F acrescenta uma visão de exibição, sem substituir domínio, e não há legado a remover. O `presentation.ts` saiu sem funções sem uso (`moneyOrWorkTimeText*`, `moneyOrWorkTimeTooltip` foram removidas; `tsc` 0) |
| Migração com dados reais | N/A | Não há dados reais (política de legado) e nenhuma migração ou backfill foi feita |
| Testes obrigatórios | PASS | Criação, edição, desativação e exclusão da preferência: E2E 1 e 3 e Rules (10 testes). Retry: gravação idempotente (`setDoc` com o contrato inteiro). Concorrência: duas abas (E2E 3). Anulação/estorno: os fluxos continuam os da base, com confirmação em reais (guarda linha a linha, G24/G28) |

**Reconciliação.** Nenhum total novo. Para cada ponto T, o número convertido vem do mesmo `cents` do ponto em BRL da base. O modo dinheiro é idêntico: a camada devolve o formatador da tela (guarda `:327`, mutante G11; Gráficos com 0 px de diferença). Não há dupla contagem possível: nada é somado em minutos.

**Retry e concorrência.**
- Salvar regrava o documento inteiro com `serverTimestamp`; repetir dá o mesmo estado.
- Excluir é idempotente.
- Duas abas: a última gravação vence, o listener de cada aba recebe o estado final (E2E 3), e a regra é aceitável para preferência pessoal.
- Respostas atrasadas e troca de conta: o estado é marcado com o uid, e o listener é cancelado quando o uid muda (`WorkTimeContext.tsx:72-93`). Guarda estrutural com os mutantes G32–G35; a troca real é coberta pelo E2E 2.

**Legado removido.** N/A (nenhuma substituição). Prova de ausência de fonte concorrente: `rg "monthlyIncomeCents|monthlyWorkMinutes" functions/src` vazio (guarda `:58`).

**Verificação.**
- `test:unit:work-time` 36/36, com o cálculo, os limites, o negativo, o zero, o "< 1 min", o inteiro seguro e a identidade do modo dinheiro.
- Rules 10/10 no Emulator.
- E2E da P5-F 4/4, PF e PJ.
- Mutantes 59/59 e 15/15.
- `verify:all` final com saída 0: 2.937 testes, 0 falha, 0 skip ([`execucoes.md`](execucoes.md)).

## PASS — Firestore scale/cost review

**Escopo.** Um listener e até três escritas de um único documento por usuário. Nenhuma consulta, collection group, índice, agregado, job ou gatilho novo.

**Evidência.**

| Item do checklist | Resultado | Evidência |
| --- | --- | --- |
| Isolamento e limites de consulta | PASS | Leitura por caminho fixo do uid autenticado (`api.ts:24`, `WorkTimeContext.tsx:68`), sem consulta. `allow list: if false` (`firestore.rules:1234`); collection group negado (teste de Rules "sem listagem e sem consulta de collection group") |
| Índices e viabilidade | N/A | Provado: `get` de documento não usa índice composto; `firestore.indexes.json` sem diff |
| Leituras, listeners e execução | PASS | Um listener por sessão autenticada pronta, cancelado na troca de uid e no logout (`WorkTimeContext.tsx:72-88`). Justificado: a mudança em outra aba ou dispositivo precisa aparecer sem recarregar (E2E 3). Sem N+1: cada tela lê o contexto, não o Firestore |
| Escritas e modelo de dados | PASS | Um documento por usuário, com 6 campos de tamanho fixo. Escrita só em ação explícita (salvar, alternar, excluir), sem fan-out, gatilho ou hotspot |
| Retenção | PASS | Não é coleção que cresce: no máximo um documento por usuário, apagável pelo titular. A eliminação junto com a conta é do job da P8, registrada (`PRIVACY_LGPD` linha 25, `DATA_RETENTION_LIFECYCLE`) |
| Legado | N/A | Provado: nenhum caminho de consulta substituído |
| Custo e alto volume | PASS | Modelo abaixo; constante por usuário, sem dependência do histórico do workspace |
| Emulator | PASS | `test:rules:work-time` 10/10: dois workspaces, quatro papéis, troca de usuário, listagem e collection group negados, campos e limites |

**Modelo de custo** (estimativa, por usuário):

| Ação | Operações |
| --- | --- |
| Abrir o app com a conta pronta | 1 leitura do documento (0 se não existir, 1 cobrada pela consulta vazia) + 1 leitura das Rules em `users/{uid}` (`hasActiveAccount`) |
| Salvar, alternar o modo ou excluir | 1 escrita + 1 leitura das Rules. Cada listener aberto recebe 1 atualização (1 leitura) |
| N abas ou dispositivos | N listeners, N leituras iniciais e N leituras por mudança |
| 100 mil usuários ativos | Cerca de 100 mil leituras iniciais por dia, se cada um abrir uma sessão, mais as escritas raras. O custo não cresce com lançamentos, workspaces ou histórico |

**Verificação.** Suíte de Rules no Emulator (10/10), E2E 3 com duas abas e 4/4 da P5-F, `verify:all` final.

## PASS — Multi-tenant security review

**Escopo e fronteiras de confiança.**
- Entrada única: o SDK do Firestore no navegador, autenticado pelo Firebase Auth.
- Recurso: `users/{uid}/private_preferences/work_time_equivalent`, que pertence à pessoa, não ao workspace.
- Camada que autoriza: as Rules. Não existe backend que leia ou grave o documento, e a guarda e o mutante G2 provam a ausência.
- Nenhuma Rule de workspace, membership, RBAC ou callable mudou.

**Matriz de evidência.**

| Seção do checklist | Resultado | Evidência |
| --- | --- | --- |
| Identidade, tenant e membership | PASS | `request.auth.uid == userId` e conta ativa (`firestore.rules:1165-1169`). O caminho do cliente usa só o uid da sessão (`api.ts:24`, `WorkTimeContext.tsx:68`). Não há `workspaceId` no caminho: o documento não pertence a workspace, e nenhuma regra de workspace o alcança |
| RBAC e operações privilegiadas | PASS | A matriz é explícita: owner, admin, member e viewer do mesmo workspace são negados na leitura, gravação e exclusão da preferência de outra pessoa (testes de Rules 2 e 4). Viewer lê e grava a própria, porque é preferência pessoal e não dado do workspace (decisão do pedido: "a preferência é do uid") |
| Integridade e entrada | PASS | `hasOnly` + `hasAll`, tipos, limites, piso do valor por hora e `updatedAt == request.time` (`:1171-1192`). O cliente monta o objeto pela allowlist (`workTimePreferenceFields`). Os testes negam campo extra, campo ausente, tipo errado, limite e outro id |
| Camadas independentes | PASS | Rules avaliadas sozinhas, sem backend: negam tudo fora do titular. Backend: N/A provado (nenhuma Function lê ou grava; guarda `work-time-guard.test.ts:58`, mutante G2). Não há exceção de serviço confiável |
| Auditoria, segredos e Storage | N/A | Provado: nenhuma ação de segurança nova (sem papel, membership, convite ou billing); preferência pessoal não entra na trilha (e a renda é proibida em auditoria pelo pedido). Nenhum segredo novo; Storage não é usado |
| Testes no Emulator | PASS | `tests/firestore/work-time-p5f.rules.integration.test.mjs`, 10 testes: titular, os quatro papéis, outro workspace, anônimo, conta suspensa, ninguém grava a de outro, sem listagem nem collection group, outro id, contrato e troca de usuário no mesmo cliente |

**Caminhos de ataque tentados.**
- IDOR: B lê ou grava `users/A/...`. Negado.
- Membro do workspace de A, em cada papel: negado.
- Curinga e collection group: negados, e a guarda reprova qualquer `match /{x=**}` fora do billing (mutante G26).
- Mass assignment com campo extra ou `updatedAt` forjado: negado (mutantes G7 e G8 na guarda; R-* nas Rules).
- Escalada: a preferência não dá papel nem acesso.
- Replay: gravar de novo o mesmo estado é inofensivo.
- Troca de conta no mesmo cliente: a conta seguinte é negada no servidor. Na interface, o estado de outra conta nunca é exposto (guarda da sessão, G32–G35). O cache em memória do SDK é risco registrado, não alcançável pela interface ([`cache-sdk.md`](cache-sdk.md)).

**Verificação.** Rules 10/10 com dois tenants, mutantes das Rules 15/15, E2E 2 (outra conta no mesmo navegador) e `verify:all` final.

## PASS — Privacy/LGPD data lifecycle (escopo P5-F)

**Escopo.** Um dado pessoal novo: a renda mensal de referência e a carga mensal do titular, com a ativação e o modo.

**Inventário** (`PRIVACY_LGPD.md` linha 25):

| Campo | Valor |
| --- | --- |
| Categoria | Financeira pessoal: revela a remuneração |
| Titular | O usuário |
| Coleção | `users/{uid}/private_preferences/work_time_equivalent` |
| Finalidade | Comparação informativa escolhida pelo usuário, desativada por padrão |
| Base legal | Item E-09 (validação jurídica pendente, P8) |
| Retenção | Até o titular excluir (exclusão imediata, sem TTL). No futuro, também na eliminação da conta pelo job da P8 |
| Compartilhamento | Nenhum: workspace, Function, IA, notificação, relatório, log e armazenamento local ficam de fora |
| Subprocessador | Só o Firebase, que já está na lista |
| Localização | A mesma do Firestore do projeto |

**Direitos do titular.**
- Acesso e correção: a tela de Configurações.
- Eliminação: "Excluir" apaga o documento no servidor, com confirmação (E2E 3 confere o servidor).
- Revogação: o interruptor desativa o uso e mantém os dados até a exclusão.
- Exportação: P8, registrada (a preferência entra na exportação; `DATA_RETENTION_LIFECYCLE`, `PRIVACY_LGPD` §6.4).

**Matriz de evidência.**

| Seção do checklist | Resultado | Evidência |
| --- | --- | --- |
| 1. Inventário | PASS | Linha 25 do `PRIVACY_LGPD.md` e linha nova do `DATA_RETENTION_LIFECYCLE.md`, na mesma mudança |
| 2. Finalidade e minimização | PASS | Só os campos necessários. O valor por hora e os convertidos não são gravados. IA: o payload tem só as 5 chaves do contrato e não leva a renda em nenhuma forma (centavos, texto, reais); o histórico local também não (E2E 4). Os logs do navegador também não, nos quatro testes E2E |
| 3. Bases legais e transparência | PASS no escopo | A tela explica a natureza aproximada e a privacidade ("só você vê"). A base legal e a validação jurídica ficam fora do escopo (E-09, P8) |
| 4. Direitos do titular | PASS no escopo | Acesso, correção, revogação e eliminação imediata implementados e testados. A exportação é da P8 |
| 5. Eliminação | PASS no escopo | Exclusão real (`deleteDoc`), sem cópia: E2E 3 confere o servidor e a varredura E2E 4 confere todo o Firestore. A conta suspensa não apaga pelas Rules; a limitação está registrada para o job da P8 (linha 25) |
| 6. Retenção | PASS | Prazo "até o titular excluir", com o mecanismo implementado (exclusão pelo titular). Não é coleção que cresce |
| 7. Subprocessadores | PASS | Nenhum subprocessador novo. A IA não recebe a preferência (guarda e E2E 4) |
| 8. Armazenamento local | PASS | Sem `localStorage`, `sessionStorage`, IndexedDB ou React Query (guarda `:94`, mutantes G3/G13). Sem analytics nem telemetria no app. Risco do cache em memória do SDK registrado ([`cache-sdk.md`](cache-sdk.md)) |
| 9. Segurança | PASS | Resultado da revisão multi-tenant acima |
| 10. Incidentes | Fora do escopo | P7 |
| 11. Testes obrigatórios | PASS no escopo | Teste 6 (Rules no Emulator: dado inacessível a outro workspace e a outra pessoa) e a parte do teste 2 que cabe à preferência (eliminação conferida no servidor). Exportação, aceite e consentimento ficam fora do escopo |
| 12. Registro documental | PASS no escopo | `PRIVACY_LGPD.md`, `DATA_RETENTION_LIFECYCLE.md`, `DATA_MODEL.md`, `SECURITY_MODEL.md` e `ARCHITECTURE.md` atualizados |

**Pendências jurídicas e externas.** Base legal e validação jurídica do item 25 (E-09).

**Fora do escopo desta avaliação.**
- Validação jurídica (E-09, P8).
- Exportação e eliminação pelo job de conta (P8, §6.4).
- Aceite versionado (PR-AUTH-02, P9).
- Incidentes (P7).
- Limpeza do cache do SDK no logout (P6/P8; decisão de plataforma).

**Verificação.** Guarda 13/13, E2E 4/4 e Rules 10/10. O E2E inclui a varredura do Firestore, do `localStorage`, do payload e do histórico da IA, além dos logs do navegador.

## PASS — Observability and incident readiness (escopo P5-F)

**Escopo.**
- Quatro chamadas novas de log no navegador, em três arquivos:
  - leitura (`WorkTimeContext.tsx:84`);
  - salvar e excluir (`WorkTimeSettingsView.tsx:23-26`, `:117`, `:146`);
  - alternar o modo (`Header.tsx:49`).
- Mensagens de erro para o usuário.
- Nenhum backend, métrica, alerta ou auditoria novo.

**Mapa de sinais.** Nenhum sinal crítico novo: a preferência não é operação financeira, de billing nem de segurança. A falha de leitura mostra reais e oferece "Tentar de novo". A falha de gravação mostra a mensagem e preserva o formulário.

**Correlação e auditoria.** N/A (provado: não há callable, evento nem ação sensível nova).

**Matriz de evidência.**

| Seção do checklist | Resultado | Evidência |
| --- | --- | --- |
| 1. Logging | PASS | Os logs só levam uma mensagem fixa e o código do erro (`'desconhecido'` quando não há código), nunca o objeto de erro, a renda, o formulário ou a preferência. A guarda exige o formato literal (`work-time-guard.test.ts:109`), e os mutantes G5, G17 e G18 morrem. Em execução, os quatro testes E2E capturam o console e os erros não tratados de cada página e exigem a ausência da renda; os mutantes `console` e `pageerror` morrem. O app não tem captura de erros de terceiros, analytics nem telemetria |
| 4. Erros | PASS | Mensagens em pt-BR seguras: offline, falha ao salvar, falha ao excluir, falha ao carregar e falha ao trocar a exibição. Nenhum erro engolido: cada falha chega ao usuário |
| 2, 3, 5–13 | N/A ou fora do escopo | Provado: nenhum ponto de entrada de backend, métrica, alerta, auditoria, evento de segurança, reconciliação, webhook ou job novo |

**Fora do escopo desta avaliação.** Métricas, alertas, runbooks e reconciliação agendada (P7: PR-OBS-01, PR-OBS-02, PR-TX-04); DR (D-27, P6).

**Verificação.** Guarda 13/13 e mutantes G5, G17 e G18 (contra a guarda anterior, G5 e G18 passavam: `mutantes-guarda-anterior.py.txt`). E2E 4/4 com a captura de logs e os dois mutantes de log mortos.

## PASS — revisão de UI de produto em PT-BR

**Escopo.**
- Seção nova em Configurações.
- Alternador e aviso no Header.
- Valores T e G nas telas da matriz, só no modo tempo.
- Confirmações de anulação de lançamento e de despesa dividida com o valor em reais, só no modo tempo.
- Base `1730a1df`.

**Classificação das mudanças de UI** (todas requeridas pelo REQ-FUT-01):
- **Seção e card novos em Configurações:** o pedido exige a seção.
- **Alternador e aviso no Header:** o pedido exige o alternador.
- **No modo tempo:**
  - os pontos T convertidos e os rótulos e tooltips dos gráficos;
  - o eixo com 80 px e a margem esquerda 0, para o texto não ser cortado;
  - as duas confirmações com o valor em reais (M1).
- **No modo dinheiro**, o padrão: nenhuma mudança fora do card novo de Configurações. As provas pixel a pixel estão em [`visual/LEIAME.md`](visual/LEIAME.md):

  | Tela | Diferença |
  | --- | --- |
  | Gráficos | 0 px |
  | Dashboard | Ruído de antialias |
  | Relatórios | Só o ícone pulsante, que já era animado |
  | Configurações | Só o card novo |

**Evidências do código.**

| Critério | Evidência | Conclusão |
| --- | --- | --- |
| pt-BR e terminologia | `WorkTimeSettingsView.tsx` (rótulos, ajuda, prévia, mensagens), `Header.tsx:371-373`, `:520-528`, `calculation.ts` (`≈ 11 h 30 min`, "aproximadamente … de trabalho, equivalente a R$ …") | Português claro, marca de estimativa, espaço inseparável, `R$` no padrão pt-BR |
| Detalhes internos | Mensagens fixas (`WorkTimeSettingsView.tsx:37`, `:119`, `:149`, `:185`; `Header.tsx:50`) | Nenhum código, caminho ou mensagem do SDK aparece na tela |
| Estados | "Carregando sua preferência..." (`role="status"`), erro com "Tentar de novo" (`role="alert"`), sucesso "Preferência salva.", aviso pendente na exclusão, recusa offline | Loading, erro, sucesso e pendência cobertos |
| A11y | Interruptor com `role="switch"`, rótulos associados, grupo de rádio, alternador com `aria-pressed`, valor exato em reais no `title` e no `sr-only` | axe sem violação nova; sequência de teclado registrada |

**Evidências de execução.**
- E2E da P5-F 4/4: cadastro, validação, ativação, alternância, PF e PJ, outra conta, duas abas, recusa offline, IA, 360 px.
- Evidência visual em 1440, 390 e 360 px, claro e escuro, com transbordamento 0 nas 103 capturas e axe sem nó novo.
- Teclado: seção e Header.

**Comparação antes e depois.** As mudanças esperadas estão acima. Nenhuma mudança inesperada.

**Achados.** Nenhum aberto. Contraste do card novo e dos rótulos no escuro e transbordamento a 360 px foram corrigidos durante a evidência ([`visual/LEIAME.md`](visual/LEIAME.md), rodadas).

**Riscos residuais.** Débitos preexistentes, iguais nas duas árvores: o `select-name` do Dashboard, o contraste em Relatórios e no card esmeralda de Configurações, o `svg-img-alt` dos gráficos e o tooltip sem formatador do gráfico de distribuição no modo dinheiro.

**Bloqueadores.** Nenhum.

## PASS — regression release gate

**Escopo Git:**
- base `1730a1df`, pedida pelo usuário e igual ao `HEAD` e ao merge-base do worktree (nenhum commit);
- árvore do `verify:all` final `9cc4e445565313dae409725571fb72be801f6cb8`;
- mudanças sem commit: 46 arquivos alterados (6 documentos de produção, o plano, `firestore.rules`, `package.json`, o workflow e 37 de `src`) e 8 entradas novas (o módulo, a tela, os 3 unitários, a suíte de Rules, o E2E e `evidence/p5f/`).

**Superfícies:**
- frontend: as telas da matriz, Header, Configurações e Personalização;
- Rules: um bloco novo, só da preferência;
- testes, scripts e workflow;
- documentação.

Sem diff em Functions, índices, `firebase.json`, `.firebaserc`, lockfiles e `.claude/`.

**Proibições:**
- nenhum teste removido, pulado, `only`, `fixme`, timeout ou retry novo;
- nenhuma asserção afrouxada: as 4 revisões e os mutantes conferem; as mudanças nas specs só acrescentam formas procuradas e capturas;
- nenhum tipo, Rule ou validação relaxada: o bloco novo é estrito e as Rules existentes não mudaram;
- nenhum caminho legado (não há substituição de domínio);
- nenhum comando aponta para produção: Emulator `minhas-financas-local` e os scripts `run-*.sh`;
- plano atualizado (§20.14, §15, §2, §8 e §9.3).

**Evidências:**

| Etapa | Comando | Resultado |
| --- | --- | --- |
| Typecheck | `npm run typecheck` (no `verify:all`) | Saída 0 (raiz, inclusive `e2e/`, e Functions) |
| Lint das Functions | `npm run functions:lint` | 0 erros e 201 avisos, iguais à base |
| Build do frontend e das Functions | `npm run build`, `npm run functions:build` | OK: build de produção, build E2E e Functions |
| Unitários | `verify:fast` (Functions e frontend, com `test:unit:work-time`) | Functions 661/661; frontend 829/829 (+36 da P5-F) |
| Integração e Emulator | `test:integration:emulator` | Functions 969/969 no Emulator (`minhas-financas-local`, Java 21.0.11) |
| Rules no Emulator | `test:rules:*` (com `test:rules:work-time`) | Ferramentas e Rules 283/283 (+10 da P5-F) |
| E2E completo | `test:e2e` | 195/195 (17,0 min), sem `flaky` e com `retries` 0 |
| Smoke adjacente | E2E dirigido de caixa, relatórios, investimentos, recorrências e divisão; os mesmos fluxos de novo no E2E completo | 48/48 e 195/195 (17,0 min), sem `flaky` e com `retries` 0 |

**Skips e cobertura:**
- 0 skip, 0 todo, 0 cancelado e 0 retry no `verify:all` final;
- o repositório não tem ferramenta nem limiar de cobertura versionado, então a comparação é por contagem: 2.887 → 2.937 (+50, só as três suítes novas).

**Mudanças de superfície:**
- **UI:** só a seção e o card novos, e o alternador e o aviso do Header quando a preferência está ativa. No modo tempo, os pontos T e G e as duas confirmações com o valor em reais. O modo dinheiro é idêntico à base ([`visual/LEIAME.md`](visual/LEIAME.md)).
- **Textos:** novos, em pt-BR (seção, aviso, alternador, mensagens e textos para leitor de tela).
- **Rotas:** nenhuma. A seção é um modo interno de Configurações (`tempo_trabalho`).
- **Contratos:** a coleção privada nova e campos opcionais de exibição em view models do frontend (`FinancialKPI.cents`, `displayValue: ReactNode`). DTOs do backend, callables e documentos financeiros não mudaram.

**Riscos residuais:** os da §20.14, sem bloqueador.

**Bloqueadores:** nenhum.

**Skills exigidas pela superfície** (todas `PASS`, acima):
- `financial-domain-integrity`;
- `firestore-scale-cost-review`;
- `multi-tenant-security-review`;
- `privacy-lgpd-data-lifecycle`;
- `observability-incident-readiness` (logs do navegador);
- `ptbr-product-ui-review`.

`billing-entitlement-integrity`, `firebase-production-readiness` e `saas-commercial-readiness` não foram acionadas: o diff não toca billing, ambiente, `firebase.json`, Functions, App Check, segredos, IAM nem página pública. A única mudança de pipeline é a suíte nova no `predeploy:rules`, coberta por este gate.

## Auditoria independente

Revisor independente, somente leitura, em quatro passadas. Achados e tratamento:

**Revisão 1** ([`revisoes/revisao-1.md`](revisoes/revisao-1.md)):
- **M1 (MEDIUM): aprovação vendo só o tempo.** O usuário podia aprovar uma operação vendo só "≈ 6 h", sem nenhum R$ na tela.
  - Valor ao lado de ação que move dinheiro voltou a BRL (R-CF): ocorrências de recorrência que aguardam ação, operações de investimento, itens de reembolso e partes da divisão.
  - A confirmação de anulação de lançamento passou a trazer o valor em reais no modo tempo.
- **M2 (MEDIUM): eixo Y cortado.** Agora usa o rótulo compacto (`≈ 124 h`).
- **L1 (LOW): textos sem o valor em reais.** Convertidos para o mesmo elemento com `title` e `sr-only`, ou mantidos em BRL (frases compostas).
- **L2 (LOW): prévia do tema no modo tempo.** O Header da prévia ficou forçado em dinheiro, sem alternador nem aviso.
- **L3 (LOW): tela presa sem conexão.** O modal fecha durante a exclusão, com aviso pendente, e há recusa offline com mensagem.
- **L4 (LOW): falsos negativos nas guardas.**
  - Guarda linha a linha.
  - Detecção de `import(`.
  - Curinga recursivo genérico.
  - Varredura com `listDocuments()`.
- **I1–I4 (INFO).**
  - Limitação da conta suspensa registrada.
  - `aria-live` saiu do painel.
  - Mensagem da renda acima do máximo.
  - Roteiros versionados como `.txt`.

**Revisão 2** ([`revisoes/revisao-2.md`](revisoes/revisao-2.md)):
- **M1-R: anulação de despesa dividida.** Confirma com o valor em reais no modo tempo.
- **Borda do M2.** Margem esquerda 0 e largura de 80 px, só no modo tempo.
- **L-NOVO: roteiro de evidência dentro de `e2e/`.** Saiu de lá.
- **INFO.**
  - Teste offline no E2E.
  - Mais 7 pontos R-* linha a linha.

**Revisão 3** ([`revisoes/revisao-3.md`](revisoes/revisao-3.md)): nenhum BLOCKER, HIGH, MEDIUM ou LOW. Três INFO:
- **I5: matriz atrasada.**
  - A linha da despesa dividida passou a citar a confirmação em reais, com uma linha R-CF nova.
  - A linha dos gráficos ganhou a margem 0.
  - BRL passou de 128 para 129.
- **I6: entradas da guarda linha a linha.** São 19 (não 20). Doze delas ganharam `converted`. A que ficou sem ele é a anulação da despesa dividida, cujo total no mesmo modal é convertido. G30 e G31 passavam na guarda anterior e agora morrem.
- **I7: varredura de renda no E2E.** Passou a pegar a renda em reais, como número (`4400`) ou texto (`4400,00`, `4400.00`), no Firestore, no `localStorage`, no payload e no histórico da IA. O perfil passou a ser conferido com a mesma função, que ignora os carimbos de tempo. Antes, `JSON.stringify` podia dar falso positivo com `_nanoseconds`. O mutante E2E passa na spec anterior e reprova na final.

**Depois da revisão 3**, conferindo o pedido item por item, entraram dois reforços:
- **Logs:** prova em execução da ausência da renda nos logs do navegador. Os quatro testes E2E capturam o console e os erros não tratados, e os dois mutantes de log morrem.
- **Sessão:** guarda estrutural para a troca de conta e as respostas atrasadas. G32–G34 passavam na guarda anterior e agora morrem.

Os dois mudam só testes; o `src` é o mesmo da evidência visual r6.

**Revisão 4** ([`revisoes/revisao-4.md`](revisoes/revisao-4.md)), sobre o delta desde a revisão 3: as mudanças estão corretas e não enfraquecem asserção anterior; nenhum falso positivo provável no E2E. 2 LOW e 3 INFO:
- **L1: a guarda da sessão não travava o uso de `current`.** Passou a exigir `current` no `snapshot` e no `status` exposto, e `state.` só na derivação. G35 passava na guarda anterior e agora morre.
- **L2: documentação atrás do estado.** A árvore e o resultado do `verify:all` e `execucoes.md` foram atualizados depois da execução final.
- **I8: o `converted` dependia do nome da variável do hook.** Em `ClientsReceivablesView` o hook se chama `moneyDisplay`. A guarda passou a procurar o método da camada (`.cents(`, `.reais(`). G36 passava e agora morre.
- **I9: linha citada da guarda.** O teste do modo dinheiro idêntico está em `:327`; corrigido.
- **I10: a renda como texto puro (`"4400"`) não era procurada.** `carriesIncome` passou a aceitar o texto que é só a renda em reais, e o regex de JSON passou a aceitar o valor entre aspas. O mutante do E2E com `texto_puro` passa despercebido na spec anterior e é acusado na final.
