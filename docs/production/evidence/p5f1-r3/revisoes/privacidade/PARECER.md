FAIL — Privacy/LGPD data lifecycle

Escopo do veredito: a superfície da P5-F.1-R3 (marcas de aplicação da projeção, B03) e tudo o que o plano atribui à P5 ou antes e que o diff exercita. O veredito não cobre o checklist integral, que só se aplica em release e na P10. Isto não é parecer jurídico: a qualificação jurídica fica com o E-09.

Revisão independente, somente leitura. As únicas escritas foram em `$S/p5f1r3/revisoes/privacidade/` (com `S=<scratchpad>`) e no índice temporário do `final-tree.sh`. Não houve Emulator, Firebase real, `npm run dev`/`preview` nem leitura de `.env*`.

---

## Escopo

**Árvores**
- Base: R2A entregue `f82679226ec93e18f906731be09d0675326fd764`.
- Código revisado: `905ed3d67ecb9cdff2dfd01e81271e241809e29b`. As sondas e os testes de backend rodaram sobre ela.
- Estado do worktree no fechamento: `e37898e9b328148278640c9fb61f9c9a04d82b26`. Ele difere de `af3c872fcebe4b19189ab6721e36f7c7a53228ad` só em `e2e/work-time-b03.spec.ts`. O worktree mudou durante a revisão (respostas a outras revisões). Entre `905ed3d6` e `e37898e9`:
  - `functions/src`, `src`, `firestore.rules`, `firestore.indexes.json`, `PRIVACY_LGPD.md`, `DATA_RETENTION_LIFECYCLE.md`, `DATA_MODEL.md` e o plano mestre não mudaram, exceto o texto de `src/modules/work-time/messages.ts` (`ESTIMATE_UPDATING`) e `functions/src/cash/__tests__/projectionMarks.integration.test.ts`;
  - o resto da diferença é teste (Rules de ataque, E2E, unitários), evidência e documentos de segurança.
- Os testes unitários do cliente e os typechecks foram repetidos sobre o estado final (seção Verificação). Qualquer mudança posterior nesses caminhos invalida este parecer.

**Fluxos avaliados**
- Gatilho de caixa: a marca muda na mesma transação do delta (`functions/src/cash/periods.ts:1311,1387-1401`), com registro de incidente de marca (`periods.ts:1193-1212`).
- Reconstrução:
  - âncora por documento da base (`functions/src/cash/rebuild.ts:1262-1277`);
  - etiqueta `projectionGeneration` nos meses (`rebuild.ts:1588`);
  - troca de `markSlot` (`rebuild.ts:1632`);
  - log de violação de contrato (`rebuild.ts:1206-1211`).
- Leitura do cliente:
  - transação só de leitura de meses e marcas (`src/modules/work-time/projectionReads.ts:18-48`);
  - leitura por id com o conteúdo bruto (`src/modules/transactions/api.ts:169-177`);
  - impressão digital (`src/modules/work-time/receivableReversal.ts:116-121`; `src/modules/work-time/projectionProof.ts:82-85`);
  - estimativa em memória (`src/modules/work-time/useIncomeEstimateWith.ts`).
- Log novo `cash_projection_mark.broken` (`functions/src/triggers/transactions.ts:307-313`).

**Coleções e campos**
- `workspaces/{id}/cash_projection_marks/{transactionId}` (nova).
- `cash_report_periods/{AAAA-MM}.projectionGeneration`.
- `cash_period_events/projection_state`: `markSlot`, `markRecoveryNeeded`, `markIssueCount`, `markIssueMaxEventTime`, `lastMarkIssueCode`, `lastMarkIssueTransactionId`, `lastMarkIssueAt`.
- `markSlot` do checkpoint da reconstrução.

**Integrações e textos**
- Integrações: nenhuma nova. O hash é local (`node:crypto` e WebCrypto). Os dados ficam no Firestore e os logs no Cloud Logging, os dois já listados em `docs/production/SUBPROCESSORS.md`.
- Textos avaliados:
  - `DATA_MODEL.md:52,140`, `DATA_RETENTION_LIFECYCLE.md:104`, `BACKUP_RESTORE_DR.md:52,117`, `SECURITY_MODEL.md:124`, `ARCHITECTURE.md`;
  - `PRIVACY_LGPD.md`, que a R3 não alterou;
  - `evidence/p5f1-r3/DESENHO-MARCAS-B03.md` e `matriz-requisitos.md`;
  - a mensagem `ESTIMATE_UPDATING`.

---

## Inventário

Inventário da superfície da R3, tirado do código. As linhas A e B não constam do inventário canônico (`PRIVACY_LGPD.md` §3, linhas 39-72; busca por `cash_projection_marks`, "impressão digital" ou "marcas de aplicação" nesse arquivo: zero). Isso é o achado M-PRI-01.

