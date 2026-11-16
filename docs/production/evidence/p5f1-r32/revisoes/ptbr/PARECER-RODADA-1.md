PASS — revisão de UI de produto em PT-BR

# P5-F.1-R3.2 — revisão independente de produto e interface em pt-BR (`ptbr-product-ui-review`)

Revisão feita em 2026-11-11 sobre o código real, sem alterar o worktree nem o índice. Pasta: `<scratchpad>/p5f1r32/revisoes/ptbr`. Os logs citados como `logs/…` estão nessa pasta; os do executor, em `<scratchpad>/p5f1r32/logs/`.

## 1. Escopo conferido

- **Requisito.** Pedido do usuário (`relatorio/pedido-r32.md`), Frente A (RR-R31-05). Nenhuma conversão sem prova financeira válida, sem mudança de interface desnecessária. Documentar os impactos de sincronização demorada e a disponibilidade do painel "Receitas consideradas".
- **Árvores.**
  - Base R3.1: `efcbd264`.
  - Sob revisão: `ca11baca`, por atualização do coordenador (antes `6d28cf98`). As duas diferem só em `e2e/work-time-p5f.spec.ts`. O `src/` é o mesmo: `3863fa98` (`logs/arvore-ca11baca.txt`).
  - Vista em execução durante a revisão: `ff1aa360`. Muda só `README.md` e uma linha de comentário do `playwright.config.ts`; o `src/` e os specs são os da `ca11baca` (`logs/arvore-ff1aa360.txt`, `logs/diff-ff1aa360.txt`).
- **Worktree.** Corresponde à `ca11baca`, salvo os `firebase-debug.log` e `firestore-debug.log` não versionados (`logs/copia-ca11-verificacao.txt`). O índice não foi tocado: mtime 11:47:49, anterior à revisão, e HEAD `1730a1df`.
- **Telas e fluxos.**
  - Aviso do topo (`Header`) e valores convertidos do app.
  - Configurações → Tempo de trabalho equivalente: prévia, "Valor em uso agora", memória de cálculo e painel "Receitas consideradas".
  - Assistente: prévia, contagem e painel.
  - Fora de alcance: o modo dinheiro. A prova e a sincronização alteradas só são usadas pela estimativa de tempo de trabalho (`useIncomeEstimateWith.ts`, por `WorkTimeContext.tsx:118`, `WorkTimeSettingsView.tsx:177` e `WorkTimeWizard.tsx:69`).
- **Classificação.** O diff não tem alteração de UI; a classificação "requerida / fora de escopo" não se aplica. O que muda é quando estados já existentes aparecem. Essa mudança é requerida pelos itens 1 a 7 e 10 do pedido (RR-R31-05).

## 2. Evidências do código

