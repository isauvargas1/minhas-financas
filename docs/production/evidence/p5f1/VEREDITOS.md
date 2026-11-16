# P5-F.1 — vereditos das skills e auditoria independente

**Escopo das revisões.** Diff da P5-F.1 sobre a árvore da P5-F (`455086e0`), avaliado na árvore `355b4d07`, a do `verify:all` final (saída 0; 3.073 testes, 0 falha, 0 skip, 0 retry); depois dele só a documentação mudou ([`execucoes.md`](execucoes.md)).

**Evidências usadas:**
- [`inventario.md`](inventario.md), [`contrato-v2.md`](contrato-v2.md), [`calendario-feriados.md`](calendario-feriados.md), [`elegibilidade-receitas.md`](elegibilidade-receitas.md), [`matriz-calculos.md`](matriz-calculos.md) e [`autorizacao-isolamento.md`](autorizacao-isolamento.md);
- [`mutantes.md`](mutantes.md): 184/184 de unidade e guarda (0 não compilam), 11/11 das Rules, 52/52 da P5-F e 8/8 do E2E;
- [`visual/LEIAME.md`](visual/LEIAME.md): 78 capturas, axe, teclado e antes × depois;
- [`execucoes.md`](execucoes.md): comandos e resultados;
- [`revisoes/`](revisoes/): os pareceres independentes e as respostas a cada um.

Cada skill foi aplicada no escopo da própria política: as seções do checklist exercitadas pelo diff, as invariantes que ele poderia violar e os itens que o plano atribui à P5 ou a milestones anteriores. Itens de milestones posteriores não afetados aparecem como fora do escopo, com o ID do plano.

## PASS — Financial domain integrity

**Escopo.** Estimativa de exibição sobre dados financeiros oficiais: renda de `getFinancialReport` (série `receiptsCents`), horas do motor de calendário, exclusões do usuário só na estimativa, conversão pela camada da P5-F. Substituição do contrato v1 da preferência pelo v2. Nenhuma operação, callable, gatilho, projeção ou relatório autoritativo mudou: em `functions/` o único arquivo novo é um teste (`incomeClassificationFixture.test.ts`).

**Mapa de autoridade.**

| Número | Fonte oficial | Quem grava | Efeito da P5-F.1 |
| --- | --- | --- | --- |
| Receita do mês (`receiptsCents` = `incomeCents` da projeção) | `cash_report_periods`, gravado pelo gatilho de caixa (`cashPeriodDeltaFor`) e lido por `getFinancialReport` | Backend (inalterado) | Só lida. O cliente espelha a classificação para listar e aplicar exclusões; a paridade é provada pela fixture rodada no backend e no cliente |
| Lançamentos (`transactions`) | Backend (inalterado) | Backend | Lidos por consultas indexadas e por id, só por membros (Rules `firestore.rules:614-617`); nunca gravados |
| Preferência (rotinas, feriados, exceções, fonte, exclusões, modos) | Documento privado do titular | Só o titular, pelo cliente, com contrato estrito nas Rules (`firestore.rules:1157-1280`, `1316-1323`) | Não é número financeiro: nenhuma Function, projeção ou relatório lê |
| Renda da janela, minutos previstos, valor da hora, minutos convertidos | Nenhuma | Ninguém (calculados em memória) | Proibido gravar: guarda, Rules (campos derivados negados) e varredura do Firestore no E2E |

**Semântica dos movimentos.** Nenhum movimento novo ou reclassificado. A renda considerada é a receita de caixa realizada oficial: aporte, resgate e rendimento de investimento, principal de empréstimo, pagamento de fatura, divisão e reembolso, transferência, receita prevista e anulada ficam fora (`incomeBasis.ts:66`, espelho de `functions/src/cash/periods.ts`); o estorno de recebimento, que o backend grava na data do próprio recebimento, anula o recebimento no mês dele (D-P5F1-04, revisão 4). PF e PJ: uma fonte por vez; PJ só com confirmação e identificado; nunca somados.

**Matriz de evidência.**