| # | Categoria de dado | Titular | Coleção/campo | Finalidade | Base legal | Retenção | Compartilhamento/subprocessador | Localização | Evidência |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | **Impressão digital do conteúdo** do lançamento: SHA-256 sem sal da serialização canônica do documento inteiro. Entram `userId`, `createdBy`, `updatedBy`, `description`, `supplier`, `costCenter`, valores, datas, conta e carimbos. É dado pseudonimizado derivado do dado financeiro (inventário, linha 12) e do texto livre (linha 13), ligado ao lançamento pelo id do documento | Usuário dono do workspace (no PF, comportamento financeiro), membros autores e editores, terceiros citados em texto livre | `anchors.{a,b}.fp`, `chains.{a,b}.base`, `chains.{a,b}.node.fp`, `chains.{a,b}.pending[].{b,a}.fp` | Provar qual conteúdo de cada lançamento a projeção mensal contém (INV-M) e só então converter a estimativa de tempo de trabalho com receitas desconsideradas | **Não registrada** (E-09) | Sem `expiresAt`; acompanha o lançamento (produção: indefinida até a eliminação do workspace, P8). Versão anterior retida: na geração vigente até a próxima reconstrução; nas gerações superadas, sem prazo (L-PRI-02). Exclusão física (só desenvolvimento): marca fica `deleted`, com resíduo | `get` por todo membro ativo (owner/admin/member/viewer); `list`, consulta de grupo e escrita negadas. Subprocessador: Google Cloud Firestore (já listado) | Firestore `southamerica-east1` (`firebase.json:4`) | `functions/src/cash/projectionMarks.ts:142-146,483-511`; `periods.ts:1387-1401`; `rebuild.ts:1262-1277`; `firestore.rules:459,818-822`; sondas `sonda-residuo-marca` e `sonda-confirmacao` |
| B | Metadados da marca: `workspaceId`, `transactionId`, `schemaVersion`, `updatedAt` (último gatilho ou âncora), `g`/`cut` (geração e corte), `root`, `node.k`, `broken` (código fixo). Metadado de atividade, por pseudônimo do lançamento | Os mesmos de A, indiretamente | Mesma coleção | A mesma de A | Não registrada (E-09) | Igual a A | Igual a A | Igual a A | `projectionMarks.ts:483-511`. Sem valor, mês, categoria, descrição ou preferência (`projectionMarks.ts:36`; `DESENHO-MARCAS-B03.md:41`). `updatedAt` e `cut` não dizem nada além de `transactions.updatedAt` e `cash_report_periods.rebuiltAt`, já legíveis |
| C | `projectionGeneration {id, cutoff}` no mês: `g0`, ou o `randomUUID()` da reconstrução, e o corte. Metadado operacional, não pessoal | Nenhum titular direto | `cash_report_periods/{AAAA-MM}` | Escolher a cadeia de cada marca na prova | Não se aplica | Igual ao mês | Todo membro ativo, como antes (`firestore.rules:792-799`) | Firestore `southamerica-east1` | `periods.ts:834,860`; `rebuild.ts:373,1588` |
| D | Estado operacional da recuperação de marcas: posição, contadores, maior instante de incidente, código, id do último lançamento afetado. Sem dado pessoal (só ids e códigos) | Nenhum titular direto | `cash_period_events/projection_state` e o checkpoint da reconstrução | Recuperação após reconstrução | Não se aplica | `projection_state` sem `expiresAt` (`DATA_MODEL.md`) | Nenhum cliente (`firestore.rules:804-806`) | Firestore `southamerica-east1` | `periods.ts:1071,1193-1212`; `rebuild.ts:284,315,1632` |
| E | Logs novos. `cash_projection_mark.broken`: operação, `requestId` da entrega, `workspaceId`, `transactionId`, ação e `reason` (código fixo). `cash_rebuild_contract_violation`: `workspaceId`, `transactionId`, `field: "content"`. Identificadores pseudônimos, sem conteúdo, valor, uid nem `error.message` | Usuário, indiretamente | Cloud Logging | Operação e diagnóstico | E-09 | E-08 (não verificado) | Google Cloud (já listado) | E-08 | `functions/src/triggers/transactions.ts:307-313`; `rebuild.ts:1206-1211`. O logger só grava campos sanitizados e o nome do erro com as linhas da pilha (`functions/src/shared/logger.ts`: `sanitizeLogFields`, `sanitizedStack`, `createOperationLogger`) |
| F | Cliente, em memória: impressões calculadas, documentos normalizados das desconsideradas e dos espelhos de estorno, meses lidos e marcas brutas. O documento bruto do lançamento só existe durante a leitura e é descartado depois da impressão | O próprio usuário, na sessão | React Query em memória (consulta `by-ids`) e cache em memória do SDK | A mesma de A | E-09 | Até o logout ou a troca de conta (`queryClient.clear()`, `src/contexts/AuthContext.tsx:75,111`). Firestore sem persistência local (`src/lib/firebase.ts:38`); a transação de leitura não usa o cache local | Não sai do navegador: SHA-256 por WebCrypto (`projectionProof.ts:84`). Nenhum `localStorage`, `sessionStorage` nem IndexedDB (busca no diff: zero; guarda `tests/unit/work-time-guard.test.ts:312`) | Navegador | `api.ts:169-177` → `receivableReversal.ts:116-121`: `raw` não é devolvido. Único consumidor: `useIncomeEstimate.ts:23` |
| G | Cliente, memória de módulo: mapa `reportFetchStarts` com o hash da chave do relatório (contém uid, workspace e papel) e um número de ordem | Usuário | `src/modules/reports/queryKeys.ts:93-104`; chave em `queryKeys.ts:12-18` | Releitura do relatório pela escuta (RR-R2A-04) | E-09 | Até recarregar a página; **não** é limpo no logout (INFO-02) | Nenhum | Navegador | `queryKeys.ts:104` |