| Critério | Arquivo:linha / comando | Conclusão |
| --- | --- | --- |
| Nenhum componente mudou | `git rev-parse <árvore>:src/components`: `1b846c67` em `efcbd264`, `6d28cf98` e `ca11baca` | Idêntico |
| Nenhum texto do módulo mudou | `git rev-parse <árvore>:src/modules/work-time/messages.ts`: `07d7de2f` nas três | Idêntico |
| Nenhum estilo, layout ou `.tsx` mudou | `git diff --stat` sem `.tsx`, `.css`, `index.html`, `tailwind`, `postcss` nem `public/` (`logs/diff-escopo-ui.txt`) | Nada |
| O `src/` alterado não tem texto visível | `logs/diff-src.txt`: `basisSync.ts` (comentário e `setConfirmed(null); return;`), `consistency.ts` (comentários; saem `multipleBases` e a regra da "leitura única"), `useIncomeEstimateWith.ts` (comentários; sai `multipleBases: needsExtra`) | Sem texto, componente ou estilo |
| Sem prova, tudo fica em reais | `WorkTimeContext.tsx:127-135`: só há `config` com a estimativa pronta e o modo tempo | Coerente: nenhum valor convertido fora da prova |
| Aviso do topo | `Header.tsx:529-546`; textos em `:534`, `:536` e `:537`; único botão, "Mostrar em R$" | Inalterado. `loading` dá "Calculando…"; `done`/`error` sem conversão dá "indisponível agora…" |
| Prévia carregando | `EstimateDetails.tsx:43-45`, `role="status"` | Inalterado |
| Prévia em erro ou "em atualização" | `EstimateDetails.tsx:46-52`, `role="alert"`, botão nativo "Tentar de novo" | Inalterado |
| Textos fixos | `messages.ts:82` (`ESTIMATE_UNCONFIRMED_FAILED`) e `:88` (`ESTIMATE_UPDATING`) | pt-BR, sem detalhe interno |
| Quando cada estado aparece | `consistency.ts:60-66`; `useIncomeEstimateWith.ts:350-366` (falha / sem prova), `:367` (`holdEstimate`), `:371-389` (30 s só trocam o texto) | Sem prova, "calculando"; escuta encerrada, erro fixo |
| Sem conexão | `reports/hooks.ts:87` e `:94` (`includeMetadataChanges`, `fromCache`); `basisSync.ts:511-517` (`setConfirmed(null)`). Na R3.1: `if (snapshot.fromCache) return;`, que mantinha a confirmação | O retorno só do cache local derruba a confirmação, em toda janela |
| Escuta encerrada | `basisSync.ts:539-550` (erro); `:520` (reabre com o retorno do servidor a outra escuta da mesma conta e do mesmo espaço); `:598-602` ("Tentar de novo") | O provedor do topo não tem botão. Reabre pela prévia |
| Caminho apontado pelo topo | `SettingsView.tsx:721-737`: cartão "Tempo de trabalho equivalente", com o mesmo ícone de relógio do aviso | Encontrável em dois cliques |
| Painel "Receitas consideradas" | `IncomeEditor.tsx:46` (data de referência só com `done`), `:145-148` (`status` / `alert`), `:128-131` ("Restaurar padrão"); contagem do assistente, `:202-204` | Depende do estado pronto (RR-R31-06) |
| "Valor em uso agora" | `WorkTimeSettingsView.tsx:446-450` | Some enquanto a estimativa em uso não converte (I-05 da R3.1) |

## 3. Estados que passam a aparecer em mais situações

Todos os textos abaixo já existiam na R3.1 e estão em pt-BR correto, sem termo técnico.

| Estado | Texto exato | Novas situações na R3.2 | Coerência | Ação | Papéis já existentes |
| --- | --- | --- | --- | --- | --- |
| Topo, esperando a prova | "Calculando a estimativa de tempo de trabalho: enquanto isso, os valores ficam em reais." | Cache aquecido antes do 1º retorno do servidor com uma base e sem desconsiderada; os primeiros 30 s sem conexão, em toda janela | Valores em reais (`[valores-b03-g-sem-conexao]`: `reais\|R$ 19.400,00`) | "Mostrar em R$" | `<p>` sem região viva (I-02 da R3.1) |
| Topo, indisponível | "Estimativa de tempo de trabalho indisponível agora: os valores continuam em reais. Veja o motivo em Configurações." | Sem conexão depois de 30 s; escuta encerrada com uma base, já no erro | Valores em reais (E2E `work-time-p5f.spec.ts:1250-1256`) | Aponta Configurações (seção 4) | Idem |
| Prévia, carregando | "Lendo as receitas oficiais e calculando..." | Remontagem com cache; sem conexão | Sem hora | — | `role="status"` |
| Prévia, em atualização | "A estimativa está em atualização: ainda não foi possível confirmá-la com os totais oficiais. Enquanto isso, os valores ficam em reais." | Sem conexão depois de 30 s; divergência persistente com uma base | Sem hora (B03-g: `hourly = []`) | "Tentar de novo"; sem conexão, sem efeito visível até ela voltar | `role="alert"`; axe sem violação em desktop e 375×812, e "Tentar de novo" pelo teclado (B03-b) |
| Prévia, escuta encerrada | "Não foi possível confirmar a estimativa com os totais oficiais. Tente de novo." | Uma base sem desconsiderada, se a escuta da própria prévia também falha | Sem hora | "Tentar de novo" reabre as escutas da conta e do espaço | Mesmo ramo do anterior |
| Painel e contagem | "Carregando as receitas do período..." / "A estimativa não carregou, então a lista ainda não pode ser montada. Feche e tente de novo." / "Não foi possível contar os lançamentos agora: a estimativa não carregou." | As mesmas da prévia | Sem lista nem contagem incoerente | Fechar e usar o "Tentar de novo" da prévia; "Restaurar padrão" funciona | `status` / `alert` |