| Seção do checklist | Resultado | Evidência |
| --- | --- | --- |
| Representação e tempo | PASS | Renda em centavos inteiros, horas em minutos inteiros, BigInt nos produtos (`calculation.ts:89-128`), soma por soma dos mesmos meses (`estimate.ts:132`). Datas civis `YYYY-MM-DD` sem conversão de instante (`dates.ts`); "hoje" é o `referenceDate` do servidor, em São Paulo, como o contrato de `date` dos lançamentos |
| Semântica financeira | PASS | Classificação por marcas do backend, tipo, valor e liquidação, nunca por descrição ou categoria (teste com descrições enganosas); fixture de 15 documentos com o mesmo `incomeCents` no backend e no cliente; transferências não vivem em `transactions` |
| Autoridade e atomicidade | PASS | Nenhuma escrita financeira nova. A única escrita é a preferência, um documento, `setDoc`/`updateDoc`/`deleteDoc` atômicos (`api.ts:55-66`), com Rules estritas |
| Operações críticas e eventos | N/A | Provado: nenhuma operação, evento, idempotência ou auditoria financeira mudou (o diff em `functions/` é só o teste novo) |
| Histórico e auditabilidade | PASS | Desconsiderar uma receita não altera o lançamento (E2E confere `valueCents`, `type`, `isPaid` e ausência de `voidedAt`); excluir a preferência é eliminação de dado pessoal, não de histórico financeiro |
| Fontes, totais, projeções e relatórios | PASS | Total de cada mês = oficial; exclusões descontadas no próprio mês, nunca deixando o mês negativo (mês sinalizado); painel confere Σ itens = total oficial mês a mês; DTO do relatório sem campo novo (guarda) |
| Substituição de domínio e legado | PASS | v1 substituído sem migração nem leitura dupla: Rules negam o v1 e os campos `monthlyIncomeCents`/`monthlyWorkMinutes` (teste "documento v1"); cliente trata v1 como fora do contrato (`contract.ts:131-150`); `form.ts` removido; busca: `monthlyIncomeCents` só aparece em testes negativos e na guarda. Documentação atualizada |
| Migração com dados reais | N/A | Não há dados reais (política de legado); nenhuma migração ou backfill |
| Testes obrigatórios | PASS | Criação, edição, desativação e exclusão da preferência (E2E 1, 3, 6; Rules); retry (gravação do documento inteiro, idempotente); concorrência (duas abas, E2E 3; troca de conta com respostas atrasadas, E2E 2); autoridade (Rules no Emulator); limites, zero, negativo, máximo, arredondamento determinístico, virada de mês, bissexto e PF/PJ (unitários e E2E 5) |

**Reconciliação.** Estimativa = Σ meses (`receiptsCents` oficial − contribuição dos excluídos no mês) ÷ Σ minutos previstos dos mesmos meses. Reconstruível pela memória de cálculo (meses, totais oficiais, desconsideradas, elegíveis, horas) e conferida item a item no painel. Sem dupla contagem: uma fonte, cada lançamento no mês da sua data (projeção do backend), espelhos de domínio fora, estorno pareado no painel (fica na data do recebimento e o anula no mesmo mês), sem exclusão de recebimento estornado, e desconsiderada que deixa de somar renda (anulada em outra sessão) não é descontada (E2E 8).

