# P5-F.1-R3 — Desenho corrigido das marcas de aplicação (B03)

**Estado:** desenho adotado na implementação da R3. Substitui a §5.A da `p5f1-r2a/PROPOSTA-ARQUITETURAL-B03.md` onde diverge; as divergências estão na §8 com o motivo.

## 1. Fatos medidos antes do desenho

| Fato | Evidência | Consequência |
| --- | --- | --- |
| No Emulator, o `updatedAt` gravado com `FieldValue.serverTimestamp()` **não** é igual ao `DocumentSnapshot.updateTime` da mesma escrita: tem precisão de milissegundo e fica alguns milissegundos antes | `sondas/sonda-updatetime.log`: 40 de 40 escritas com `updatedAt != updateTime` (ex.: `…119.793000000` contra `…119.801496000`) | a cadeia de versões **não** pode usar o `updatedAt` como identidade da versão, e o cliente não vê o `updateTime` (o SDK web não o expõe) |
| Na mesma transação, todos os `serverTimestamp()` resolvem para o mesmo valor, e os `updateTime` dos documentos escritos também são iguais entre si | mesma sonda (`mesmaTransacaoMesmoInstante`: os valores do mês e da marca coincidem, mas diferem do `updateTime`) | comparações de ordem por `serverTimestamp` entre commits diferentes não são confiáveis no Emulator |
| O SDK web lê vários documentos de coleções diferentes numa transação só de leitura, sob as Rules do projeto (inclusive `viewer`), e repete a transação quando um documento lido muda antes do commit | `sondas/sonda-transacao-leitura.log`: 1 tentativa sem concorrência; 2 tentativas com mudança no meio, e os valores devolvidos são os novos dos dois documentos; escrita direta continua negada | o cliente obtém um instante único para marcas e meses, sem relógio e sem comparar horários |
| Todo escritor de `transactions` em produção grava `updatedAt` com `serverTimestamp`; seeds de testes não | relatório do inventário dos escritores (R3) | a prova não depende desse contrato |

## 2. Invariante

Para cada lançamento `T` e cada geração `G` da projeção (a inicial `g0`, ou a de uma reconstrução publicada), **INV-M**:

> parte de `T` em `P_G` = efeito(`nó`) + Σ efeito líquido das pendências,

em que `P_G` é a projeção mensal (`cash_report_periods`) da geração `G`, `nó` é o estado de `T` que a marca diz estar refletido e as pendências são eventos já somados à projeção cujo predecessor ainda não chegou. Com a marca íntegra e sem pendências, a parte de `T` na projeção é exatamente o efeito do conteúdo identificado pelo `nó`.

A estimativa só converte quando, **num único instante de leitura**, para toda desconsiderada `T` (e o espelho do estorno, quando houver): a marca da geração dos meses lidos está íntegra, sem pendências, e o conteúdo lido de `T` tem a mesma impressão digital do `nó`. Nesse caso, tirar o item lido da receita do mês tira exatamente a parte de `T` da projeção.

## 3. Identidade de versão: impressão digital do conteúdo