## 4. Aviso do topo na escuta encerrada (pedido do coordenador)

- **Texto.** pt-BR claro, sem detalhe interno. Diz o estado (indisponível agora), a consequência (valores em reais) e onde ver o motivo.
- **Coerência.** O E2E afirma o aviso, nenhum `[data-work-time]`, o saldo em reais e nenhuma ressalva de leitura anterior (`work-time-p5f.spec.ts:1250-1256`). A conversão sai assim que a escuta é encerrada, sem esperar os 30 s (`useIncomeEstimateWith.ts:353, 364-367`).
- **Orientação.** O caminho é Configurações → "Tempo de trabalho equivalente". O cartão tem o mesmo ícone de relógio do aviso (`SettingsView.tsx:721-737`).
  - Seguir o aviso é o próprio caminho de recuperação. A escuta da prévia recebe o servidor e reabre a do topo, que não tem botão (`basisSync.ts:520`).
  - Se a causa já passou, a conversão volta também no topo. O E2E segue exatamente esse caminho: "a pessoa segue o aviso e abre Configurações", `:1257-1263`, 10,2 s, verde.
  - Se a causa continua, a prévia mostra o motivo de imediato ("Não foi possível confirmar…", com "Tentar de novo"), sem a espera de 30 s.
  - Precisão sobre a descrição do coordenador: a prévia só mostra esse erro quando a escuta dela também falha. Com a causa resolvida, ela vai direto à hora.
- **Limites (INFO, PT-R32-01).**
  - O aviso não tem link direto.
  - Não é região viva (I-02).
  - O mesmo texto cobre a falta de conexão, que volta sozinha, e a escuta encerrada, que só volta com a visita, o "Tentar de novo", uma recarga ou o retorno do servidor a outra escuta da mesma conta e do mesmo espaço. O texto não diferencia.
  - Nenhum desses limites induz a erro financeiro, porque os valores ficam em reais. Corrigi-los mudaria texto ou UI, fora do escopo mínimo.

## 5. Evidências de execução

| Comando / teste | Árvore | Resultado | Artefato |
| --- | --- | --- | --- |
| Unidade, tempo de trabalho: os 10 arquivos de `test:unit:work-time`, com `node --experimental-strip-types --test` | `ca11baca` (cópia) | 242/242, 0 skip, 0 todo | `logs/unit-work-time-ptbr.log` |
| Unidade, relatórios: os 7 arquivos de `test:unit:reports` | `ca11baca` | 107/107 | `logs/unit-reports-ptbr.log` |
| Unidade, UI: `icon-pack-props` e `messages-removal-guard` | `ca11baca` | 9/9 | `logs/unit-ui-ptbr.log` |
| `tsc --noEmit` da raiz (inclui `e2e/` e `tests/`) | `ca11baca` | Saída 0, 20,8 s | `logs/tsc-root-ptbr.log` |
| E2E B03-a a B03-f, executado pelo executor | `0f1b9320`: `src/` e B03-a a f iguais aos da final (`logs/diff-b03-0f1b-final.txt`) | 6/6 verdes. O B03-g falhou por asserção do próprio teste, corrigida depois | `e2e-b03-r32-1.log` |
| E2E B03-g, executado pelo executor | `059cec04`: `src/` e spec B03 iguais aos da final | Verde, 47,8 s | `e2e-b03g-r32-2.log` |
| E2E B03-g com o `src/` da R3.1 | `copia-r31-e2e` | Vermelho: "sem conexão, o saldo em reais" (a conversão ficou) | `e2e-b03g-na-r31-vermelho.log` |
| E2E `work-time-p5f.spec.ts`, 1ª execução do executor | `ca11baca` | Interrompida (exit 143). O 1º teste estourou o prazo (5,0 min), sem o erro no log | `e2e-p5f-r32-1.log` |
| E2E `work-time-p5f.spec.ts`, 2ª execução do executor | `ff1aa360`: `src/` e spec iguais aos da `ca11baca` | 19/19 verdes, saída 0, 4,0 min. Inclui o "escuta das projeções encerrada…" (10,2 s) e o "releitura que falha" (21,3 s) | `e2e-p5f-r32-2.log` |
| Registros `[valores-b03-*]` | — | Extraídos e analisados | `logs/registros-b03-g.txt`, `logs/registros-b03-r32-1.txt` |