**Retry e concorrência.** Salvar regrava o documento inteiro; excluir é idempotente; a última gravação vence entre abas e todas recebem o estado final; a gravação pendente desta aba não é tratada como mudança de outra aba (E2E 6). As bases da estimativa são relidas quando a receita das projeções mensais confirmadas pelo servidor diverge da que elas leram (no máximo 2 releituras por estado, zeradas na convergência; nada comparado enquanto uma base carrega), coalescidas por chave, com teto depois de falha que uma projeção nova, a virada do mês, o "Tentar de novo" ou uma leitura com dados reabrem. A sincronização é liberada na convergência com a projeção, quando todas as bases chegam sem mais tentativas para o mesmo estado ou, sem bloco exato, quando todas chegam; só então as exclusões por id e a janela do painel são relidas, e a estimativa segura a última versão consistente até elas chegarem, com marcos sem relógio e presos ao uid e ao workspace (o `dataUpdatedAt` das bases e, da leitura por id, o objeto do resultado, um novo a cada leitura concluída, mesmo no mesmo milissegundo). A leitura por id só segue a sincronização (sem prazo de validade nem releitura na montagem ou na volta da rede), e as bases em uso só o agendador. Uma base nova que a estimativa não pediu (a releitura da mutação, o pedido de outra estimativa, a virada do mês, o "Tentar de novo") e que começou depois do último retorno do servidor não pede outra releitura; a que começou antes dele compara e pode pedir, como a carga. Com outra receita em qualquer mês que a base traz, é segurada já na renderização em que chega e libera quando nenhuma base da estimativa está em leitura, com as leituras de receitas relidas depois dela. Com mais de uma base (a janela de 12 meses), a estimativa também segura, com ou sem receita desconsiderada e em todas as estimativas da sessão (a que tem uma versão anterior das mesmas entradas), enquanto alguma base está em leitura (inclusive a busca pausada sem rede) ou mostra uma leitura que começou depois de um pedido que outra ainda não leu e que ainda vai relê-la (a da mutação adiada pelo orçamento ou, a partir do efeito que a agenda, a nova tentativa depois de uma falha: sem receita desconsiderada, a renderização da falha mostra uma base nova com a antiga da outra, e esse estado fica durante a nova tentativa, risco registrado; o "Tentar de novo", que relê as duas, solta a espera; as bases lidas antes do mesmo pedido pendente estão em passo e são mostradas na hora); a base que sai de uso com releitura pendente fica desatualizada e marcada, e é relida na volta, também quando a leitura em curso na saída chega antes dela, mas não quando a volta vem antes dessa leitura (risco registrado); a base parada no teto não é relida pela mutação e não segura a outra, e a estimativa avisa a falha. O estado mostrado durante a retenção nunca é guardado como a última estimativa. Uma leitura que chega com dados zera as falhas da base, e a falha de uma releitura que não a deixou desatualizada não conta. Uma mutação nesta aba relê as bases carregadas do workspace sem zerar o teto, por um agendador com orçamento próprio, nunca a leitura por id (`invalidateTransactionReads`); a escuta encerrada por erro aparece como atualização que falhou, deixa de valer para comparação e é reaberta pelo "Tentar de novo" de qualquer estimativa da mesma conta e do mesmo workspace, ou por cada retorno do servidor à escuta de outra. Provas: testes de gancho (duas estimativas; janela de 12 meses nas duas ordens de chegada; troca de workspace, inclusive com o pedido em curso; relógio para trás; tentativas esgotadas com pedido em curso; escuta encerrada por erro, com pedido em curso, e reaberta pela escuta e pelo "Tentar de novo" de outra estimativa; a mutação relendo só a base, com orçamento próprio; base nova sem pedido antes da escuta, com a escuta viva e encerrada, e duas seguidas antes das exclusões; mês fora da janela mudado e a janela que passa a incluí-lo; as duas bases da janela de 12 meses relidas sem pedido; a leitura pedida ou da mutação que cruzou um retorno do servidor com um estado intermediário; na janela de 12 meses, a releitura da mutação de uma base adiada pelo orçamento, com a escuta viva e encerrada, e o "Tentar de novo" que libera sem esperar a reposição; a nova tentativa agendada do mês avulso e a série parada no teto, que sai dele relida com sucesso; uma base só, que libera na chegada; só a série relida, sem pedido pelo mês avulso; as falhas da releitura da mutação, que não param a base), a estimativa inteira com a API em memória (mutação nesta aba, com a base nova antes da escuta, viva e encerrada; leitura por id envelhecida e prévia montada depois da mutação e durante a sincronização; reconstrução marcada; escuta do provedor reaberta pela prévia; exclusão de um mês fora da janela anulada e a janela maior salva depois; na janela de 12 meses, o mês avulso que chega depois da série e o que falha; regra de retenção pura), E2E 8 e 13 com observador e mutantes do E2E sem a retenção e com a mutação relendo tudo. Uma releitura que falha deixa a última leitura valendo, com aviso e "Tentar de novo" (E2E 12).

**Legado removido.** Contrato v1, formulário de renda e carga digitadas (`form.ts`), Rules do v1 e testes do v1 substituídos por equivalentes do v2 (mutantes K4, K6 e K8 da P5-F com equivalentes U29, U34 e U30, mortos).

**Verificação.** `test:unit:work-time` (100, com `work-time-income-estimate` e `transactions-paging`), `test:unit:reports` (100, com `report-basis-refresh` e os 50 testes de gancho de `report-basis-sync`), Rules no Emulator (13), E2E da P5-F.1 (15), fixture do backend (2), mutantes 184/184 (0 não compilam), 11/11, 52/52 da P5-F e 8/8 do E2E, `verify:all` com saída 0 (3.073 testes).

## PASS — Firestore scale/cost review

**Escopo.** Leituras novas: (1) a base do relatório (`getFinancialReport`, 1 chamada `12m` + 1 de mês para 12 meses), (2) a escuta das projeções mensais da janela no workspace-fonte, (3) os excluídos por id, (4) a janela de receitas do painel, (5) a escolha da fonte padrão. Índices novos de `transactions`.