- **Impressão digital:** SHA-256 de uma serialização canônica do documento inteiro (chaves ordenadas; `Timestamp`, referência, ponto geográfico e bytes com marcação de tipo; números não finitos marcados). A mesma função existe no backend (`functions/src/cash/projectionMarks.ts`) e no cliente (`src/modules/work-time/projectionProof.ts`), com paridade provada por fixture compartilhada e por leitura real dos dois SDKs no Emulator.
- **Tipo desconhecido:** um valor que a serialização canônica não conhece (por exemplo, `VectorValue`) faz a impressão falhar. No gatilho, isso vira violação de contrato do lançamento (registrada; não soma) e, na reconstrução, para a varredura; no cliente, a impressão nula nunca prova. É fail-closed. Nenhum escritor do produto grava esses tipos (as callables validam o contrato de `transactions`); limitação registrada (revisão de arquitetura, A07).
- **Por que serve:** conteúdos iguais têm efeitos iguais na projeção e na estimativa. Duas versões diferentes com o mesmo `updatedAt` (empate de milissegundo no Emulator) têm impressões diferentes. A identidade não depende de relógio nem de contrato dos escritores.
- **Privacidade da impressão** (revisão de privacidade, M-PRI-01; números das sondas do revisor, com a função real):
  - **versão atual:** quem lê a marca já lê o lançamento, pelo mesmo predicado de membro ativo, e calcula a mesma impressão; não há informação nova;
  - **versões anteriores ainda presentes na marca** (âncora e base da geração vigente, pendências e, até a próxima regravação, a posição de uma geração superada) podem ser **confirmadas por hipótese**, nunca lidas. A cerca de 203 mil impressões por segundo por núcleo:
    - a versão de criação (instante conhecido) com descrição e categoria antigas foi confirmada em 49.388 tentativas, em 277 ms;
    - uma versão produzida por edição, com `updatedAt` numa janela de 25 ms e 40 categorias, em 2,5 s; com janela de 1 s, cerca de 3,3 min;
    - busca aberta de texto livre (5 s × 10⁶ descrições) leva cerca de 285 dias por núcleo;
  - **o que isso acrescenta:** o viewer já lê em `activity_logs` (365 dias) a descrição de cada estado e o efeito em centavos, e o lançamento traz `cashEntry.requestHash` (P3-A), que confirma o conteúdo da criação para sempre. O acréscimo das marcas é confirmar valores antigos de campos que não vão ao log (categoria, data, conta, forma de pagamento, fornecedor, centro de custo, editor) e essa possibilidade sobreviver ao log e a uma correção;
  - **decisão:** impressão do documento inteiro, não só dos campos de efeito. A identidade não depende do contrato dos escritores: qualquer mudança gera versão nova. A alternativa expõe menos, mas exige manter a lista de campos igual às fórmulas de efeito nos dois SDKs, e uma diferença entre a lista e a fórmula daria duas versões com efeitos diferentes e a mesma impressão, ou seja, prova falsa. Sal secreto não resolve: o cliente precisa calcular a mesma impressão, então todo membro leria o sal;
  - **risco residual aceito:** confirmação por hipótese, por membro ativo, de versões anteriores ainda na marca. É limitado pela poda (§4), registrado no inventário (`PRIVACY_LGPD.md` §3, linha 26) e tem o passo de correção e anonimização da P8 (`PRIVACY_LGPD.md` §6.4: depois que o gatilho aplicou todas as entregas do lançamento, apagar a marca e reconstruir).
- **Ordem** continua no `updateTime`/`eventTime` do Admin SDK (exatos, em microssegundos), usados só no backend. O **corte** da reconstrução é o `serverTimestamp` do commit do checkpoint, e no Emulator ele fica alguns milissegundos **antes** do `updateTime` desse commit: por isso a publicação confere que toda entrega aplicada depois do corte alimentou a geração preparada (§6), em vez de supor corte igual ao commit.

## 4. Marca: dados e escritores

`workspaces/{ws}/cash_projection_marks/{transactionId}`, só do backend, com duas posições (`a` e `b`). A geração vigente fica numa posição (`markSlot` no estado da projeção; `a` sem reconstrução) e a preparada por uma reconstrução, sempre na outra.

| Campo | Quem grava | Conteúdo |
| --- | --- | --- |
| `anchors.{a,b}` | varredura da reconstrução, na transação que avança a página | `{g, cut, fp}`: o lançamento estava na base da geração `g` (corte `cut`) com o conteúdo `fp` |
| `chains.{a,b}` | gatilho, na transação que soma o delta | `{g, cut, root, base, node, pending, broken}`: a cadeia de eventos posteriores ao corte |
| `workspaceId`, `transactionId`, `schemaVersion`, `updatedAt` | os dois | metadados |

Sem valor monetário, descrição, mês, categoria ou preferência.