### Análise das perguntas do pedido (§6) e do coordenador

**1. A impressão do documento inteiro, visível a viewer, revela algo além do que ele já lê em `transactions`?**

- **Versão atual: não.**
  - Quem lê a marca é quem lê o lançamento, pelo mesmo predicado `isMember` (`firestore.rules:42-46,66-68`; `transactions` em `618-621`; marcas em `818-822`). Com a função do próprio cliente, o viewer calcula exatamente a impressão que o gatilho grava.
  - `sonda-versao-atual`: impressão do Admin SDK igual à do SDK web; mais 1 µs no `updatedAt` muda a impressão.
  - Igualdade com um documento que ele já lê não acrescenta informação.
- **Versões anteriores: sim, por tentativa (confirmação de hipótese), não por leitura.**
  - A marca guarda impressões de conteúdos que o lançamento não tem mais:
    - a âncora e a base da geração vigente (a versão no corte da reconstrução);
    - o nó da geração superada, que o gatilho regrava intacto (`projectionMarks.ts:491-492`);
    - as pendências.
  - `sonda-residuo-marca`, com as funções reais:
    - depois de uma correção V1 → V2, sobram **3 cópias de fp(V1)** (`anchors.b.fp`, `chains.b.base`, `chains.a.node.fp`);
    - elas continuam depois de uma exclusão física de desenvolvimento e de uma reconstrução seguinte, que não tocam mais a marca.
  - `sonda-confirmacao`, com a função real (≈203 mil impressões/s por núcleo):
    - **Versão de criação.** `createdAt` e `updatedAt` são gravados com o mesmo `serverTimestamp` (`functions/src/cash/createTransaction.ts:270-271`) e `createdAt` nunca muda. O instante é conhecido, e cada hipótese custa uma impressão: descrição e categoria antigas confirmadas em 49.388 tentativas, em 277 ms.
    - **Versão produzida por edição.** O `updatedAt`, em µs na produção, fica numa janela antes do carimbo do log do gatilho: 25 ms × 40 categorias em 2,5 s; 1 s × 40 categorias ≈ 3,3 min por núcleo.
    - **Busca aberta de texto livre:** inviável em CPU (5 s × 10⁶ descrições ≈ 285 dias por núcleo).
- **O que as marcas acrescentam ao que o viewer já tinha.**
  - Pelo catch-all (PR-RULES-02, P6), o viewer já lê em `activity_logs`, por 365 dias (`functions/src/triggers/transactions.ts:180-228`):
    - a descrição de cada estado "depois";
    - o efeito em centavos antes e depois;
    - os nomes dos campos alterados.
  - O próprio lançamento traz `cashEntry.requestHash`, hash sem sal do payload de criação (`createTransaction.ts:250`; `functions/src/shared/idempotency.ts:49-51`). Ele já permite confirmar o conteúdo da criação com uma impressão por hipótese, para sempre (INFO-01; `sonda-requesthash-preexistente`: descrição original confirmada entre 421.338 hipóteses em 2,0 s).
  - O acréscimo real das marcas é:
    - (i) confirmar valores antigos de campos que não vão ao log (categoria, data, conta, forma de pagamento, fornecedor, centro de custo, editor) de versões vigentes num corte de reconstrução. O produto reserva antes e depois de valor, tipo e data a owner e admin (`cash_events`), e um membro que entrou depois nunca viu essas versões;
    - (ii) essa possibilidade sobreviver aos 365 dias do log e a uma correção ou anonimização (P8).
  - O risco é baixo, mas o dado **não** é "sem dado pessoal", como afirma `DATA_RETENTION_LIFECYCLE.md:104`.