| Item | Resultado | Evidência |
| --- | --- | --- |
| Isolamento e limites | PASS | Todas as leituras sob `workspaces/{incomeWorkspaceId}/…`, com membership nas Rules (`isMember`); o Emulator nega outro workspace, membro removido, conta suspensa e anônimo nas quatro formas novas de consulta (janela, estornos, leitura por id e a escuta das projeções, também negada sem limite) |
| Paginação | PASS | Janela de receitas: `orderBy(date desc, __name__ desc)`, páginas de 500 lidas com `limit(501)` (um a mais para saber se há mais), cursor `startAfter` no último da página, até 4 páginas (2.000) + 1 de estornos, com aviso de truncamento só quando há mais (guarda); Emulator com 507 receitas em 3 datas: 501 e depois 7, sem repetir nem pular; página exatamente cheia: 500 sem "há mais"; depois do último e mês sem receitas: vazia |
| Índices | PASS | `firestore.indexes.json`: (`type` ASC, `date` DESC, `__name__` DESC) e (`receivableEntry.reversal` ASC, `date` DESC, `__name__` DESC). A consulta por id e a escuta por id de documento (`documentId()` em intervalo) não precisam de composto |
| Listeners | PASS | Um só novo, limitado: `cash_report_periods` do workspace-fonte, `documentId()` entre o primeiro e o último mês da janela, `limit(13)` (dentro do teto de 600 das Rules; forma exata no Emulator), com os metadados de cache: o retorno só do cache não conta. Compara só a receita de cada mês com a das bases (despesas não relêem), e nada enquanto uma base carrega; com a base sem bloco exato, relê no primeiro retorno e a cada mudança dos documentos, sem laço. Na divergência, relê só as bases da própria estimativa e, na liberação, as leituras de receitas em uso (`basisSync.ts`, 50 testes de gancho com `QueryClient` real). A escuta encerrada por erro é avisada, deixa de valer para comparação e é reaberta pelo "Tentar de novo" de qualquer estimativa da mesma conta e do mesmo workspace, ou por cada retorno do servidor à escuta de outra (só as encerradas; uma escuta saudável não é reaberta, e uma encerrada que volta a falhar é reaberta de novo a cada retorno de outra). Nenhum listener por lançamento; nenhum polling (guarda) |
| N+1 e releituras | PASS | Excluídos em consultas `in` de até 30 (≤ 2); fonte padrão: até 5 consultas de membership, só na primeira ativação; releitura da base só por divergência de receita (no máximo 2 por estado, zeradas na convergência), coalescida por chave (um agendador para todos os observadores), com orçamento de 35 por hora por base e parada depois de 2 falhas seguidas, reaberta pelo agendador só por uma projeção nova da estimativa ou pela virada do mês (a invalidação dos relatórios das telas não toca as bases; a mutação nesta aba relê as bases carregadas do workspace sem zerar o teto, por um agendador com orçamento próprio; base que nunca carregou fica fora do agendador); uma base nova que a estimativa não pediu não pede outra releitura, salvo se começou antes do último retorno do servidor; nem a montagem de outro observador nem a volta da rede relêem bases ou a leitura por id; duas estimativas relendo as mesmas exclusões fazem uma leitura só (sem cancelar a que está em curso); mutações nesta aba não relêem as leituras de receitas |
| Escritas | PASS | Uma escrita por salvar, trocar o modo ou excluir; documento limitado por contrato (≤ 15 campos, textos ≤ 6.449 caracteres) |
| Legado | PASS | Nenhum índice ou consulta do v1 existia; nada a remover além do contrato |

**Modelo de custo** (estimativa; N = receitas da janela):
- abrir a sessão com a função ligada: 1 leitura da preferência, 1 chamada do relatório por base (1 e, na janela de 12 meses, 2), até 13 leituras da escuta e até 2 consultas de excluídos; a escuta adiantada não relê nada enquanto uma base carrega;
- cada mudança de documento mensal da janela na fonte: 1 leitura da escuta; só a mudança de receita relê as bases (1 releitura de cada base, coalescida em 5 s: 2 chamadas na janela de 12 meses, mesmo que só uma tenha mudado) e, depois que todas chegam, uma das leituras de receitas em uso (exclusões por id; a janela do painel, se aberto), dentro do mesmo orçamento; com a base sem bloco exato, a carga e cada mudança de documento relêem as bases;
- mutação nesta aba: uma releitura de cada base carregada do workspace por rajada (30 s depois da última mutação), num orçamento próprio de 2 seguidas e mais 1 a cada 10 min por base (até 8 por hora), que não atrasa a escuta (depois de 2 em 10 min, a seguinte espera a reposição, até 10 min); com outra receita em qualquer mês da base, mais uma leitura das exclusões depois dela e, com o painel aberto, a janela dele (na janela de 12 meses, uma depois de cada base relida; quando as duas são relidas juntas, uma só, depois delas; a espera das bases fora de passo não acrescenta leitura, e as bases em passo, com a releitura pendente, são mostradas sem esperar por ela); mudança do mês corrente no listener do App: nada nas bases;
- limite de frequência da callable (300 por hora, por workspace e usuário): no pior caso, o Dashboard (até 200) e duas bases (35 + 8 cada) somam 286;
- escuta encerrada: nenhuma releitura contra a projeção recebida; a reabertura (pelo "Tentar de novo" ou pelo retorno do servidor à escuta de outra estimativa) custa uma escuta nova, até 12 documentos;
- com o painel "Receitas consideradas" aberto, cada liberação (a da sincronização e a de uma base nova sem pedido) relê a janela dele inteira (até 2.505 documentos), dentro dos orçamentos das bases (até cerca de 43 por hora por base);
- reconexão da escuta: o SDK retoma o alvo e recebe só o que mudou; se ficar fora por muito tempo, relê os até 12 documentos da janela (a comparação por valor não relê o relatório se a receita não mudou);
- abrir "Receitas consideradas": até ⌈N/500⌉ (≤ 4) páginas de até 501 documentos + 1 de estornos, cacheadas por 5 min;
- com 1.000 receitas por trimestre, o painel lê 1.000 documentos uma vez; a estimativa não lê lançamentos;
- a leitura por id sem compartilhamento de estrutura não lê nada a mais: cada releitura dela traz um objeto novo, e a estimativa é recalculada no aparelho uma vez por releitura, mesmo com os mesmos dados.
- a base que sai de uso com releitura pendente e volta: uma leitura, na hora (a chave trocada lê a desatualizada) ou, quando a leitura em curso na saída chegou antes da volta, pelo agendador da escuta, dentro do orçamento dele; ela substitui a releitura pendente cancelada na saída. Com a volta antes dessa leitura, nenhuma: a volta se junta a ela (risco registrado). A ordem guardada no registro por base é uma lista curta de números, que cada leitura com dados limpa.