O extrato dos E2E, com os SHA-256 dos logs, está em `logs/extrato-e2e.txt`.

**Sequência observada no B03-g.**
- Saldo: `tempo|≈ 776 h` → `reais|R$ 19.400,00` → `tempo|≈ 776 h`.
- Topo: "Valores em tempo…" → "Calculando…" → "indisponível agora…" → "Valores em tempo…".
- Prévia sem conexão: nenhuma hora, "em atualização" e "Tentar de novo".
- Com a conexão de volta: "R$ 25,00", sem recarregar nem tocar em botão.

**Como a evidência foi obtida.**
- Não rodei E2E, Emulator nem Playwright: portas em uso, conforme o COMUM.
- O juízo de execução se apoia nos 26 E2E de tempo de trabalho do executor (B03, 7; P5F, 19), em árvores com o mesmo `src/` e os mesmos specs da final.
- Os testes de unidade da R3.2 cobrem as transições no gancho: cache aquecido em 1, 3, 6 e 12 meses e mês corrente; prévia ao lado; religar; troca de fonte; sem conexão; queda de conexão; escuta encerrada; divergência persistente; estado indisponível (`work-time-consistency.test.ts:529, 1464-1651`).
- A prova vermelha dessa unidade com o `src/` da R3.1 tem 20 falhas em 85 (`red-r32-na-r31.log`).

## 6. Comparação antes/depois

| Situação | R3.1 | R3.2 | Evidência |
| --- | --- | --- | --- |
| Sem conexão com a estimativa convertida (uma base, sem desconsiderada) | A conversão fica | Reais. Topo "Calculando…" e depois "indisponível agora…". Prévia sem hora e depois "em atualização". A conversão volta sozinha | B03-g vermelho na R3.1 e verde na R3.2; unidade `:1588` |
| Sem conexão nas outras janelas ou com desconsiderada | A conversão continuava pela última confirmação, salvo com releitura pausada nas duas bases de 12 meses | Igual à linha acima | Código: `basisSync.ts:511-517` contra o `return` da R3.1 |
| Escuta encerrada (uma base, sem desconsiderada) | Conversão com a ressalva "…ela usa a leitura anterior. Tente de novo em Configurações." | Reais, com "indisponível agora…". Abrir Configurações reabre a escuta; se a causa continua, aparece o erro fixo | E2E P5F `:1230` (verde); unidade `:529` e `:1610` |
| Cache aquecido antes do retorno do servidor (prévia reaberta, religar, troca de fonte e volta) | Conversão imediata | "Calculando" até o retorno | Unidade `:1464-1569` |
| Divergência persistente (uma base) | Aceita depois de 2 releituras | "Em atualização", sem conversão | Unidade `:1627` |
| Releitura que falha com a escuta confirmada | Ressalva de leitura anterior | Igual | E2E P5F `:1038` (verde) |
| Modo dinheiro | Reais | Igual | Guarda "modo dinheiro idêntico" |

**Testes substituídos, vistos pela interface.** Nenhum foi enfraquecido.
- O E2E "escuta das projeções encerrada" trocou a ressalva, comportamento eliminado, pelo aviso "indisponível agora".
  - Passou a afirmar mais: nenhuma conversão, saldo em reais, ausência da ressalva, o texto "Valores em tempo…" depois da reabertura e o saldo convertido de novo.
  - A ressalva de leitura anterior continua coberta onde vale: "releitura que falha", `:1114` e `:1118`.
- A correção do B03-g afirma a mesma propriedade: nenhum valor convertido depois da queda. A gravação começa no saldo convertido de antes da queda.
- A guarda de `basisSync` ficou mais exigente: passa a exigir `setConfirmed(null)` no retorno do cache.
- As asserções removidas da unidade são as da "leitura única". Cada uma foi trocada pela do contrato novo (`logs/diff-consistency-test.txt`, `logs/diff-guard.txt`).