- **Poda (revisão de privacidade, L-PRI-02):** ao regravar a marca, o gatilho guarda só as componentes cuja geração (`g`) é a vigente ou a preparada (`pruneMarkDoc`, na mesma escrita, sem leitura nem escrita a mais). A varredura só grava a âncora da posição preparada, com merge. Fica, até a próxima regravação, a posição de uma geração superada; num lançamento apagado (só desenvolvimento), ela fica até a eliminação do workspace. Provas: teste de unidade, propriedade INV-M com a poda (954 podas em 4.000 cenários), integração 15 (a âncora da preparada sobrevive às entregas da preparação; a posição superada sai na regravação seguinte, também depois de duas reconstruções) e mutantes B13 a B16.
- **Índices:** todos os campos da marca estão isentos de índice de campo único (`firestore.indexes.json`), porque nada consulta a coleção: o backend e o cliente leem por id.

## 5. Modelo de estados

`nó ∈ {ausente, vivo@fp, apagado}`; `ausente` e `apagado` têm efeito zero.

Cada evento aplicado tem `antes ∈ {nenhum, vivo@fp}` e `depois ∈ {vivo@fp, apagado}`. Um evento **casa** com o nó quando `antes = vivo@fp = nó`, ou `antes = nenhum` e o nó é `ausente` ou `apagado`.

- **Casou:** o nó passa a `depois`; em seguida, toda pendência que casar com o novo nó é absorvida, em ordem.
- **Não casou:** o evento vai para as pendências (até 16). Acima disso, a cadeia vira `broken` e o estado da projeção registra a recuperação (`markRecoveryNeeded`).
- **INV-M preservada:** casar significa efeito(`antes`) = efeito(`nó`), então efeito(novo nó) = efeito(nó) + delta; pendência soma o delta à parcela pendente; absorção troca efeito(nó) + delta pelo efeito do novo nó.

**Raiz da cadeia** (de onde vem o nó inicial da geração `G`):

| Situação | Nó inicial |
| --- | --- |
| âncora de `G` presente (lançamento na base) | `vivo@âncora.fp` |
| `G` publicada, sem âncora | `ausente` (definitivo: a varredura grava a âncora de todo documento da base antes da publicação) |
| `G` em preparação, sem âncora, evento com `before.updateTime ≤ corte` | `vivo@fp(before)` (raiz `event`) |
| `G` em preparação, sem âncora, criação | `ausente` (raiz `absent`, provisória) |
| `G` em preparação, sem âncora, outro evento | sem raiz: o evento fica pendente |

**Conflitos que viram `broken`:** âncora com raiz `absent` (a varredura achou o lançamento na base depois de uma criação ter sido encadeada como fora dela); âncora com raiz `event` de outra impressão; raiz `event` sem âncora numa geração publicada.

**Registro da recuperação:** a primeira vez que a cadeia **gravada** de uma geração fica `broken` (estouro de pendências, ou um conflito que até ali só aparecia na visão e o primeiro evento seguinte grava) liga `markRecoveryNeeded`, soma `markIssueCount`, guarda o maior `eventTime` em `markIssueMaxEventTime` e gera o log `cash_projection_mark.broken`. Um evento sobre uma cadeia já gravada como `broken` não registra de novo (revisão de arquitetura da R3, A03).

## 6. Reconstrução e recuperação de marcas `broken`