- **Meses movimentados.**
  - A marca não guarda meses (decisão correta, registrada em `matriz-requisitos.md:26`).
  - `projectionGeneration` só acrescenta ao mês um id aleatório e o corte, equivalentes a `rebuildId` e `rebuiltAt`, já legíveis.
  - O `updatedAt` da marca equivale ao do lançamento, mais a latência do gatilho.
  - A R3 não expõe "meses movimentados" de forma nova. Os meses com atividade e o detalhe diário já são legíveis por todo membro em `cash_report_periods`, por desenho (P5-C1).

**2. A retenção da marca de lançamento excluído e a eliminação do workspace estão tratadas?**

- **Lançamento excluído: em parte.**
  - Na produção não há exclusão física de `transactions`:
    - as Rules negam o delete (`firestore.rules:618-621`);
    - nenhuma Function apaga lançamento (busca por `delete(` e `recursiveDelete` em `functions/src`, fora de testes);
    - a única via no repositório é a ferramenta de desenvolvimento `tools/investments/limpar-investimentos.mjs:383-419`, que a P6 vai restringir.
  - Em desenvolvimento, a marca fica `deleted` e prova parte zero, como documentado (`DATA_RETENTION_LIFECYCLE.md:104`). Mas ela fica com as impressões das versões anteriores e nenhum escritor volta a tocá-la (`sonda-residuo-marca`, passos 4–5).
  - O id de um lançamento apagado continua em `activity_logs.entityId`, legível a todo membro. Esse resíduo não tem prazo nem está documentado (L-PRI-02).
- **Eliminação do workspace: não implementada** (P8, PR-AUTH-01).
  - A coleção é subcoleção de `workspaces/{id}` e sairia numa eliminação recursiva; o documento de retenção registra "sai com o workspace".
  - A lista canônica das superfícies da exclusão (`PRIVACY_LGPD.md:150`, "O teste de exclusão (§14) percorre essa lista") não inclui a coleção.
  - Nenhum documento registra que a anonimização ou correção a pedido do titular, num workspace que permanece (D-07, itens 2 e 3), precisa eliminar as impressões das versões anteriores. Isso vale para as marcas e para o `requestHash`.
  - Achado M-PRI-01.

---

## Direitos do titular

| Direito | Fluxo implementado (CURRENT) | Efeito da R3 | Prazo | Evidência de teste |
| --- | --- | --- | --- | --- |
| Confirmação e acesso | Nenhum (P8, PR-AUTH-01) | Cria dado derivado por lançamento. A P8 precisa decidir se ele entra na exportação; não está registrado (M-PRI-01) | Não definido (E-09) | Nenhum (P8) |
| Portabilidade | Nenhum (P8, PR-AUTH-01) | Dado técnico derivado, fora do que o titular forneceu; decisão da P8 | Não definido | Nenhum |
| Correção | Correção do lançamento pela callable do domínio (`updateCashTransaction`); canal do titular só na P8 | A marca acompanha a correção (nó novo), mas as impressões da versão corrigida continuam: na geração vigente até a próxima reconstrução, nas superadas sem prazo. Continuam confirmáveis por hipótese | Não definido | `sonda-residuo-marca`, `sonda-confirmacao`; nenhum teste no repositório |
| Anonimização, bloqueio, eliminação | Nenhum (P8: PR-AUTH-01, D-07, PR-CR-05). Sem exclusão física de lançamento na produção | Workspace eliminado: a coleção sai numa eliminação recursiva, mas falta na lista §6.4. Workspace mantido: impressões anteriores à anonimização ficam | Não definido | O teste de integração "lançamento apagado" (`functions/src/cash/__tests__/projectionMarks.integration.test.ts:501`) só prova parte zero (integridade), não eliminação |
| Informação sobre compartilhamento | Nenhum (P8/P9) | Nenhum terceiro novo | — | — |
| Revogação de consentimento | — | N/A, com prova: a marca não depende de consentimento. É gravada pelo gatilho para todo lançamento (`periods.ts:1387`); a estimativa que a lê é opcional e só em memória | — | — |

---

## Matriz de evidência

Coluna "Resultado": a parte do checklist exercitada pela R3. "—" quando nada da seção está no escopo; o motivo vai na última coluna, e o item não conta como N/A nem PASS.