## 7. Redação proposta para o relatório (item 3 do pedido)

**Não há redação do executor a conferir.** A pasta `relatorio/` só tem o pedido, e o plano mestre não tem seção da R3.2. A descrição do PEDIDO desta revisão está correta, mas incompleta para o relatório em quatro pontos:
1. Sem conexão, a mudança vale para toda janela, com ou sem desconsiderada, e não só para uma base.
2. Os textos precisam ser citados literalmente. "Calculando" e "Estimativa em atualização" são paráfrases.
3. Na escuta encerrada, a conversão só volta com a visita a Configurações, o "Tentar de novo" ou uma recarga. O RR-R31-04 perde o primeiro caso.
4. O RR-R31-03 e o RR-R31-06 se ampliam.

Proponho:

> **Impactos conhecidos, sem mudança de interface (P5-F.1-R3.2).**
>
> **Espera pela confirmação do servidor (sincronização demorada).**
> - A estimativa só converte depois de um retorno do servidor à escuta das projeções mensais que confirme as bases. Vale para toda janela (1, 3, 6 ou 12 meses e mês atual), com uma base ou duas, com ou sem receita desconsiderada.
> - A base guardada no cache não converte sozinha. Isso vale para a prévia de Configurações aberta de novo, para o recurso desligado e religado e para a troca da fonte da renda e a volta.
> - Até esse retorno, os valores ficam em reais. O topo mostra "Calculando a estimativa de tempo de trabalho: enquanto isso, os valores ficam em reais."; a prévia de Configurações e a do assistente, "Lendo as receitas oficiais e calculando...".
> - Passados 30 s sem prova, só o texto muda; o prazo não aprova nada.
>   - O topo passa a "Estimativa de tempo de trabalho indisponível agora: os valores continuam em reais. Veja o motivo em Configurações."
>   - A prévia passa a "A estimativa está em atualização: ainda não foi possível confirmá-la com os totais oficiais. Enquanto isso, os valores ficam em reais.", com "Tentar de novo".
> - O topo e a prévia contam os 30 s separadamente. Logo depois de abrir Configurações, a prévia pode mostrar "Lendo as receitas oficiais e calculando..." por até 30 s, com o topo já em "indisponível agora".
> - Quando o retorno chega e confirma as bases, a conversão volta sozinha, sem recarregar e sem "Tentar de novo". A duração com rede real não foi medida.
> - Uma base que não alcança a projeção depois das releituras (anomalia no servidor) continua sem conversão, também com uma base e sem desconsiderada. Fica "em atualização" até uma releitura trazer a base certa (amplia o RR-R31-03).
>
> **Sem conexão.**
> - Quando o aplicativo passa a ler só do cache local, a confirmação anterior deixa de valer, e nenhuma estimativa converte. Na R3.1, a conversão continuava pela última confirmação.
> - Aparecem os mesmos textos da espera e, depois de 30 s, o "indisponível agora" no topo e o "em atualização" na prévia.
> - Os textos não dizem que a causa é a conexão. O "Tentar de novo" não tem efeito visível até ela voltar.
> - Com a conexão de volta, a conversão volta sozinha.
>
> **Escuta encerrada por erro (por exemplo, acesso perdido ao espaço da renda).**
> - Também com uma base e nenhuma desconsiderada, os valores ficam em reais, sem a ressalva de leitura anterior. O topo mostra, já na falha, "Estimativa de tempo de trabalho indisponível agora: os valores continuam em reais. Veja o motivo em Configurações."
> - Abrir Configurações reabre a escuta. Se a causa já passou, a conversão volta, no topo também. Se continua, a prévia mostra "Não foi possível confirmar a estimativa com os totais oficiais. Tente de novo.", com "Tentar de novo".
> - A escuta só reabre com essa visita, o "Tentar de novo", uma recarga ou o retorno do servidor a outra escuta da mesma conta e do mesmo espaço. Até lá, o topo continua em reais.
> - A ressalva "Não foi possível atualizar a estimativa com os lançamentos mais recentes: ela usa a leitura anterior. Tente de novo em Configurações." fica só para a releitura que falha com a escuta aberta e a base confirmada. O RR-R31-04 perde o caso da escuta encerrada.
>
> **Painel "Receitas consideradas" (RR-R31-06, sem mudança).**
> - O painel (Configurações e assistente) e a contagem do assistente só montam a lista com a estimativa pronta e confirmada, porque usam a data de referência dela.
> - Na R3.2, isso passa a valer também para uma base sem desconsiderada, antes do primeiro retorno do servidor e com a escuta encerrada, e, sem conexão, para toda janela.
> - Enquanto a estimativa espera, o painel mostra "Carregando as receitas do período..." e a contagem, "Contando os lançamentos de receita do período...".
> - Passados 30 s, ou com a escuta encerrada, o painel mostra "A estimativa não carregou, então a lista ainda não pode ser montada. Feche e tente de novo." e a contagem, "Não foi possível contar os lançamentos agora: a estimativa não carregou."
> - O "Tentar de novo" é o da prévia. Sem conexão, só resolve com a conexão de volta, e aí a lista volta sozinha.
> - "Restaurar padrão" e "Concluir" continuam funcionando. O "Valor em uso agora", em Configurações, some enquanto a estimativa em uso não converte.
> - Desacoplar o painel do estado pronto da estimativa continua fora do escopo (etapa própria).