- **Preparação:** a varredura grava a âncora de cada documento da base na posição da geração preparada. O gatilho alimenta a cadeia da geração vigente e, para eventos posteriores ao corte, também a da preparada.
- **Publicação:** no mesmo commit dos meses, `markSlot` passa à posição da preparada, cada mês ganha `projectionGeneration = {id, cutoff}` e `markRecoveryNeeded` é desligado se o corte cobre o último incidente de marca.
- **Conferência das entregas na publicação:** toda marca de entrega `applied` com commit depois do corte precisa listar a geração preparada em `categoryGenerations`. Se não lista, a entrega leu o estado antes do commit do checkpoint, embora o commit do evento seja posterior ao corte (no Emulator, o `serverTimestamp` do corte fica alguns milissegundos antes do commit do checkpoint). Nesse caso o mês está certo, porque soma o delta por essa marca, mas a cadeia (e as categorias) da geração nova não têm o evento. A publicação recomeça (`post_cutoff_event_missed_staging`); o corte novo é posterior ao commit do evento e a varredura nova o ancora. A mesma conferência fecha a lacuna equivalente das categorias por geração (P5-C1). Achado da revisão de arquitetura da R3 (contraexemplos com prova verdadeira e valor errado), reproduzido no Emulator pelo teste "entrega com commit depois do corte que leu o estado antes do checkpoint".
- **Recuperação:** a geração nova tem âncoras e cadeias próprias. Uma cadeia `broken` da geração anterior fica na outra posição e não é lida para a geração nova. A conversão volta só quando a cadeia da geração nova prova o estado lido.
- **Eventos posteriores ao corte** já aplicados durante a preparação estão na cadeia preparada; os de antes do corte que chegam depois da publicação são `covered_by_rebuild` e não mexem em cadeia nenhuma; reentrega é `duplicate`.
- **Falha entre preparação e publicação:** a geração vigente e a posição dela não são tocadas; um recomeço usa a mesma posição preparada com outro `g`, e o que sobrou da preparação abandonada é ignorado pelo `g`.

- **Âncora sem ler a marca × regravação inteira pelo gatilho** (revisão financeira, F-02): a transação do gatilho lê a marca, então o commit da página, que grava a âncora com merge, espera o fim dela ou faz o gatilho recomeçar e reler. Integração 16, no Emulator: o corpo do gatilho lê a marca e fica com a transação aberta enquanto a página tenta o commit da âncora. Resultado: o gatilho fez o commit na 1ª tentativa, a página esperou, a âncora sobreviveu, a cadeia confere e o mês tem o valor posterior ao corte.

## 7. Prova no cliente

1. **Leitura atômica:** numa transação só de leitura do SDK web, os meses da janela e as marcas de todas as desconsideradas e dos espelhos de estorno. Os lançamentos são lidos por id (servidor), com a impressão digital do conteúdo bruto.
2. **Geração:** todos os meses existentes da janela têm a mesma `projectionGeneration`; sem ela, não há prova. Sem nenhum mês na janela, a projeção é zero e só se prova com receita zero nas bases.
3. **Bases:** a receita das bases é igual à dos meses lidos na transação, em todos os meses da janela.
4. **Por lançamento:** visão da geração dos meses lidos (§5). Sem dados da geração: se a marca tem dado de geração mais nova na posição, não há prova; senão, a parte é zero.
5. **Item:** `vivo@fp` exige o lançamento lido com a mesma impressão e usa esse conteúdo. `ausente` ou `apagado` usam parte zero (nada a tirar) **só quando a leitura por id não encontrou o lançamento**. Se ela o encontrou, não há prova (`content`, passageiro): ou o gatilho ainda não aplicou o conteúdo lido, ou o lançamento entrou na projeção sem marca (dado anterior às marcas, restauração ou importação sem reconstrução). Recusa a mais, nunca prova a mais (revisão de arquitetura da R3, A02). Vale também para o espelho do estorno.
6. **Sem prova:** não converte; valores em reais; depois da espera, o texto muda para "estimativa em atualização", sem validade financeira nova. Releituras limitadas pelo agendador com orçamento, nunca prazo que aprove.

## 8. Divergências da proposta da R2A

| Ponto da R2A | R3 | Motivo |
| --- | --- | --- |
| `appliedVersion` por `updateTime` e contrato `updatedAt == updateTime` | impressão digital do conteúdo | o contrato falha no Emulator (§1) |
| `monthCommits` e "escuta posterior aos commits" | leitura atômica de marcas e meses | a ordem por `serverTimestamp` não é confiável no Emulator; a transação dá um instante único |
| marcas não reescritas na reconstrução; condição 1 por `rebuildCutoff` | âncoras por geração e duas posições | uma marca `broken` ficava bloqueada para sempre (achado da auditoria) e a criação depois do corte não era provável sem saber se o id estava na base |
| `pending` como mapa por versão anterior | lista limitada de pares (`antes`, `depois`) por conteúdo | casa também criação e exclusão |

