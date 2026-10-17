# P5-E1.1 — Mutações dirigidas

## Método

- **Cópias isoladas do working tree**, extraídas por índice Git temporário (o índice real nunca foi tocado):
  - `mut`, fiel ao working tree, para os mutantes unitários, de frontend e de integração;
  - `mut-e2e`, igual, mas com as portas do Emulator trocadas (8280/9299/5201), para os mutantes E2E.
- **Ciclo por mutante:**
  1. confere que o arquivo-alvo é idêntico no repositório e na cópia (SHA-256);
  2. aplica as trocas exatas e únicas;
  3. roda o comando da camada;
  4. restaura o original e confere o SHA-256 de novo.
- **Classificação:**
  - mutante que não compila é **inválido** e não conta;
  - **morto** quer dizer que o comando saiu com erro por asserção reprovada, conferida no log de cada mutante (`not ok …` ou o caso E2E reprovado), não por falha de infraestrutura.
- **Ambiente:** só o Emulator do projeto `minhas-financas-local`, com o gateway de IA falso. A integração usa portas próprias (8180/9199); o E2E usa a cópia com portas trocadas. Proxy de loopback e limpeza do Emulator só pelos wrappers seguros (`ambiente-porta-8080.md`). Os processos de cada mutante rodam numa sessão própria, encerrada com SIGTERM.
- **Script:** `mutate-p5e11.py`, no scratchpad da sessão. Os resultados ficam em `mutation-results.json` e os logs por mutante em `mutlogs/`. Uma cópia do JSON, sem códigos de cor e sem caminhos de sessão, está em [`mutacoes.json`](mutacoes.json).

## Camadas e comandos

| Camada | Comando | Alvos |
| --- | --- | --- |
| Unitário das Functions | `tsc` + `node --test` de `analysisContext` e `callables` | `functions/src/ai/analysisContext.ts`, `prompts.ts` |
| Frontend | `tsc --noEmit` + `npm run test:unit:notifications` ou `test:unit:billing` | `pressOrigin.ts`, `NotificationsPanel.tsx`, `Header.tsx`, `model.ts`, `feed.ts`, `AiShareConsentDialog.tsx` |
| Integração | `firebase emulators:exec` (auth, firestore) + `aiMinimization` e `aiContext` | `analysisContext.ts`, `prompts.ts` |
| Corrida de saída | `tsc --noEmit` + `playwright test` de `e2e/notifications-exit-race.spec.ts` na cópia (sem `webServer`: não usa o app nem o Emulator) | `NotificationsPanel.tsx` |
| E2E | `npm run test:e2e -- e2e/notifications-mobile-p5e11.spec.ts --grep <casos>` | `api.ts`, `Header.tsx`, `NotificationsPanel.tsx`, `pressOrigin.ts` |

## Passadas (todas registradas)

| Passada | Árvore | Mutantes | Resultado |
| --- | --- | --- | --- |
| Preliminar (10:08–10:14Z) | desenho A das notificações (substituído) | 24 (N01–N15, X01–X11) | descartada: alvos do desenho A que não existem mais |
| 1 | árvore final, antes do teste novo de teclado | 33 de frontend e unitários | 32 mortos; **R05 sobreviveu** |
| 2 | árvore final, com os casos de teclado sem `pointerId` em `tests/unit/press-origin.test.ts` | 33 de frontend e unitários | 33 mortos |
| Integração | árvore final | 7 | 7 mortos |
| Diálogo | árvore final, com o corpo do diálogo focável quando rola | X10, X11 (de novo), X19, X20 | 4 mortos |
| E2E, lote 1 | cópia de 13:05Z: os alvos de E01–E05 (`api.ts`, `Header.tsx`, `NotificationsPanel.tsx`) já eram os finais; o `pressOrigin.ts` ainda não tinha o foco na reentrega, e a spec tinha o cabeçalho antigo (5 linhas a menos: os casos citados como 297 e 620 hoje estão em 302 e 625, com o mesmo corpo) | E01–E06 | 6 mortos (substituídos na tabela pelas passadas na árvore final, abaixo) |
| Revisão (rodada 2) | árvore final, depois do foco na reentrega (L3/L4) e da regressão determinística (M1) | R01–R10 (de novo), R16, R17, R18, R13r, R14r, R16r | 16 mortos |
| E2E, E06 de novo | cópia da árvore final | E06 | morto |
| E2E na árvore final | a mesma cópia da árvore final, depois de uma execução de controle sem mutação (5/5 nos casos 01, 02, 08, 10 e 15) | E01–E05 de novo | 5 mortos |