**Base da frase "em toda janela, sem conexão".** Vem do código (`basisSync.ts:511-517` e `consistency.ts:65`). Os testes de sem conexão (unidade `:1569` e `:1588`, e o B03-g) usam a janela padrão sem desconsiderada; ver a seção 10.

## 8. Achados

Nenhum achado HIGH, MEDIUM ou LOW. A R3.2 não introduz defeito de interface. Os itens abaixo são INFO e não bloqueiam.

- **PT-R32-01 (INFO): o aviso do topo orienta, mas de forma indireta.**
  - Onde: `Header.tsx:536`, com `basisSync.ts:520, 598-602` e `SettingsView.tsx:721-737`.
  - Cenário: escuta encerrada com uma base, sem desconsiderada.
  - Impacto: quem não segue "Veja o motivo em Configurações" fica em reais, com valores corretos, até visitar a tela, tocar "Tentar de novo" ou recarregar. O mesmo texto vale para a falta de conexão, que se resolve sozinha.
  - Correção: nenhuma nesta etapa. Documentar (seção 7). Numa etapa própria, avaliar link direto e texto por causa.
- **PT-R32-02 (INFO): sem conexão, o motivo não cita a conexão.**
  - Onde: `messages.ts:88`, `EstimateDetails.tsx:46-52`, `useIncomeEstimateWith.ts:206-211, 389`, `basisSync.ts:511-517`.
  - Cenário: sem conexão, agora em toda janela e na configuração padrão (habitual, sem desconsiderada).
  - Impacto: o "Tentar de novo" não tem efeito visível até a conexão voltar. O texto genérico foi aceito na R3 (M-01) e é verdadeiro.
  - Correção: documentar. Numa etapa própria, avaliar o texto de conexão que já existe, "Sem conexão com a internet. Conecte-se e tente de novo." (`WorkTimeSettingsView.tsx:47`).
- **PT-R32-03 (INFO): continuam os itens I-02 a I-06 da revisão pt-BR da R3.1, agora mais frequentes.**
  - I-02: topo sem região viva. I-03: foco que cai no `body`. I-04: temporizadores independentes. I-05 e RR-R31-06: superfícies adjacentes. I-06: `role="alert"` no "em atualização".
  - Passam a ocorrer também na configuração padrão sem conexão, na escuta encerrada e na remontagem com cache.
  - Nenhum código mudou. Correção: registrar no relatório, como na R3.1.
- **PT-R32-04 (INFO, documentação): o relatório da R3.2 ainda não existe.**
  - Impacto: o item "documentar os impactos" do pedido fica pendente até o relatório.
  - Correção: usar a redação da seção 7, ou outra equivalente, e atualizar o RR-R31-03, o RR-R31-04 e o RR-R31-06.