## 9. Custos

Fontes: medições com as funções reais (gatilho, página da reconstrução e agendador do cliente), feitas pelo revisor de escala (`revisoes/escala-custo/`, sondas e logs), e estimativas com as premissas abaixo. "Medido" é saída de sonda; "estimativa" depende das premissas.

**Premissas das estimativas:**
- **P1.** Cada documento lido custa 1 leitura, inclusive o inexistente. Uma consulta custa no mínimo 1.
- **P2.** Cada requisição do cliente custa 2 leituras nas Rules: perfil `users/{uid}` e membership.
- **P3.** No SDK web, cada `transaction.get` é uma requisição, e o commit da transação só de leitura leva um `verify` por documento lido. **Premissa não verificada:** o `verify` não é cobrado como escrita. Se for, cada tentativa custa m + u escritas a mais.

**Notação:** N lançamentos do workspace; E entregas aplicadas por mês; m meses da janela (até 13); k desconsideradas (até 50); u = k + espelhos de estorno (até 100); Q = ⌈u/30⌉.

| Onde | Custo | Fonte |
| --- | --- | --- |
| Gatilho, por entrega aplicada | +1 leitura (marca, no mesmo `getAll`) e +1 escrita (marca). Reentrega e entrega coberta: +1 leitura, nenhuma escrita. Primeira quebra de uma cadeia: +1 escrita no estado. Exemplos R2A → R3 (leituras/escritas): criação 2/3 → 3/4; edição sem efeito de caixa 2/1 → 3/2 | Medido |
| Meses | `projectionGeneration` (35 a 76 B) nas escritas que já existem, sem escrita a mais | Medido (escritas); estimativa (tamanho) |
| Marca, por lançamento | 373 B só na `g0`; depois de uma publicação, 599 B com a poda (726 B sem ela); no máximo 5.743 B (2 posições, 16 pendências). Nenhum campo tem índice de campo único: 0 entrada de índice por marca. Sem a isenção, o revisor estimou 22 a 78 entradas, cerca de 9 vezes o documento. A isenção só vale num ambiente depois da implantação dos índices, que não cabe a agentes; uma consulta futura sobre marcas vai exigir índice declarado | Medido (tamanho e campos isentos); estimativa (índice sem isenção) |
| Por workspace (armazenamento) | N × 0,4 a 0,7 KB: cerca de 4 a 7 MB com N = 10 mil, e cerca de 75 a 145 MB com N = 200 mil | Estimativa |
| Reconstrução | +1 escrita por documento da base (âncora), dentro do teto de 500 escritas por commit; nenhum commit passou de 500 nos 10 cenários medidos (`processPage` real, N = 20 mil). As âncoras dividem o orçamento com dias e categorias. Em workspaces diversos, até 1,79 vez mais chamadas; no cenário adversário (600 meses, 500 categorias), até 2,85 leituras por documento. A capacidade em 24 h, no limite de chamadas e na página padrão (300), cai de 20% a 28% (cenário diverso: de cerca de 716 mil para 516 mil lançamentos). Com a página máxima de 500, a queda chega a cerca de 44%; a capacidade absoluta da R3 (516 mil, ou 9,3 h para 200 mil lançamentos) é a mesma nas duas. Cada recomeço grava todas as âncoras de novo, com outro `g` | Medido; capacidade estimada |
| Prova, por tentativa | R = Σ max(1, achados por consulta) + 2Q + 3(m + u) + 2 leituras. PF típico (m = 3, u = 3): 25. Médio (12, 20): 120. Teto (12, 100): 446. A R2A relia só as desconsideradas (u + 2Q): 5, 22 e 108 | Estimativa (P1 a P3) |
| Prova, novas tentativas | A transação faz até 5 tentativas, e o React Query repete até 3 vezes: teto teórico de cerca de 7,2 mil leituras numa estimativa no teto | Estimativa |
| Prova, estado pendente que não se resolve (A04, RR-R3-01) | O agendador relê 34 vezes na primeira hora, depois 31/h por estimativa montada (725 em 24 h): cerca de 775 leituras/h no PF típico e 13,8 mil/h no teto | Medido (agendador real); leituras estimadas |
| Prova, receitas contínuas nos meses da janela | Até 35 releituras/h pelo agendador da prova, mais 1 por liberação da base (pela escuta, até 35/h, e pela mutação, até 8/h): até 78/h, cerca de 34,8 mil leituras/h no teto, com as bases em passo. Fora de passo, cada base pode liberar sozinha: até cerca de 121/h, cerca de 54 mil leituras/h no teto | Estimativa (fora de passo: leitura do código, não medida) |
| Prova, projeção que diverge e volta | Quando a projeção de um mês da janela diverge da base e volta antes de as bases relerem (receita lançada e anulada, ou edição desfeita), a sincronização libera e relê a prova na hora, sem agendador: 1 prova por volta, por estimativa montada com desconsideradas (até 446 leituras no teto). O limite por hora vem das escritas: cada volta exige pelo menos 2, e cada membro tem até 120 lançamentos e 120 correções ou anulações a cada 10 min. São até cerca de 720 voltas/h por membro que escreve, cerca de 321 mil leituras/h no teto (R2A: cerca de 78 mil) | Medido (gancho real: 20 voltas, 20 provas, nenhuma releitura de base); leituras estimadas |
| Dashboard (RR-R2A-04) | 2 a 3 chamadas de `getFinancialReport` a mais por nova assinatura da escuta (carga, troca de workspace ou de mês), dentro do orçamento da releitura | Estimativa |
| Consultas, escutas e índices compostos | Nenhum novo | Busca no diff |