| Seção do checklist | Resultado | Evidência | Fora do escopo (ID) |
| --- | --- | --- | --- |
| 1. Inventário e registro | **FAIL** | M-PRI-01: coleção nova com dado derivado do lançamento (inclusive texto livre e autoria) ausente do inventário canônico; classificação "sem dado pessoal" (`DATA_RETENTION_LIFECYCLE.md:104`) contrariada pelas sondas | Validação jurídica do inventário (E-09, P8) |
| 2. Finalidade, necessidade e minimização | **FAIL** | A favor: sem valor, mês, categoria, descrição ou preferência na marca; logs só com ids e códigos fixos; marca por lançamento justificada (INFO-04). Contra: L-PRI-02, componentes de gerações superadas sem nenhum leitor (`projectionMarks.ts:276-277`; `projectionProof.ts:221-245`) mantidos pelo gatilho | — |
| 3. Bases legais, transparência e aceite | **FAIL** | A finalidade nova (prova da projeção e da estimativa) não tem base legal registrada no inventário (consequência de M-PRI-01). Aceite e consentimento não afetados. Nenhum texto ao usuário contradiz o código (`ESTIMATE_UPDATING`, `src/modules/work-time/messages.ts:88`) | Validação da base legal (E-09, P8); aceite (PR-AUTH-02, P9) |
| 4. Direitos do titular | — | Nenhum fluxo no escopo; o impacto da R3 nos fluxos futuros está em M-PRI-01 | PR-AUTH-01, PR-PRIV-01, PR-CR-05 (P8) |
| 5. Eliminação, exclusão e anonimização | **FAIL** | A favor: restauração nunca reescreve marcas; a reconstrução as recria de `transactions` (`BACKUP_RESTORE_DR.md:52,117`), então um restore não traz de volta marca de dado eliminado sem passar pelas eliminações reaplicadas (passo 7). Contra: §6.4 sem a coleção e sem o requisito de eliminar impressões de versões anteriores (M-PRI-01); resíduo depois da exclusão (L-PRI-02) | Fluxos de eliminação e anonimização (PR-AUTH-01, D-07, P8); prazo em backup (D-18, D-27, E-07) |
| 6. Retenção | PASS | Linha própria (`DATA_RETENTION_LIFECYCLE.md:104`; `DATA_MODEL.md:140`) coerente com o código: a marca não grava `expiresAt` (`projectionMarks.ts:483-511`); tamanho limitado (2 posições, `MAX_MARK_PENDING = 16`, `projectionMarks.ts:43`); prazo igual ao do lançamento (dado financeiro "não expira, por desenho", `PRIVACY_LGPD.md:56`) | Prazo por categoria (D-18, P8); mecanismo de saída com o workspace (PR-AUTH-01, P8) |
| 7. Subprocessadores e transferência internacional | PASS | Nenhum terceiro novo. Leitura só pelo Firestore (`projectionReads.ts:1-3`); hash local (`projectionMarks.ts:1`; `projectionProof.ts:84`); dados no Firestore `southamerica-east1` e logs no Cloud Logging, ambos em `SUBPROCESSORS.md` | DPAs e mecanismo de transferência (E-09) |
| 8. Cookies, armazenamento local e trackers | PASS | Tudo em memória, limpo no logout e na troca de conta (`AuthContext.tsx:75,111`); Firestore sem persistência local (`firebase.ts:38`); nenhuma API de armazenamento no diff; guarda de `projectionReads.ts` (`work-time-guard.test.ts:312`, sem cache, escuta nem escrita) aprovada. O mapa de INFO-02 não persiste e se soma ao resíduo de memória já registrado | Cookies (D-26, P8/P9); cache em memória do SDK (decisão P6/P8, `docs/production/evidence/p5f/cache-sdk.md`) |
| 9. Segurança como obrigação de privacidade | PASS | Mesmo predicado de leitura de `transactions` (`firestore.rules:42-46,66-68,618-621,818-822`); `list`, escrita e consulta de grupo negadas; fora da catch-all (`firestore.rules:459,1168-1173`). Suítes de Rules no Emulator herdadas (base 6/6 em `$S/p5f1r3/logs/rules-marcas-oficial-2.log`; suíte de ataques incorporada depois), **não reproduzidas aqui**: Emulator vedado a este revisor | App Check e ambientes (P6) |
| 10. Incidentes com dados pessoais | — | O diff não cria superfície de incidente com dado pessoal (os logs novos não levam conteúdo) | PR-OBS-02 (P7), E-09 |
| 11. Testes obrigatórios | PASS (itens do escopo) | Teste 6 (isolamento por workspace da coleção nova): suítes de Rules herdadas. Logout limpa o cache de consultas (`PRIVACY_LGPD.md` §14, item 8): código (`AuthContext.tsx:75`) e E2E da P1 `e2e/workspace-membership.spec.ts` (herdado) | Testes 1–5 e 7 (P8/P9) |
| 12. Registro documental | **FAIL** | `PRIVACY_LGPD.md` não mudou na R3 (diff vazio) e não cita a coleção; classificação não sustentada em `DATA_RETENTION_LIFECYCLE.md:104`; o plano não tem a seção §20.18 citada pelo desenho (INFO-03) | Validação jurídica (E-09) |

---

## Pendências jurídicas/externas

- **E-09 (P8):**
  - qualificação jurídica da impressão digital: pseudonimizada × anonimizada; referências a confirmar: LGPD art. 5º, III, art. 12 e art. 13, §4º;
  - base legal da finalidade nova;
  - papel de controlador ou operador sobre o derivado do texto livre de terceiros;
  - validação do inventário.