- **PT-R32-05 (INFO, evidência; para a revisão de estabilidade): a 1ª execução do `work-time-p5f.spec.ts` na `ca11baca` estourou o prazo.**
  - O 1º teste ("desativado por padrão; assistente…", `:265`) estourou os 300 s, e a execução foi interrompida (exit 143), sem o erro no log.
  - O mesmo teste levou de 11 a 16 s nas execuções da R3.1 e 24,9 s na reexecução verde (`ff1aa360`, mesmo `src/` e mesmo spec).
  - Nenhum elemento da R3.2 explica uma espera de 300 s nesse teste. A navegação do assistente não depende da estimativa (`WorkTimeWizard.tsx:223-240`), e as esperas pela estimativa têm prazos de 30 s.
  - Minhas execuções (unidade e `tsc`, com `nice 19`, das 13:53:33 às 13:55:24) só coincidiram com os últimos ~30 s do teste, que já rodava havia mais de 4 min.
  - Impacto: nenhum no juízo de UI, porque a reexecução com código e spec idênticos passou 19/19. A causa precisa ser esclarecida pela revisão de estabilidade, para a reexecução não esconder uma falha intermitente.

## 9. Riscos residuais

- A acessibilidade e o celular do aviso do topo nos estados "Calculando…" e "indisponível agora" não passaram por axe nem por captura nesta etapa, como na R3.1. O `Header` está inalterado e os três textos já existiam. Mitigação: o B03-b cobre o ramo da prévia, com axe em desktop e 375×812 e teclado.
- A duração do "calculando" com rede real não foi medida (seção 7).
- Sem conexão, a falta de causa no texto e o "Tentar de novo" sem efeito (PT-R32-02) agora atingem a configuração mais comum.

## 10. O que não foi possível verificar

- **Inspeção interativa.** Não usei `playwright-cli`, capturas antes/depois nem leitor de tela real: portas em uso e proibição do COMUM. Como o diff não tem mudança de UI, as asserções E2E e o B03-b bastam para o juízo. Não peço execução adicional como condição.
- **`verify:all` oficial.** Não havia resultado na árvore final durante a revisão. O `verify-all-r32-1` (`6d28cf98`) foi interrompido aos 136 s, ainda no `functions:build` do `verify:fast`, antes da integração e do E2E.
- **Sem conexão fora da janela padrão.** Não há teste de unidade nem E2E sem conexão na janela de 12 meses ou com desconsiderada. A afirmação "em toda janela" vem do código (seção 7). Isso fica para as revisões financeira e adversarial, se quiserem a prova executável.
- **Redação do executor.** Não existe ainda (PT-R32-04).

## 11. Bloqueadores para PASS

Nenhum.

## 12. Comandos executados

- `git -C <worktree> diff --stat|--name-status --no-renames` entre `efcbd264`, `6d28cf98`, `ca11baca`, `ff1aa360`, `0f1b9320` e `059cec04`, e `git rev-parse <árvore>:<caminho>`, com `GIT_OPTIONAL_LOCKS=0`. Saídas: `logs/diff-escopo-ui.txt`, `logs/diff-src.txt`, `logs/diff-e2e.txt`, `logs/diff-e2e-p5f.txt`, `logs/diff-guard.txt`, `logs/diff-consistency-test.txt`, `logs/diff-b03-0f1b-final.txt`, `logs/diff-ff1aa360.txt`, `logs/arvore-ca11baca.txt`, `logs/arvore-ff1aa360.txt`, `logs/arvores-intermediarias-e2e.txt`.
- Cópias por `git archive` (`copia`, `copia-ca11`, `copia-r31`) e `diff -rq` contra o worktree: `logs/diff-copia-vs-wt.txt`, `logs/copia-ca11-verificacao.txt`.
- Unidade e `tsc` na cópia `ca11baca`, com `nice -n 19`: `logs/unit-*-ptbr.log`, `logs/tsc-root-ptbr.log` e `.time`.
- Extração dos registros e resultados E2E do executor: `logs/registros-b03-g.txt`, `logs/registros-b03-r32-1.txt`, `logs/extrato-e2e.txt`.
- No início rodei um `git status --short` no worktree. O índice manteve o mtime de 11:47:49: não houve escrita.