No fim do lote 1 dos E2E, o script registrou "repo intacto: False". A causa foi a correção L3/L4 no `pressOrigin.ts`, alvo do E06, feita no repositório durante o lote; o script de mutação nunca escreve no repositório, só na cópia. Por isso o E06 foi refeito numa cópia da árvore final: morto, com "repo intacto: True".

**Registros de E04 e E05 e a passada final dos E2E.** O lote 1 matou os seis mutantes E2E, como mostra o console do lote (no scratchpad da sessão). Mas os registros de E04 e E05 se perderam do `mutation-results.json`: o lote da revisão (R01–R18) rodava ao mesmo tempo e regravou o arquivo com a cópia que tinha lido antes. O script passou a reler o arquivo sob trava (`flock`) e a gravar só o mutante corrente. Para que todos os mutantes E2E tenham resultado na árvore final, E01–E05 foram refeitos na cópia da árvore final (a mesma do E06 de novo, diferente do repositório só nas portas), depois de uma execução de controle sem mutação. A tabela abaixo traz esses resultados.

**O sobrevivente da passada 1 (R05).** O R05 tira a regra "clique sem ponteiro (`detail === 0`) passa". Ele sobreviveu porque os casos de teclado do teste usavam `pointerId: -1` ou um `pointerId` diferente do toque, e por isso passavam pela regra do `pointerId` mesmo sem a regra `detail === 0`. Faltava cobrir o clique de teclado sem `pointerId`, que é o caso dos navegadores em que o `click` não é `PointerEvent`, logo depois de um toque em outro dono.

Foram acrescentados casos em `tests/unit/press-origin.test.ts`:
- teclado sem `pointerId`, dentro da janela, sobre outro aviso e sobre o fundo: passa;
- mesmo `pointerId` do toque com `detail` 0: passa;
- no roteador, o clique de teclado não consome o gesto, e o clique do próprio toque ainda é reentregue.

Na passada 2, o R05 morreu.

## Resultado final