**Por mês** (estimativa):

| Cenário | Gatilho | Prova | Armazenamento | Reconstrução, por tentativa |
| --- | --- | --- | --- | --- |
| PF realista: N = 10 mil; E = 300; m = 3; u = 3; 1 sessão de 176 h; cerca de 2 releituras/h | +300 leituras e +300 escritas | cerca de 8,8 mil leituras (R2A: cerca de 1,8 mil) | cerca de 4 a 7 MB | 10 mil leituras, +10 mil escritas, cerca de 34 chamadas (igual à R2A) |
| PJ de alto volume: N = 200 mil; E = 15 mil; m = 12; u = 10; 5 sessões de 176 h; 35 releituras/h | +15 mil leituras e +15 mil escritas | cerca de 2,46 milhões (R2A: cerca de 370 mil) | cerca de 75 a 145 MB | cerca de 930 chamadas (cerca de 9,3 h no limite), 278 mil leituras e 200 mil escritas (R2A: 670 chamadas e 200 mil leituras) |
| PJ no teto (u = 100) | igual | cerca de 13,7 milhões (R2A: cerca de 3,3 milhões) | igual | igual |

**Leitura.**
- A prova custa de cerca de 4 a 7 vezes cada releitura dependente da R2A nos casos desta seção; a razão cresce com m e cai com u. É o preço de ler meses e marcas num instante só.
- O custo tem limite por tentativa: 13 meses e 100 marcas, teto testado no Emulator com as Rules finais (suíte de ataques, "tetos do cliente"). As entradas já chegam limitadas antes disso: até 50 desconsideradas, pelas Rules da preferência, e janela de até 12 meses. Por hora, as releituras pelo agendador da prova e as liberações que dependem de releitura das bases têm o orçamento dos agendadores; a liberação por volta da projeção não tem orçamento no cliente e fica limitada pela frequência de escrita dos membros.
- O que não tem limite no tempo é o estado pendente que não se resolve (A04). Está registrado no plano (RR-R3-01); o sinal de recuperação fica a cargo da P7.

## 10. Premissa da prova e política de legado