## PASS — Multi-tenant security review

| Item | Resultado | Evidência |
| --- | --- | --- |
| Identidade, tenant e membership | PASS | Documento privado só do titular com conta ativa (Rules); a fonte de renda é lida pela callable `getFinancialReport`, que confere membership e papel no servidor; `incomeWorkspaceId` de workspace alheio só produz "indisponível"; consultas de `transactions` exigem membership ativo |
| RBAC | PASS | Owner, admin, member e viewer não leem nem gravam a preferência de outra pessoa (Emulator); viewer lê `transactions` do próprio workspace (somente leitura), como na base |
| Integridade de dados | PASS | `hasOnly` + `hasAll` dos 15 campos, tipos, tamanhos, quantidades, gramáticas fechadas e `updatedAt == request.time`; mapas, listas, v1 e derivados negados; corpus de 121 casos |
| Camadas independentes | PASS | Rules avaliadas sem o cliente (Emulator); o cliente valida também a semântica; o backend não muda |
| Auditoria, segredos, Storage | N/A | Provado: nenhuma ação privilegiada, segredo ou Storage novo |
| Emulator com dois tenants | PASS | 13 cenários com dois workspaces, quatro papéis, anônimo, suspenso, membro removido, troca de usuário, listagem, collection group, consulta por id do titular, campos extras e as consultas novas da renda, inclusive a escuta das projeções; mutantes das Rules 11/11 |
| Sessão no navegador | PASS | Estado marcado com o uid; listener cancelado na troca; bases com o uid na chave; marcos da sincronização presos ao uid e ao workspace (teste de gancho: nenhuma retenção passa de um workspace para outro); `queryClient.clear()` no logout; E2E 2 com outra conta no mesmo navegador e os relatórios de A retidos até a troca (o observador acusaria hora, renda ou conversão de A) |

**Ataques tentados:** IDOR de preferência (outro uid, outro id, listagem, collection group, consulta por `documentId`), workspace alheio como fonte, leitura de lançamentos de outro workspace pelas formas novas, campos derivados e v1, conta suspensa e membro removido, troca de conta com respostas atrasadas. Todos negados ou sem efeito.

## PASS — Privacy/LGPD data lifecycle (escopo P5-F.1)

**Inventário** (`PRIVACY_LGPD.md` item 25): rotina, UF e município opcionais, feriados locais, exceções só com tipo e datas (sem motivo nem dado de saúde), fonte da renda, confirmação PJ, ids desconsiderados, modos. Titular: o usuário. Finalidade: comparação informativa escolhida por ele. Base legal: E-09 (validação jurídica pendente, item de P8). Retenção: até o titular excluir (imediato); exportação e eliminação no job de conta (P8).

| Seção | Resultado | Evidência |
| --- | --- | --- |
| Inventário e minimização | PASS | Nada derivado gravado; exceções sem motivo; município opcional e normalizado; nenhuma renda digitada |
| Compartilhamento | PASS | Nenhum membro, Function, IA, notificação, relatório, log ou armazenamento local recebe a configuração (guarda; E2E 4 com o payload da IA e a varredura; E2E 2 com outra conta) |
| Eliminação | PASS | "Excluir meus dados" apaga o único documento (Rules e E2E 3 conferem que nada sobra) |
| Armazenamento local | PASS | Nenhuma chave da função no `localStorage` (E2E 4) |
| Transparência | PASS | Etapa A com o texto pedido (nada compartilhado, pode ser desligado), memória de cálculo com o aviso exato |

**Fora do escopo desta avaliação:** exportação e eliminação pelo job de conta (PR-AUTH-01, P8), validação jurídica da base legal (E-09), conta suspensa apagando a própria preferência (P8).