- **D-07 e D-18 (P8):** tratamento e prazo das impressões de versões anteriores na correção ou anonimização (marcas e `requestHash`); prazo dos dados financeiros e derivados.
- **E-08 (P7):** retenção no Cloud Logging dos eventos `cash_projection_mark.broken` e `cash_rebuild_contract_violation`.
- **E-07 e D-27 (P7):** prazo em que um dado eliminado continua em backup ou PITR. O runbook já recria as marcas a partir de `transactions`.

---

## Achados bloqueantes

Por severidade: **HIGH 0 · MEDIUM 1 (M-PRI-01) · LOW 1 (L-PRI-02) · INFO 4.**

### M-PRI-01 — MEDIUM — Coleção nova fora do inventário canônico, com classificação "sem dado pessoal" não sustentada e sem o requisito para a P8

**Cenário.**
- A R3 cria `cash_projection_marks`, legível por todo membro ativo (`firestore.rules:818-822`).
- Cada marca guarda SHA-256 sem sal do documento inteiro do lançamento (`projectionMarks.ts:142-146`), com autoria, texto livre e carimbos (`createTransaction.ts:270-271`; `mutateTransaction.ts:649,665`), ligado ao lançamento pelo id.
- A R3 documentou a coleção em `DATA_MODEL.md:140`, `DATA_RETENTION_LIFECYCLE.md:104` (como "sem valor nem dado pessoal"), `BACKUP_RESTORE_DR.md:52,117` e `SECURITY_MODEL.md:124`, mas não alterou `PRIVACY_LGPD.md`:
  - §3 sem linha;
  - §6.4 (linha 150) sem a coleção;
  - nenhuma análise da impressão.
- A matriz diz "metadados de meses analisados … análise no desenho §4" (`matriz-requisitos.md:61`), mas o desenho só lista o que não entra (`DESENHO-MARCAS-B03.md:41`) e não analisa a impressão.
- As sondas mostram que impressões de versões anteriores ficam e são confirmáveis por hipótese: versão de criação em milissegundos; versão de edição em segundos a minutos por núcleo.

**Risco ao titular.**
- Baixo, mas real. Qualquer membro com uma hipótese pode confirmar valores antigos de um lançamento corrigido, por exemplo:
  - o nome de terceiro ou a referência de saúde retirados da descrição, depois dos 365 dias do log;
  - categoria, data, conta, forma de pagamento ou editor anteriores.
- Isso alcança informação que o RBAC reserva a owner e admin (`cash_events`) e versões que um membro novo nunca viu.

**Impacto regulatório.**
- O inventário (checklist §1; regra do próprio `PRIVACY_LGPD.md` §3, "atualizado na mesma mudança") fica desatualizado em relação ao código.
- A classificação errada tiraria a coleção da cobertura de correção, anonimização e eliminação da P8 (art. 18, III, IV e VI, a confirmar com o jurídico), porque o teste de exclusão percorre a lista do §6.4.

**Remediação** (só documentos; nenhuma mudança de código é exigida por este achado):
1. Em `PRIVACY_LGPD.md` §3, nova linha 26 "Marcas de aplicação da projeção (P5-F.1-R3)", com:
   - dados (impressões e metadados), categoria (pseudonimizado derivado das linhas 12 e 13) e titulares;
   - origem (gatilho e reconstrução) e finalidade;
   - base legal E-09;
   - compartilhamento (`get` por todo membro ativo; nenhum terceiro novo);
   - retenção (a do lançamento, mais o resíduo de versões anteriores);
   - o risco de confirmação por hipótese.
2. Em `DATA_RETENTION_LIFECYCLE.md:104`, trocar "sem valor nem dado pessoal" por "sem valor; impressões derivadas do conteúdo do lançamento (dado pseudonimizado)".
3. Em `PRIVACY_LGPD.md` §6.4 (linha 150), incluir `cash_projection_marks` e o requisito para a P8:
   - eliminação junto com o workspace;
   - na correção ou anonimização a pedido do titular num workspace que permanece (D-07, itens 2 e 3), eliminar as impressões das versões anteriores. Por exemplo: apagar a marca e reconstruir a projeção do workspace, ou duas reconstruções para girar as posições;
   - o mesmo para `cashEntry.requestHash` (INFO-01).
4. Em `DESENHO-MARCAS-B03.md` §3/§4, ou na seção da R3 no plano, registrar:
   - a análise pedida no §6, com os números das sondas;
   - a decisão de usar o documento inteiro (identidade sem depender do contrato dos escritores) contra a alternativa de impressão só dos campos de efeito, que expõe menos mas exige manter a lista igual à fórmula nos dois SDKs;
   - o risco residual aceito.
5. Na linha "Preferência de tempo de trabalho" do `PRIVACY_LGPD.md` §9 (linha 201), citar que o cache em memória da estimativa agora inclui marcas e impressões, limpas no logout.