| ID | Camada | Item | Mutação | Resultado | Teste que reprovou | Restaurado (SHA-256) |
| --- | --- | --- | --- | --- | --- | --- |
| X01 | unitário (Functions) | 4.2 | nome livre da categoria volta ao contexto (grupo = nome) | **morto** | leva números exatos ao contexto e ao texto renderizado | sim |
| X04 | unitário (Functions) | 4.3 | posição começa em 0 ("Grupo de despesas 0") | **morto** | leva números exatos ao contexto e ao texto renderizado | sim |
| X05 | unitário (Functions) | 4.4 | ordenação por valor crescente | **morto** | leva números exatos ao contexto e ao texto renderizado | sim |
| X06 | unitário (Functions) | 4.4 | envia 6 grupos (teto de 5 ignorado) | **morto** | mais de cinco categorias: só as cinco maiores, sem nenhum nome | sim |
| X07 | unitário (Functions) | 4.7 | versão do contexto não muda (continua 1) | **morto** | expõe versão, blocos, limites e não pede série | sim |
| X08 | unitário (Functions) | 4.2 | nome da categoria é lido (mesmo sem ir ao contexto) | **morto** | nunca lê o nome nem a chave da categoria | sim |
| X09 | unitário (Functions) | 4.5 | instrução de sistema perde a regra dos grupos (consultor pode inventar nomes) | **morto** | a instrução de sistema proíbe inventar ou associar nomes de categoria | sim |
| X16 | unitário (Functions) | 12-6 | categorias indisponíveis viram lista vazia "sem movimento" (zero) | **morto** | fonte de categorias indisponível: bloco sem números, nunca zero | sim |
| X17 | unitário (Functions) | 12-7 | valor agregado do grupo alterado (+1 centavo) | **morto** | leva números exatos ao contexto e ao texto renderizado | sim |
| N08 | frontend (unitários + guarda) | 12-19 | resposta antiga desfaz marca confirmada (fusão desligada) | **morto** | P5-E1.1 releitura que leu antes do arquivamento não traz o item de volta | sim |
| N09 | frontend (unitários + guarda) | 12-19 | fusão por E em vez de OU (marca do cache perdida) | **morto** | P5-E1.1 releitura que leu antes do arquivamento não traz o item de volta | sim |
| N10 | frontend (unitários + guarda) | 12-19 | consulta do feed sem a fusão (structuralSharing removido) | **morto** | P5-E1.1 releitura que leu antes do arquivamento não traz o item de volta | sim |
| N11 | frontend (unitários + guarda) | 8.1 | fusão liga marca que ninguém tem (exclusão inventada) | **morto** | dois usuários do mesmo workspace têm estados independentes | sim |
| N16 | frontend (unitários + guarda) | 12-12 | arquivar não remove (marca confirmada não aplicada no cache) | **morto** | dois usuários do mesmo workspace têm estados independentes | sim |
| N18 | frontend (unitários + guarda) | 12-20 | contagem não é relida depois da ação (arquivado segue como não lido) | **morto** | contagem: toda ação do painel, em sucesso ou erro, relê a contagem do escopo da ação | sim |
| N24 | frontend (unitários + guarda) | L7 | evento recriado com o mesmo ID herda a marca antiga | **morto** | P5-E1.1 evento recriado com o mesmo ID (outra expiração) não herda marca do cache | sim |
| R01 | frontend (unitários + guarda) | 12-13/15 | clique desviado passa onde caiu (roteamento desligado) | **morto** | toque em "Arquivar" cujo click caiu no corpo de outro aviso volta para o "Arquivar" de origem | sim |
| R02 | frontend (unitários + guarda) | 12-12 | desviado só é impedido, sem reentrega (o toque se perde) | **morto** | toque em "Arquivar" cujo click caiu no corpo de outro aviso volta para o "Arquivar" de origem | sim |
| R03 | frontend (unitários + guarda) | 12-13 | reentrega ao elemento onde o clique caiu (aviso errado) | **morto** | toque em "Arquivar" cujo click caiu no corpo de outro aviso volta para o "Arquivar" de origem | sim |
| R04 | frontend (unitários + guarda) | 8.3 | mouse também reentregue (arrastar para fora deixa de cancelar) | **morto** | mouse: click desviado é só impedido (nunca reentregue) | sim |
| R05 | frontend (unitários + guarda) | 9.3-17 | teclado e leitor de tela tratados como gesto de toque | **morto** | teclado, leitor de tela e click() programático (detail 0) passam como sempre | sim |
| R06 | frontend (unitários + guarda) | 8.3 | pointerId ignorado (clique simulado reentregue a origem antiga) | **morto** | click de outro ponteiro (simulado com -1 ou de outro dedo) não é o gesto registrado e passa | sim |
| R07 | frontend (unitários + guarda) | 8.3 | janela do gesto ignorada (gesto antigo decide) | **morto** | gesto antigo (fora da janela) ou sem origem: passa | sim |
| R08 | frontend (unitários + guarda) | 8.3 | gesto não termina no clique (origem reaproveitada por outro clique) | **morto** | roteador: reentrega o click desviado do gesto e encerra o gesto no primeiro click | sim |
| R09 | frontend (unitários + guarda) | 8.5 | clique reentregue a aviso que já saiu da página | **morto** | dono de origem que já saiu da página: o click é só impedido | sim |
| R10 | frontend (unitários + guarda) | 12-16 | ouvinte de clique na bolha (o React age antes do roteamento) | **morto** | P5-E1.1 roteamento do clique: ouvintes de captura no documento, sem reimplementar o toque | sim |
| R11 | frontend (unitários + guarda) | 12-16 | fundo deixa de ser dono de gesto (toque no painel fecha pelo fundo) | **morto** | P5-E1.1 Header: o fundo transparente é dono de gesto (só recebe o clique de gesto iniciado nele) | sim |
| R12 | frontend (unitários + guarda) | 12-13 | aviso deixa de ser dono de gesto | **morto** | painel: texto da ação explícito e estados de carregamento e erro | sim |
| R13 | frontend (unitários + guarda) | 12-12 | sem re-render no fim da saída (aviso arquivado fica preso no DOM, framer-motion 10.16) | **morto** | painel: texto da ação explícito e estados de carregamento e erro | sim |
| R14 | frontend (unitários + guarda) | 12-12 | re-render com valor fixo (o React descarta a 2ª atualização igual) | **morto** | painel: texto da ação explícito e estados de carregamento e erro | sim |
| R15 | frontend (unitários + guarda) | UI | linha perde o layout original (mudança visual fora do necessário) | **morto** | painel: texto da ação explícito e estados de carregamento e erro | sim |
| R16 | frontend (unitários + guarda) | 12-12 | re-render sem efeito (setter que não faz nada) | **morto** | painel: texto da ação explícito e estados de carregamento e erro | sim |
| R17 | frontend (unitários + guarda) | L4 | foco não acompanha o clique reentregue | **morto** | aplicar a rota: impede o click onde caiu e reentrega uma única vez ao dono de origem | sim |
| R18 | frontend (unitários + guarda) | L3 | reentrega a dono sem click() (erro depois do preventDefault) | **morto** | aplicar a rota: impede o click onde caiu e reentrega uma única vez ao dono de origem | sim |
| X10 | frontend (unitários + guarda) | 5.1 | diálogo deixa de dizer que os nomes das categorias não vão | **morto** | diálogo de envio ao provedor: textos exatos das quatro variantes | sim |
| X11 | frontend (unitários + guarda) | 5.2 | diálogo promete anonimização | **morto** | diálogo de envio ao provedor: textos exatos das quatro variantes | sim |
| X19 | frontend (unitários + guarda) | UI/a11y | corpo do diálogo que rola fica fora do teclado (sem o hook) | **morto** | diálogo de envio ao provedor: acessível, foco preso e cancelar não envia | sim |
| X20 | frontend (unitários + guarda) | UI/a11y | área que rola nunca recebe tabindex | **morto** | diálogo de envio ao provedor: acessível, foco preso e cancelar não envia | sim |
| X02 | integração (Emulator) | 6 | nome livre da categoria volta ao contexto — pego pelo pipeline real (P01–P28) | **morto** | X01 PF com movimentos: números do servidor, formato BRL inteiro e só campos permitidos | sim |
| X03 | integração (Emulator) | 4.3 | rótulo do grupo usa a chave interna da categoria (ID persistente) | **morto** | X01 PF com movimentos: números do servidor, formato BRL inteiro e só campos permitidos | sim |
| X12 | integração (Emulator) | 12-2 | minimização por regex de CPF (o resto do nome livre vai) | **morto** | P01 nome comum: o pedido ao provedor traz só 'Grupo de despesas N' | sim |
| X13 | integração (Emulator) | 12-3 | minimização por regex de e-mail (o resto do nome livre vai) | **morto** | P01 nome comum: o pedido ao provedor traz só 'Grupo de despesas N' | sim |
| X14 | integração (Emulator) | 12-4 | filtro de padrões (CPF, CNPJ, e-mail, telefone): dado pessoal sem padrão passa | **morto** | P01 nome comum: o pedido ao provedor traz só 'Grupo de despesas N' | sim |
| X15 | integração (Emulator) | 12-5 | minimização removida de um bloco: nomes dos cartões no contexto | **morto** | X01 PF com movimentos: números do servidor, formato BRL inteiro e só campos permitidos | sim |
| X18 | integração (Emulator) | 12-10 | análise enviada sem confirmação da operação | **morto** | P26 sem confirmação de envio: nada é lido, enviado nem cobrado | sim |
| R13r | corrida de saída (Playwright, sem o app) | 12-12 | sem re-render no fim da saída: aviso fica preso (spec da corrida) | **morto** | e2e/notifications-exit-race.spec.ts:72:3 › sai do DOM: o NotificationsPanel re-renderiza a cada onExitComplete (framer-motion 10.16) (reprovou na rodada 1 de 10) | sim |
| R14r | corrida de saída (Playwright, sem o app) | 12-12 | re-render com valor fixo: a 2ª atualização igual é descartada (spec da corrida) | **morto** | e2e/notifications-exit-race.spec.ts:72:3 › sai do DOM: o NotificationsPanel re-renderiza a cada onExitComplete (framer-motion 10.16) (reprovou na rodada 1 de 10) | sim |
| R16r | corrida de saída (Playwright, sem o app) | 12-12 | re-render sem efeito, setter que não faz nada (spec da corrida) | **morto** | e2e/notifications-exit-race.spec.ts:72:3 › sai do DOM: o NotificationsPanel re-renderiza a cada onExitComplete (framer-motion 10.16) (reprovou na rodada 1 de 10) | sim |
| E01 | E2E (Playwright) | 12-14 | arquivar não grava (recarga restaura o arquivado) | **morto** | e2e/notifications-mobile-p5e11.spec.ts:302:1 › P5-E1.1 01 — um arquivamento: sai da lista, o sino cai em 1 e só o estado dele é gravado | sim |
| E02 | E2E (Playwright) | 12-17 | viewer perde o arquivamento | **morto** | e2e/notifications-mobile-p5e11.spec.ts:625:1 › P5-E1.1 10 — viewer arquivando: persiste, o sino cai em 1 e não existe nenhum botão de excluir | sim |
| E03 | E2E (Playwright) | 12-18 | viewer ganha "Excluir para mim" | **morto** | e2e/notifications-mobile-p5e11.spec.ts:625:1 › P5-E1.1 10 — viewer arquivando: persiste, o sino cai em 1 e não existe nenhum botão de excluir | sim |
| E04 | E2E (Playwright) | 12-13 | arquiva o aviso vizinho (índice deslocado) | **morto** | e2e/notifications-mobile-p5e11.spec.ts:302:1 › P5-E1.1 01 — um arquivamento: sai da lista, o sino cai em 1 e só o estado dele é gravado | sim |
| E05 | E2E (Playwright) | 12-16 | fundo deixa de ser dono de gesto: toque no painel fecha pelo fundo | **morto** | e2e/notifications-mobile-p5e11.spec.ts:859:1 › P5-E1.1 15 — tocar dentro do painel nunca o fecha pelo fundo, nem com o clique redirecionado; o fundo só fecha com gesto… | sim |
| E06 | E2E (Playwright) | 12-13/15 | roteamento desligado: clique redirecionado abre o aviso errado | **morto** | e2e/notifications-mobile-p5e11.spec.ts:1063:1 › P5-E1.1 19 — clique redirecionado age no aviso em que o toque começou, nunca no aviso onde caiu | sim |


**Total: 54 mutantes; 54 mortos; 0 sobreviventes; 0 inválidos.**