## PASS — revisão de UI de produto em PT-BR

| Critério | Resultado | Evidência |
| --- | --- | --- |
| Escopo de UI | PASS | Mudanças requeridas pelo pedido: a seção de Configurações (assistente, edição, memória de cálculo, painel de receitas) e o aviso do Header no modo tempo. Antes × depois: 23 de 24 capturas idênticas pixel a pixel no Dashboard e nos Relatórios, axe igual nas 24. Na rodada da revisão 4, só os textos do estorno mudaram (memória de cálculo e painel), por correção de premissa (R4-04); contra a rodada anterior, 71 de 78 capturas idênticas |
| pt-BR | PASS | Textos revisados (títulos de mês só com a primeira maiúscula, plural correto, sem "(s)"); textos exigidos literalmente conferidos no E2E (apresentação e aviso da memória) |
| Erros sem detalhe interno | PASS | Falha do relatório mostra a mensagem pt-BR do relatório, nunca o texto do SDK (E2E 6); falha da leitura dos desconsiderados mostra a mensagem fixa, sem texto do SDK (E2E 11, com a conta suspensa); releitura que falha mostra o aviso sem detalhe interno (E2E 12); falha da leitura da preferência com a escuta aberta mostra o aviso fixo, volta a reais e loga só o código (E2E 14) |
| Estados | PASS | Carregando, indisponível com motivo (com "Tentar de novo" quando o relatório está indisponível), provisória, mês incompleto, erro com "Tentar de novo", leitura antiga depois de uma releitura que falha (aviso, "Tentar de novo" e ressalva no topo, E2E 12), contagem parcial, sem fonte (E2E 9); falha ao salvar preserva a anterior sem aviso falso de conflito; troca do modo pelo Header durante a edição adotada no rascunho e mantida ao salvar (E2E 10); itens do painel depois do período dizem que ainda não entram, e recebimento estornado não tem caixa nem data de estorno inventada (o estorno fica na data do recebimento; unitário dos casos dentro e depois do período, considerado e desconsiderado) |
| Acessibilidade | PASS | 0 violação de axe nas superfícies novas (60 capturas e E2E); diálogos com foco no título, Tab preso, Escape e retorno; foco no título a cada etapa; calendário com setas e tabindex móvel (E2E só pelo teclado); grupos nomeados por dia da semana; erros associados aos campos |
| Responsividade | PASS | 0 transbordamento a 1440, 390 e 360 px, claro e escuro |

## PASS — regression release gate

**Escopo Git:**
- base pedida pelo usuário: `1730a1df` com o patch da P5-F (SHA-256 `6b98969d…`, conferido), que dá a árvore `455086e0`, conferida por inteiro antes de qualquer alteração; `HEAD` e merge-base continuam `1730a1df` (nenhum commit), na branch local `feat/p5-f1-smart-worktime-2026-11-04`, sem upstream e com o índice vazio;
- árvore do `verify:all` final: `355b4d07`; depois dele, só documentos mudaram (prova no pacote, `patches/mudancas-depois-do-verify-all.txt`, conferida pelo roteiro de empacotamento, que recusa qualquer arquivo fora de `docs/`);
- diferença da P5-F para a árvore final: 251 arquivos (220 novos, 30 alterados e 1 removido); fora de `docs/`, 55 (32 novos, 22 alterados e `form.ts` removido).

**Superfícies:**
- frontend: a seção de Configurações (assistente, edição, memória de cálculo, "Receitas consideradas") e o aviso do Header no modo tempo; os módulos de tempo de trabalho, relatórios e lançamentos (leituras novas e invalidação); no agendador de releitura da P5-C1 (`liveRefresh.ts`), só a consulta da releitura pendente (`scheduled`), sem mudar o comportamento dele;
- Rules: só o bloco da preferência privada (contrato v2); as Rules das coleções lidas pelas consultas novas não mudaram e são exercitadas na suíte;
- índices: 2 compostos de `transactions`;
- Functions: só um teste unitário novo (a fixture de classificação contra `cashPeriodDeltaFor`), sem mudança de código, exportação ou runtime;
- testes, `package.json` (dois scripts) e documentação.

Sem diff em `firebase.json`, `.firebaserc`, lockfiles, workflows, `playwright.config.ts`, `vite.config.ts` e `.claude/`.