### L-PRI-02 — LOW — Impressões de gerações superadas guardadas sem finalidade e sem prazo

**Cenário.**
- Depois de qualquer reconstrução, a posição da geração anterior continua com cadeia e âncora (impressões) que nenhuma leitura usa:
  - o backend filtra pelo `g` (`projectionMarks.ts:276-277`);
  - o cliente só usa a geração dos meses lidos e componentes de corte mais novo (`projectionProof.ts:221-245`).
- Mesmo assim, o gatilho regrava essas componentes a cada evento (`projectionMarks.ts:491-492`, chamado de `periods.ts:1400-1401`).
- A varredura seguinte só sobrescreve a âncora da posição preparada. A cadeia superada só some se um evento posterior ao próximo corte tocar o lançamento, e não some nunca para um lançamento apagado ou não editado depois.
- `sonda-residuo-marca`: fp(V1) continua em `chains.a.node.fp` (g0) depois da correção, da exclusão e de R2.

**Risco ao titular.** Baixo: dado pseudonimizado, de tamanho limitado, que prolonga sem necessidade a janela de confirmação descrita em M-PRI-01.

**Impacto regulatório.** Necessidade e término do tratamento (LGPD art. 6º, III; arts. 15 e 16, a confirmar). O checklist §2 pede que "campos sem uso" sejam removidos.

**Remediação.** Uma das duas:
- Ao regravar a marca, o gatilho mantém só as componentes cuja geração (`g`) é a vigente ou a preparada (`state.categoryGeneration`, `state.categoryStaging?.generation`). É a mesma escrita, sem leitura nem escrita a mais. Exige teste unitário, a propriedade INV-M, mutante e revisão de integridade financeira, porque é o caminho da prova.
- Ou: demonstrar uso dessas componentes e registrar no inventário a necessidade e o prazo do resíduo.

---

## Achados não bloqueantes (INFO), com justificativa e risco residual

- **INFO-01 — `cashEntry.requestHash` (pré-existente, P3-A, fora do diff).**
  - O lançamento, legível por todo membro, guarda o SHA-256 sem sal do payload de criação, sem instante nem segredo (`createTransaction.ts:250`; `idempotency.ts:49-51`; payload em `functions/src/cash/contracts.ts:105-137,222-225`). Ele "nunca muda" (`mutateTransaction.ts:99-100`).
  - Permite confirmar o conteúdo original da criação depois de uma correção, a ~2×10⁵ hipóteses por segundo (`sonda-requesthash-preexistente`).
  - É o canal mais forte para a versão de criação; a R3 não o cria. Recomendação: registrar no plano (§6) como item da P8 (D-07, PR-CR-05). Sugestão: HMAC com segredo do backend, já que o cliente nunca recalcula esse hash, ou tirá-lo do documento legível pelo cliente.
  - Risco residual até lá: igual ao de hoje.
- **INFO-02 — Mapa em memória não limpo no logout.**
  - `reportFetchStarts` (`queryKeys.ts:93-104`, novo na R3 por causa do RR-R2A-04) guarda hashes de chave com uid, workspace e papel (`queryKeys.ts:12-18`).
  - `clearSessionState` (`AuthContext.tsx:74-77`) não o limpa.
  - Só memória do módulo, sem conteúdo financeiro, perdido ao recarregar; é bem menor que o cache em memória do SDK, já aceito com decisão para a P6/P8 (`docs/production/evidence/p5f/cache-sdk.md`).
  - Recomendação: limpar junto com o `queryClient.clear()`, ou apagar a entrada quando a leitura termina, e incluir na mesma decisão da P6/P8.
- **INFO-03 — Seção do plano ausente.**
  - `DESENHO-MARCAS-B03.md:110` cita "plano mestre (§20.18)", que não existe (busca: zero; o plano não mudou na R3).
  - As condições de implantação e de restauração estão em `BACKUP_RESTORE_DR.md:52,117`.
  - Recomendação: criar a seção da R3 com as decisões de M-PRI-01.
- **INFO-04 — Marca para todo lançamento, não só para receitas.**
  - A necessidade se sustenta:
    - `updateCashTransaction` pode mudar o `type` (`mutateTransaction.ts:648`);
    - qualquer receita da janela pode ser desconsiderada depois;
    - o pedido (§3) define a marca por lançamento.
  - Sem ação.

---

## Fora do escopo desta avaliação

Itens de milestones posteriores que o diff não muda (o impacto da R3 neles fica registrado em M-PRI-01):