- **Escritores dos meses:** `cash_report_periods` só é gravado pelo gatilho de caixa (`writeCashPlan`, na transação do delta e da marca) e pela publicação da reconstrução (com as âncoras gravadas nas páginas da mesma geração). Busca em `functions/src` (fora de testes e `testSupport`): `cashPeriodRef` só em `functions/src/cash/periods.ts` (`writeCashMonth`) e `functions/src/cash/rebuild.ts` (publicação e órfãos); `goals/kpi.ts` e `reports/cash.ts` só leem. Não há escritor paralelo.
- **Premissa:** a INV-M vale para toda geração cuja projeção foi construída sob as marcas: o workspace nasceu depois desta etapa (geração `g0` só com eventos que gravaram a marca na mesma transação) ou a geração vigente foi publicada por uma reconstrução desta etapa (âncora de todo documento da base). Um lançamento gravado antes das marcas e nunca mais tocado não tem marca, e a projeção o contém; se um mês com ele também recebesse um evento depois da implantação (e a etiqueta da geração), a prova trataria a parte dele como zero.
- **Como a prova não depende mais da premissa:** depois da revisão de arquitetura (A02), o cliente não aceita `ausente` ou `apagado` quando a leitura por id encontra o lançamento (§7, item 5). Um lançamento sem marca que está na projeção é sempre encontrado (ele existe), então nunca prova; se ele recebe evento novo, a cadeia fica pendente (teste de integração "lançamento sem histórico de marca"), e meses sem `projectionGeneration` (gravados antes) nunca provam. Não há migração nem compatibilidade com dados anteriores (política de legado do projeto, `CLAUDE.md` e plano mestre §1; o pedido da R3 proíbe criá-las): esses dados só deixam de recusar depois de uma reconstrução.
- **Ambiente DEV/STAGING com dados anteriores:** recriar por seed ou executar a reconstrução da projeção (operação existente, P3-B) antes do uso; a publicação ancora todos os lançamentos da base e etiqueta todos os meses. Registrado como condição de implantação no plano mestre (§20.18) e nas instruções de reprodução.
- **Regra de efeito** (revisão financeira, F-03): a prova supõe que conteúdos iguais têm o mesmo efeito. Isso vale com a mesma `cashPeriodDeltaFor` no backend e a mesma `classifyIncomeDocument` no cliente; a etiqueta da geração não leva a versão dessas regras. **Condição para toda mudança futura dessas regras** (registrada no plano, §20.18, RR-R3-06): a mesma mudança acrescenta a versão da regra à etiqueta da geração e exige igualdade no cliente. Os workspaces são reconstruídos antes da publicação do cliente novo. Sem isso, a projeção calculada pela regra antiga e o cliente com a regra nova dariam prova verdadeira com valor errado até a reconstrução. A R3 não muda nenhuma das duas regras.
- **Leitura por id antes da transação** (revisão financeira, F-04): a prova compara identidade de conteúdo, não instante.
  - Pela INV-M no instante da transação, a parte de T é o efeito do nó.
  - O nó tem a impressão do conteúdo lido, que pode ter sido lido antes.
  - Logo, o efeito subtraído é a parte de T.
  - Um lançamento que não existia na leitura por id e foi criado e aplicado antes da transação tem nó vivo sem conteúdo lido, e a prova recusa. Se ainda não foi aplicado, a parte dele é zero, como na leitura.
  - A ordem só pesa se a INV-M falhar no backend, como no A01, já corrigido.
  - Ler os lançamentos na mesma transação somaria até 100 leituras com Rules por tentativa (§9). Fica registrado como defesa em profundidade possível (RR-R3-07).
- **Restauração ou importação inconsistente (resíduo da A02):** com meses de um instante e marcas e lançamentos de outro, a INV-M deixa de valer por fora do produto e a prova pode sair verdadeira com valor errado; nenhuma leitura do cliente percebe isso. A condição operacional fica no runbook de DR (`BACKUP_RESTORE_DR.md`, §3 e §6): marcas e meses nunca são copiados de outro banco; a reconstrução de cada workspace afetado vem antes de reabrir o acesso. PITR ou backup do banco inteiro num instante único é consistente.