**Proibições:**
- nenhum teste removido, pulado, `only`, `fixme`, timeout ou retry novo; os testes da P5-F que mudaram foram adaptados ao contrato v2 e à invalidação nova com asserções iguais ou mais estritas, e os 52 mutantes da P5-F que ainda se aplicam morrem nas suítes da P5-F.1;
- nenhuma asserção afrouxada: as asserções que mudaram foram trocadas por equivalentes do código novo ou mais fortes, como as revisões independentes conferiram. A latência do dublê da leitura por id (2 → 20 ms, R6-04) só torna o teste determinístico; a asserção e o prazo são os mesmos. Os dublês novos (`readAtStart`, a callable que lê no começo e responde depois; `excludedDate`; `mountWindow`, a janela trocada; `excludedLanded` e `byIdsLanded`, que param o relógio quando uma leitura por id chega) só expõem cenários reais, e os testes deles reprovam contra o código anterior. A sonda dos testes de sincronização passou a usar a leitura por id da estimativa (`useTransactionsByIdsWith`) e o objeto do resultado, como a estimativa; o teste de R6-02 que reprovou uma vez nas repetições continua com as mesmas asserções, e o caso que o derrubava (duas leituras no mesmo milissegundo) virou um teste próprio, determinístico;
- nenhum tipo, Rule ou validação relaxada: o contrato v2 é estrito (15 campos, gramáticas fechadas nas Rules e no cliente), e as Rules existentes não mudaram;
- legado substituído e removido: contrato v1, `form.ts`, Rules e testes do v1, sem leitura dupla nem migração;
- nenhum comando aponta para produção: Emulator `minhas-financas-local` e os roteiros `run-*.sh`;
- plano atualizado (§20.15, §15 e changelog).

**Evidências:**

| Etapa | Comando | Resultado |
| --- | --- | --- |
| Typecheck | `npm run typecheck` (no `verify:all`) | Saída 0 (raiz, com `e2e/`, e Functions) |
| Lint das Functions | `npm run functions:lint` | 0 erros e 201 avisos, iguais à base |
| Build do frontend e das Functions | `npm run build`, `npm run functions:build` | OK: build de produção, build E2E e Functions |
| Unitários | `verify:fast` | 1.612 testes (Functions 663, frontend 949), 0 falha |
| Integração e Emulator | `test:integration:emulator` | 1.255 testes (integração das Functions 969; ferramentas e Rules 286), 0 falha |
| Rules no Emulator | `test:rules:*` (com `test:rules:work-time`, 13) | Todas as suítes de `tests/firestore/`, dentro da integração, 0 falha |
| E2E completo | `test:e2e` | 206/206 (18,1 min), 0 retry, 0 `flaky`, 0 skip |
| Smoke adjacente | o E2E completo (caixa, contas, cartões, recorrências, divisão, clientes e recebíveis, empréstimos, metas, investimentos, relatórios, notificações, workspaces e navegação), além dos 15 da P5-F.1 | Dentro dos 206 do E2E completo, 0 falha |
| Mutantes | `mutantes.py` e `e2e-mutante.py` | 184/184 de unidade e guarda (0 não compilam), 11/11 das Rules, 52/52 da P5-F e 8/8 do E2E |

**Skips e cobertura:**
- 0 skip, 0 todo, 0 cancelado e 0 retry no `verify:all` final;
- o repositório não tem ferramenta nem limiar de cobertura versionado: a comparação é por contagem, 2.937 → 3.073 (+136, todas das suítes da P5-F.1), e pelos mutantes.

**Mudanças de superfície:**
- **UI:** a seção nova de Configurações e o aviso do Header no modo tempo, pedidos pela P5-F.1. Antes × depois no Dashboard e nos Relatórios: 23 de 24 capturas idênticas pixel a pixel (a outra, 14 px de foco num componente sem diff) e axe igual nas 24 ([`visual/LEIAME.md`](visual/LEIAME.md)). As correções das revisões 5 a 10 e a da reprovação nas repetições não mudaram nada visível.
- **Textos:** novos, em pt-BR (assistente, Configurações, memória de cálculo, painel, aviso e mensagens).
- **Rotas:** nenhuma. A seção é um modo interno de Configurações.
- **Contratos:** o documento privado da preferência passa ao v2 (15 campos), com o v1 negado. Duas leituras novas de `transactions` (janela e estornos), a leitura por id e a escuta das projeções mensais, todas só leitura e sob as Rules existentes, com 2 índices. Nenhuma Function nova; `getFinancialReport` e os documentos financeiros não mudaram.

**Riscos residuais:** os da §20.15, sem bloqueador.

**Bloqueadores:** nenhum.

**Skills exigidas pela superfície** (todas `PASS`, acima):
- `financial-domain-integrity`;
- `firestore-scale-cost-review`;
- `multi-tenant-security-review`;
- `privacy-lgpd-data-lifecycle` (escopo P5-F.1);
- `ptbr-product-ui-review`.

`billing-entitlement-integrity`, `firebase-production-readiness`, `observability-incident-readiness` e `saas-commercial-readiness` não foram acionadas: o diff não toca billing, ambiente, `firebase.json`, exportações ou runtime das Functions, App Check, segredos, IAM, logs, métricas, alertas nem página pública. O único log do caminho novo é o da P5-F (só o código do erro da preferência).