- **PR-AUTH-01 (P8):** exportação e exclusão de conta e de workspace, inclusive a coleção nova.
- **PR-PRIV-01 (P8):** canal do titular, controlador e encarregado, publicação dos subprocessadores.
- **PR-CR-05 (P8):** anonimização de dados de terceiros em texto livre e nos derivados.
- **D-07 (P8):** anonimização do ator e de terceiros em workspace compartilhado.
- **D-18 (P5/P8, parte financeira pendente):** prazos por categoria.
- **E-09 (P8):** validação jurídica dos itens da §15 do `PRIVACY_LGPD.md`.
- **PR-AUTH-02 (P9):** termos, política e aceite versionado.
- **D-26 (P8/P9):** cookies e armazenamento local.
- **PR-AI-01 e D-11 (P8):** IA, não afetada (a guarda confirma que nada da estimativa vai à IA).
- **PR-OBS-02 (P7):** incidentes com dados pessoais.
- **PR-BKP-01, E-07 e D-27 (P7):** backup, PITR e prazo em backup.
- **E-08 (P7):** retenção de logs.
- **PR-RULES-02 (P6):** catch-all que entrega `activity_logs` (descrição e ator) a todo membro.
- **PR-PLAT-03 (P6):** terceiros no navegador.
- **Cache em memória do SDK na troca de conta:** decisão P6/P8, complemento do AUTH-11.

---

## Verificação

**Executado nesta revisão** (logs em `$S/p5f1r3/revisoes/privacidade/`):

1. Delta com `final-tree.sh` (índice temporário): `git diff --stat f8267922 905ed3d6`, 54 arquivos. Recalculado depois: `90c06358`, `e52fd1e2`, `beb0d0f1`, `af3c872f` e `e37898e9`, com a conferência das diferenças nos caminhos de produção e de privacidade.
2. `cd WT/functions && npx tsc -p tsconfig.json --outDir $S/p5f1r3/revisoes/privacidade/build-functions` (compila fora do worktree): saída 0. `projectionMarks.js`, `periods.js`, `rebuild.js` e `triggers/transactions.js` gerados são **idênticos** aos de `WT/functions/lib`. O diretório do build (9,4 MB) foi apagado depois das sondas, para não inchar o pacote; para reproduzir, recrie-o com o mesmo comando.
3. `cd WT/functions && node --test lib/cash/__tests__/projectionMarks.test.js lib/cash/__tests__/dayProjection.test.js`: **29/29**, repetido na árvore estável. No build próprio, 28/29: a falha única é o caminho relativo da fixture compartilhada, que não existe fora do worktree; não é defeito do produto.
4. `npx tsc --noEmit` na raiz e em `functions`: saída 0 nas duas, repetido no estado final.
5. Testes unitários do cliente (`node --experimental-strip-types --test`): `tests/unit/work-time-guard.test.ts`, `work-time-projection-proof.test.ts`, `work-time-consistency.test.ts`, `work-time-income-estimate.test.ts`, `session-cleanup.test.ts` e `report-live-refresh-freshness.test.ts`.
   - 120/120 em `905ed3d6`/`90c06358`;
   - **122/122** no estado final;
   - inclui a guarda "leitura das marcas de aplicação (P5-F.1-R3)" e "nada derivado é gravado".
6. Sondas próprias em Node puro, com as funções reais. Em `$S/p5f1r3/revisoes/privacidade/sondas/`, cada uma com o seu `.log`; uso: `NODE_PATH=WT/functions/node_modules node <sonda> <build-functions>`.
   - `sonda-versao-atual.mjs`: impressão do Admin SDK igual à do SDK web; mais 1 µs muda a impressão.
   - `sonda-residuo-marca.cjs`: 3 cópias de fp(V1) depois da correção; continuam depois da exclusão e de R2.
   - `sonda-confirmacao.cjs`: vazão de 203.011 impressões/s; caso A confirmado em 277 ms; caso B em 2,5 s; extrapolações.
   - `sonda-requesthash-preexistente.cjs`: confirmado em 2,0 s.
7. Buscas:
   - blocos de Rules;
   - ausência de exclusão de `transactions` em `functions/src`;
   - ausência de API de armazenamento local no diff;
   - só e-mails sintéticos (`example.test`, `minhas-financas.local`), nenhum CPF ou CNPJ e nenhum padrão de segredo no diff;
   - `PRIVACY_LGPD.md`, `SUBPROCESSORS.md` e o plano sem alteração da R3;
   - plano sem §20.18.

**Herdado, não reproduzido:**
- Suíte de Rules das marcas, 6/6: `$S/p5f1r3/logs/rules-marcas-oficial-2.log`.
- Integração das marcas, 14/14 (`int-copia-marcas-fix-3.log`), e do caixa, 108/108 (`int-copia-cash-fix-1.log`), executadas pelo implementador numa cópia.
- E2E B03 15/15, declarado em `evidence/p5f1-r3/testes-e-resultados.md`.
- Suíte de ataques `tests/firestore/cash-projection-marks-p5f1r3-ataques.rules.integration.test.mjs`, incorporada depois.

**Não executado:** Emulator, E2E e `verify:all`, vedados a este revisor.