## Auditoria independente

Revisor independente, somente leitura, sem acesso ao raciocínio do autor, em onze rodadas. Cada uma tem o parecer e a resposta item a item em [`revisoes/`](revisoes/). Nenhuma rodada encontrou achado HIGH; os MEDIUM das duas primeiras e todos os LOW e INFO foram tratados, com teste e mutante quando o achado era de comportamento (o R8-02, os casos restantes do R10-02, o R11-01 e o R11-02, todos INFO, ficaram nos riscos, com a análise na resposta).

| Rodada | Árvore revisada | Achados novos | Tratamento |
| --- | --- | --- | --- |
| 1 | `4ebd88e2` | 4 MEDIUM, 12 LOW, 6 INFO | todos tratados ([`respostas-revisao-1.md`](revisoes/respostas-revisao-1.md)) |
| 2 | `5d563341` | 2 MEDIUM, 7 LOW, 3 INFO, mais pendências da 1 | todos tratados; os dois MEDIUM nasceram das correções da 1 (estorno e exclusões depois de uma anulação em outra sessão) |
| 3 | `30d0cd8e` | 5 LOW, 1 INFO, mais 2 itens parciais da 2 | todos tratados: feriado classificado pelos minutos finais, retenção da estimativa consistente, ganchos testados com React Query real |
| 4 | `fb802e26` | 4 LOW, 2 INFO | todos tratados: a mutação nesta aba sem reler as exclusões antes da base, o mês avulso carregando, o teto de falhas, o estorno na data do recebimento, marcos sem relógio, mutantes que não compilam separados |
| 5 | `e2870ed6` | 2 LOW, 3 INFO | todos tratados: leitura por id só pela sincronização, a releitura da mutação, a escuta encerrada com aviso e reabertura, testes do escopo e das liberações |
| 6 | `80b73832` (e os comentários de `ff45884e`) | 4 LOW, 2 INFO | todos tratados: reabertura das escutas entre estimativas, retenção na renderização da base nova sem pedido, orçamento próprio da releitura da mutação, teste determinístico |
| 7 | `167c2893` | 2 LOW, 1 INFO | todos tratados: todos os meses da base e a espera das bases em leitura na liberação sem pedido; a leitura que cruzou um retorno do servidor volta a comparar e pedir |
| 8 | `16cda725` | 1 LOW, 3 INFO | R8-01, R8-03 e R8-04 tratados, R8-02 registrado nos riscos: na janela de 12 meses, a base nova sem pedido espera a releitura pendente da outra, pedida depois do começo da última leitura dela; a base relida com sucesso sai do teto; testes de comportamento da leitura em curso |
| 9 | `854463e8` | 2 LOW, 2 INFO | todos tratados: a espera da revisão 8 virou a retenção das bases fora de passo, à parte da leitura dependente (vale sem receita desconsiderada e para todas as estimativas da sessão); a base que sai de uso com releitura pendente é relida na volta; o estado mostrado durante a retenção não é mais guardado; a falha da releitura da mutação não conta para o teto. Depois, a reprovação de 1 das 60 repetições levou a marca da leitura dependente do `dataUpdatedAt` (em milissegundos) para o objeto do resultado |
| 10 | `46abcd23` | 1 LOW, 3 INFO | todos tratados: as bases fora de passo pela regra "à frente" (a ordem dos dados em uso), a busca pausada como leitura, a base que sai de uso no meio de uma leitura relida na volta (quando essa leitura chega antes dela); os casos restantes da estimativa sem versão anterior das entradas ficaram nos riscos |
| 11 | `355b4d07` | 3 INFO | nenhum pediu mudança de código: R11-01 (a base que volta antes de a leitura de antes da saída chegar não é relida) e R11-02 (sem receita desconsiderada, a renderização anterior ao efeito que agenda a releitura, anterior a esta rodada) ficaram nos riscos; R11-03 (contagens e frases) corrigido; o 14º `verify:all`, em paralelo, é o definitivo |

Os `verify:all` que rodaram em paralelo com uma revisão que trouxe mudança de código não contaram como gate: o 1º, o 4º, o 6º e o 9º foram interrompidos de propósito; o 7º, o 10º, o 11º, o 12º e o 13º terminaram com saída 0 e foram substituídos; o 8º foi interrompido pelo reinício do contêiner. O 2º e o 3º foram interrompidos para acrescentar testes, e o 5º parou por falha de ambiente do roteiro (o navegador do E2E). O 14º rodou em paralelo com a revisão 11, que não pediu mudança de código, e é o gate definitivo, na árvore `355b4d07` ([`execucoes.md`](execucoes.md)).
