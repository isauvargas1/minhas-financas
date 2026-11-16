PASS — revisão de UI de produto em PT-BR

# P5-F.1-R3.2 — revisão independente de produto e interface em pt-BR, rodada 3 (`ptbr-product-ui-review`)

Revisão feita sobre o código real da árvore `ef514869087c2b9e8e910a25fc7c18174418b8bb`, em duas partes: 2026-11-11, das 18:36 às 18:58 (UTC), e 2026-11-13, a partir das 23:15. A interrupção entre elas foi o limite de uso da API. Não alterei o worktree nem o índice do git. Não rodei Emulator, Playwright, E2E, `verify:*` nem `test:integration*`. Tudo o que rodei foi com `nice -n 19`, um comando de cada vez, numa cópia própria feita por `git archive`.

- Pasta: `<scratchpad>/p5f1r32/revisoes/ptbr/rodada-3`. Os arquivos citados como `logs/…` e `testes-revisor/…` ficam nela.
- Os logs do executor ficam em `<scratchpad>/p5f1r32/logs/`.
- Os números de linha são os da árvore `ef514869`.

## 1. Escopo conferido

- **Requisito.** Pedido do usuário (`relatorio/pedido-r32.md`); o meu pedido (`ptbr/PEDIDO.md`); o COMUM-R3 e os quatro pontos desta rodada: o que o usuário vê com o F-08, a redação da seção K, nenhuma mudança de interface e o PT-R32-06 a 08.
- **Árvores.**
  - R3.1: `efcbd264`.
  - Rodada 2: `9fddcb5a`.
  - Sob revisão: `ef514869`.
  - A minha cópia é idêntica ao worktree, fora `docs/` e os artefatos não versionados. O `diff -rq` não deu diferença nenhuma, em 11/11 e de novo em 13/11 (`logs/copia-vs-worktree.txt`, `logs/copia-vs-worktree-2.txt`).
- **Índice do git.** Intocado: mtime 11:47:49 de 11/11 e HEAD `1730a1df`, no começo e no fim.
- **O que mudou desde a rodada 2** (`logs/diff-stat.txt`):
  - em `src/`, só `consistency.ts` (comentários) e `useIncomeEstimateWith.ts`, com `carriesBasisFigures` (`:114-115`), a expressão do `holdEstimate` (`:141`) e comentários (`logs/diff-src-r2-final.patch`);
  - no E2E, dois `console.log` e um comentário (`logs/diff-e2e-r2-final.patch`);
  - o resto são testes, ferramentas e o RB-04.
- **Telas e fluxos.**
  - O aviso do topo (`Header`).
  - Configurações → Tempo de trabalho equivalente: a prévia, "Nada foi salvo ainda." e "Valor em uso agora", a memória de cálculo ("Como este valor foi calculado?") e o painel "Receitas consideradas".
  - O assistente: a prévia, a contagem e o painel.
- **Classificação.** Não há alteração de UI. O F-08 só muda quando um estado que já existia aparece. A mudança é requerida pelo critério do pedido ("nenhuma conversão sem comprovação financeira válida") e pelo F-08 (MEDIUM) da revisão financeira.

## 2. Nenhuma mudança de interface

| Critério | Evidência | Conclusão |
| --- | --- | --- |
| Componentes | `git rev-parse <árvore>:src/components`: `1b846c67` em `efcbd264`, `9fddcb5a` e `ef514869` (`logs/escopo-ui.txt`) | Idênticos |
| Textos do módulo | `src/modules/work-time/messages.ts`: `07d7de2f` nas três | Idênticos |
| Estilos, layout e navegação | `src/index.css`, `index.html`, `index.tsx`, `src/App.tsx`, `src/contexts`, `tailwind.config.js` e `postcss.config.js`: mesmo hash nas três. Não existem `src/pages`, `src/styles`, `public/` nem i18n | Inalterados |
| Arquivos de UI alterados | Filtro de `.tsx`, `.jsx`, `.css`, `.html`, `.svg`, `public/`, `messages`, i18n, `tailwind` e `postcss` desde a R3.1 e desde a rodada 2: "(nenhum)". O `git diff --stat` desses caminhos sai vazio | Nada |
| Componentes e módulos que decidem cada texto da tela | `EstimateDetails.tsx`, `IncomeEditor.tsx`, `ui.tsx`, `Header.tsx`, `WorkTimeSettingsView.tsx`, `WorkTimeWizard.tsx`, `WorkTimeContext.tsx`, `estimate.ts`, `incomeBasis.ts`, `draft.ts`, `calendar.ts`, `messages.ts` e `useIncomeEstimate.ts`: hashes iguais aos da R3.1 (`logs/hash-memoria-calculo.txt`) | Inalterados |
| Literais novos visíveis | O código novo de `src/` é `estimate.status === 'ready' \|\| estimate.months.length > 0` e a troca de condição no `holdEstimate`. Os únicos literais são identificadores internos | Nenhum texto novo |
| pt-BR | Cada texto que pode aparecer nos estados afetados foi renderizado com o React real (seção 3). Todos estão em pt-BR correto, sem termo técnico, código de erro nem texto do SDK | Atende |

## 3. O que o usuário vê com o F-08

### 3.1 Os três tipos de estimativa

- **Pronta**: a que converte.
- **Com números**, que espera a prova como a pronta (`carriesBasisFigures`, `useIncomeEstimateWith.ts:114-115`). São `no_income`, `no_work_minutes`, `income_too_low`, `income_too_high`, `work_minutes_too_high` e `hourly_rate_too_low`. Sempre trazem `months` preenchido: a janela não é vazia, e esses motivos saem depois de montar a base (`estimate.ts:183-228`).
- **Sem números**, que aparece como está. São `business_not_confirmed`, `report_unavailable`, `exclusion_unconfirmed`, `ambiguous_routines` e `ambiguous_reduced_eve`, todos com a base vazia (`estimate.ts:146-157, 160, 165, 170, 191`). A tabela-verdade cobre os 11 motivos de `UNAVAILABLE_REASON_TEXT` (`work-time-income-estimate.test.ts:164`).

### 3.2 Os textos literais, como renderizados

Renderizei com o React real e `renderToStaticMarkup` (`testes-revisor/render-probe.tsx`; saída em `logs/render-probe.txt`). As estimativas vêm de `computeWorkTimeEstimate`, e os estados sem prova vêm do `holdEstimate` real.

**Prévia** (Configurações e assistente, `EstimateSummary`):
- **P1**: "Lendo as receitas oficiais e calculando..." (`role="status"`).
- **P2**: "A estimativa está em atualização: ainda não foi possível confirmá-la com os totais oficiais. Enquanto isso, os valores ficam em reais." + botão "Tentar de novo" (`role="alert"`).
- **P3**: "Não foi possível confirmar a estimativa com os totais oficiais. Tente de novo." + botão "Tentar de novo" (`role="alert"`).
- **P4**: "Estimativa indisponível. <motivo>", com "Fonte:", "Modo:", "Período:" (este só com números) e "Como este valor foi calculado?". No relatório sem bloco exato, vem também "Tentar de novo".
- **P5**: P4 + "Não foi possível atualizar a estimativa com os lançamentos mais recentes agora. Ela usa a última leitura." + botão "Tentar de novo" (`role="status"`).
- **P6**: o valor da hora e "Uma compra de R$ 150,00 equivale a … de trabalho.".
- Com a memória de cálculo aberta durante P1 a P3: "A estimativa ainda não está pronta.", mais a mensagem de P2 ou P3. Os números somem do diálogo aberto quando a prova cai.

**Aviso do topo** (estimativa em uso, `Header.tsx:529-546`), sempre com "Mostrar em R$":
- **T1**: "Calculando a estimativa de tempo de trabalho: enquanto isso, os valores ficam em reais."
- **T2**: "Estimativa de tempo de trabalho indisponível agora: os valores continuam em reais. Veja o motivo em Configurações."
- **T3**: "Valores em tempo de trabalho equivalente: uma estimativa aproximada, não o valor exato.", com as ressalvas.

**Painel "Receitas consideradas" e contagem do assistente** (`IncomeEditor.tsx:108-111, 145-163, 200-209`):
- **L1**: "Carregando as receitas do período..." (`status`). Contagem: "Contando os lançamentos de receita do período...".
- **L2**: "A estimativa não carregou, então a lista ainda não pode ser montada. Feche e tente de novo." (`alert`). Contagem: "Não foi possível contar os lançamentos agora: a estimativa não carregou."
- **L3**: a lista, com "Confere com o relatório oficial: R$ …" (ou "A lista soma … e o relatório oficial, …") em cada mês. Contagem: "N lançamentos de receita considerados…".
- **L4**: a lista sem a linha de conferência dos meses, porque `official` vem vazio da estimativa sem números (`:108-111`; `incomeBasis.ts:312-327`). Sem conexão e com a lista ainda não lida na sessão, a leitura fica pausada, sem erro: só os textos fixos, e a contagem fica em "Contando…". Isso vem do código e do meu teste do React Query da rodada 2, sem E2E.

### 3.3 Situação × tipo × texto

| Situação | Pronta | Com números (F-08) | Sem números | Topo (estimativa em uso) | Painel e contagem | Evidência |
| --- | --- | --- | --- | --- | --- | --- |
| Cache aquecido antes do 1º retorno do servidor; volta à tela; prévia ao lado | P1 → (30 s) P2 → P6 com o retorno | P1 → (30 s) P2 → P4 com os números confirmados | P4 de imediato. Exceção: com desconsiderada e sem a leitura por id no cache, P1 sem prazo até o 1º retorno (ADV-R2-06) | Pronta: T1 → T2 → T3. Com números: T1 → T2 → T2. Sem números: T2 | Pronta e com números: L1 → L2 → L3. Sem números: L4 | Unidade `:1488-1552` e `:2100-2124`. Sondas (1), nas 9 combinações de janela × desconsiderada, e (5) |
| Religar | Como acima | Como acima | Como acima | Como acima | Como acima | Unidade `:1554`; sonda (2a) |
| Troca do espaço da renda e volta | Como acima, sem estado do outro | Como acima | P4 de imediato | Como acima | Como acima | Unidade `:1573`; sonda (2b); E2E ADV-01 (troca para PJ no rascunho) |
| Sem conexão depois da confirmação | P1 → (30 s) P2; P6 volta sozinha | P1 → (30 s) P2; P4 volta sozinha | P4, sem a ressalva | Pronta e com números: T1 → T2 → T3 ou T2 na volta. Sem números: T2 | Pronta e com números: L1 → L2. Sem números: L4 | Unidade `:1594-1634`, `:2001-2031`, `:1837-1871` e `:1765-1796`; E2E B03-g e ADV-01 (seção 6); testes 2 e 4 da rodada 2 |
| Sem conexão desde a abertura, sem cache | P1, sem a troca de texto | P1 | P1 | T1 | L1 | Código: `waitingProof` exige `done` (`:393`) |
| Escuta encerrada | P3 de imediato; não vira P2 (ADV-R2-07) | P3 de imediato | P5 | T2 de imediato | Pronta e com números: L2. Sem números: L4 | Unidade `:1635`, `:1981`, `:1805-1835`, `:1837-1871` e `:1741-1796`; E2E P5F `:1230`; sonda (6); testes 1 e 3 da rodada 2 |
| Escuta encerrada antes do 1º retorno, com desconsiderada | P3 | P3 | P3 (a estimativa nem é calculada) | T2 | L2 | `:382-385` (`blockedByListen`); sonda (4) |
| Divergência persistente depois das releituras | P1 → P2; com a anomalia corrigida, o "Tentar de novo" traz P6 | P1 → P2 | P4 | Pronta e com números: T1 → T2. Sem números: T2 | Pronta e com números: L1 → L2. Sem números: L4 | Unidade `:1652`, `:2032`, `:1805-1835` (com a sonda R2-02) e `:1741-1796` |
| Sincronização em curso (a projeção mudou, por exemplo uma receita nova) | P1 breve → P6 nova | O motivo anterior sai na hora: P1 → o estado novo | P4 continua | T1 breve | L1 breve | Sonda (3): "nenhuma renda" → `calculando → hora(352000)`. Na rodada 2, o motivo antigo ficava na tela |
| Janelas de 1, 3, 6 e 12 meses e mês corrente, com e sem desconsiderada | As mesmas regras | As mesmas regras | As mesmas regras | — | — | Unidade `:2100-2124`; sonda (1), 9 combinações; unidade `:1765` (3 meses sem desconsiderada e 12 com) |
| Volta à conversão | P6 sozinha, sem recarregar nem tocar em "Tentar de novo". Com a escuta encerrada, depois da reabertura | P4 com os números confirmados | — | T3 | L3 | Fim de cada teste acima; B03-g e P5F na execução oficial |

Em todas as linhas, nada converte sem a prova, e nenhum número das bases aparece sem ela. Os valores ficam em reais (`WorkTimeContext.tsx:127-135`: a `config` só existe com `ready`).

### 3.4 Coerência, ação e acessibilidade

- **Coerência.**
  - Cada texto diz o que acontece. P1 e T1 dizem que está calculando, com os valores em reais; P2 diz que a estimativa ainda não foi confirmada; P3, que não foi possível confirmar; T2, que a estimativa está indisponível agora.
  - Nenhum desses estados mostra hora, conversão ou número das bases. A prova está no log oficial (`[valores-b03-g-sem-conexao]`: saldo `reais|R$ 19.400,00`, `hourly: []`) e nas sondas (`noFiguresR3`).
  - Com o F-08 deixa de aparecer o "Não há receitas efetivadas…" de um estado misto, porque o motivo da última leitura sai assim que a projeção muda (sonda 3).
- **Ação.** P2, P3 e P5 têm "Tentar de novo" (`<button>` nativo). O topo aponta Configurações, onde fica esse botão. Sem conexão, o botão não tem efeito visível até a conexão voltar (PT-R32-02).
- **Acessibilidade.** Os papéis são os da R3.1: `status` para P1, P5 e L1; `alert` para P2, P3 e L2.
  - O B03-b (axe em desktop e em 375×812, mais o teclado) cobre o ramo `alert` e passou na execução oficial (linha 57110 do log).
  - Com o F-08, as trocas de `status` para `alert` voltam a ocorrer também na indisponível com números (PT-R32-03, I-06).

## 4. Achados das rodadas 1 e 2: situação

- **PT-R32-01 (INFO): o aviso do topo orienta de forma indireta. Aberto, para documentar** (item 5 da seção K).
  - Com o F-08, na indisponível com números sem a prova, "Veja o motivo em Configurações" leva a P1, P2 ou P3, e não ao motivo. O motivo aparece com a confirmação.
- **PT-R32-02 (INFO): sem conexão, o texto não cita a conexão. Aberto, para documentar** (item 3).
  - Agora vale também para a indisponível com números: sem conexão, ela mostra P2 no lugar do motivo.
- **PT-R32-03 (INFO): os itens I-02 a I-06 da R3.1. Aberto, para documentar.**
  - Com o F-08, voltam a valer para a indisponível com números, como na rodada 1.
- **PT-R32-04 (INFO): o relatório ainda não traz os impactos. Aberto.**
  - A seção K continua `XXX` (`RELATORIO-P5F1-R32.md:86-88`, versão de 18:50:38 de 11/11, sem mudança desde então).
  - Usar a redação da seção 8 deste parecer, que substitui a da rodada 2.
- **PT-R32-05.** Fechado na rodada 2.
- **PT-R32-06 (INFO): com alterações não salvas, o topo leva ao motivo do rascunho. A resposta basta.**
  - O caso está documentado no RR-R31-04 do relatório (`:110`) e do plano (`plano-20-20.md:80`) e entra no item 5 da seção K.
  - O caso do E2E (rascunho PJ, sem números) não muda com o F-08. Com um rascunho com números, a prévia mostra P1, P2 ou P3, e não um motivo que possa ser confundido.
- **PT-R32-07 (LOW, documentação): fechado no que pedia.**
  - A linha da escuta encerrada, a coluna da R3.1, a espera "não medida", os textos literais e as contagens estão corrigidos (matriz, linhas 5, 6 e 11; relatório, §C e §F, linha 51).
  - O que ainda não acompanha o F-08 é o PT-R3-02.
- **PT-R32-08 (INFO): as três partes estão atendidas.**
  - **(a) Fechado.** Os testes do estado indisponível afirmam a ressalva só com a escuta encerrada, e não sem conexão (`work-time-consistency.test.ts:1760, 1793`). Passaram na minha execução, 278/278.
  - **(b) Fechado.** O `console.log` está em `work-time-p5f.spec.ts:1337, 1348`, e as duas linhas estão no log da execução oficial (`verify-all-r32-4.log:60630-60631`; extrato em `logs/estados-adv-01-oficial.txt`).
    - A prévia mostra um único estado do começo ao fim: `indisponivel|Estimativa indisponível. A fonte escolhida é um espaço PJ. Confirme que quer usar a receita empresarial, ou escolha um espaço PF.`
    - O topo segue T3 → T1 → T2 sem conexão e volta a T3 com a conexão.
    - É exatamente o que o título do teste afirma. A sequência inteira mostra também que a estimativa em uso passou por "Calculando…" antes de "indisponível agora".
  - **(c) Aceitável como risco de cobertura (RR-R32-09).**
    - Os ramos de tela desses estados são os mesmos componentes e papéis que o E2E já exercita: P1 e P2 sem conexão no B03-g; P3 e T2 na escuta encerrada do P5F; P4 sem conexão no ADV-01; o ramo `alert` com axe no B03-b.
    - O que é próprio da indisponível com números é a classificação (`carriesBasisFigures`), que não passa pelo SDK. Ela está fixada pela tabela-verdade, pelos 29 testes do gancho, pela guarda (`work-time-guard.test.ts:470-471`) e pelos mutantes N17, N18, N21 e N22 (execução 50).
    - Sem E2E nem axe ficam a combinação P5 (motivo + ressalva) e o topo direto em T2 com a estimativa em uso sem números (seção 10).

## 5. Evidências de execução

| Comando / teste | Árvore ou cópia | Resultado | Log |
| --- | --- | --- | --- |
| Unidade: os 10 arquivos de `test:unit:work-time`, `--test-concurrency=1` | Cópia `ef514869` | 278/278, 0 skip, 0 todo, 100 s. Inclui os 29 testes "o estado indisponível" (115 a 143) e a tabela-verdade (214) | `logs/unit-work-time-ptbr-r3.log` |
| Unidade: os 7 arquivos de `test:unit:reports` | Idem | 107/107 | `logs/unit-reports-ptbr-r3.log` |
| Unidade, UI: `icon-pack-props` e `messages-removal-guard` | Idem | 9/9 | `logs/unit-ui-ptbr-r3.log` |
| `tsc --noEmit` da raiz, com `e2e/` e `tests/` | Cópia limpa, sem as minhas sondas | Saída 0, 25 s | `logs/tsc-root-ptbr-r3.log` |
| Sondas do revisor, rodada 3 (18), no gancho real com o React Query e o mundo simulado do projeto | Cópia `ef514869` | 18/18, 14 s. Sequências nas linhas `[revisor-ptbr-r3]` | `logs/revisor-ptbr-r3-gancho.log` |
| Os 6 testes do revisor da rodada 2, sem mudança | Cópia `ef514869` | 1/6. Reprovam os 5 casos com números, onde o F-08 mudou de propósito: escuta encerrada → P3; sem conexão → P1 → P2; releitura demorada → P1. Passa o caso sem mudança (desconsiderada com a escuta recusada) | `logs/revisor-ptbr-r2-na-final.log` |
| Renderização da prévia e da memória de cálculo (React real, `renderToStaticMarkup`), 11 estados | Cópia `ef514869`, empacotada com esbuild | Textos e papéis da seção 3.2; base do PT-R3-01 | `logs/render-probe.txt`, `logs/render-probe-build.log` |
| `verify:all` oficial `verify-all-r32-4` (executado pelo executor) | `ef514869`, a mesma no fim | Saída 0, 3095 s; E2E 218/218 (83 + 64 + 71), 0 falhas; os 27 E2E de tempo de trabalho verdes (B03-a a g; P5F, 20, com o ADV-01 em 37,7 s) | `logs/extrato-e2e-oficial.txt`, `logs/estados-adv-01-oficial.txt`; SHA-256 do log: `f2f1a3e18a18bfbbae0a4db50373f734ba36693b7cc89dc37f7879693a520b77` |

Os SHA-256 das sondas e do arquivo de testes do projeto estão em `logs/testes-revisor-sha256.txt`. As sondas montadas ficam em `testes-revisor/montados/`. Saíram da cópia antes do `tsc`.

## 6. Comparação antes e depois

- **Pronta.** Igual à rodada 2: espera a prova e o fim da sincronização em toda janela.
- **Com números.** Muda da rodada 2 para a final: esperava nada e agora espera como a pronta.
  - Escuta encerrada: o motivo com a ressalva vira P3.
  - Sem conexão: o motivo vira P1 → P2.
  - Releitura demorada: o motivo antigo vira P1.
  - A prova é a mesma bateria de testes nas duas árvores (`logs/revisor-ptbr-r2-na-final.log` contra `rodada-2/logs/revisor-ptbr-r2-gancho.log`).
  - Diante da R3.1:
    - sem conexão, na R3.1 o motivo aparecia, porque a confirmação anterior continuava valendo; agora aparece P2;
    - com uma base e a escuta encerrada, na R3.1 aparecia o motivo com a ressalva, pela leitura única; agora aparece P3;
    - durante a sincronização, na R3.1 aparecia "calculando", como agora.
  - Não há regressão de correção: o motivo e os números só aparecem confirmados.
  - A perda de informação acionável sem a prova é o PT-R3-03.
- **Sem números.** Igual à rodada 2: aparece como está, com a ressalva só com a escuta encerrada.
- **Inesperado.** Nenhuma regressão de interface.
  - O PT-R3-01 é anterior: os mesmos textos já apareciam na R3.1, com a prova, porque os arquivos são idênticos.
  - Com o ADV-01 mantido, eles aparecem também nas condições sem prova que envolvem desconsiderada: escuta encerrada, divergência e volta à tela com a leitura por id no cache.
- **Testes substituídos, vistos pela interface.** Nenhum foi enfraquecido.
  - A guarda exige duas expressões no lugar de uma (`work-time-guard.test.ts:470-471`).
  - A tabela-verdade passou de 6 motivos a todos os 11, com a classificação conferida contra `UNAVAILABLE_REASON_TEXT`.
  - As asserções removidas do bloco do ADV-01 (`assertOnlyUnavailable` para a rotina sem horas) foram trocadas por `assertNoFigures` e pela mensagem exata de P2 ou P3, mais a volta do motivo com a prova (`logs/diff-consistency-r2-final.patch`, `logs/diff-guard-income-r2-final.patch`).

## 7. Rascunhos do executor depois do F-08

Lidos na versão atual: relatório de 11/11 às 18:50:38; matriz às 18:37:28; plano (§20.20) às 18:36:34. Nenhum mudou até 13/11, às 23:15.

- **Corretos:**
  - relatório §C (`:22-23`) e a linha 51 do §F;
  - RR-R32-01, RR-R32-09 e RR-R31-04 no §M (`:100, 108, 110`);
  - matriz, linhas 5, 6, 11 e 17;
  - plano, `:64-69` e `:80-81`.
- **Ainda inexatos depois do F-08:** os itens do PT-R3-02 (seção 9).

## 8. Redação final da seção K, para o relatório

Substitui a da rodada 2. Os textos estão citados literalmente.

> **K. Impactos conhecidos, sem mudança de interface (P5-F.1-R3.2)**
>
> Nenhum texto, componente, estilo, layout ou navegação mudou; muda só quando cada estado que já existia aparece. Nenhum valor é convertido, e nenhum número das bases aparece, sem a confirmação do servidor. Enquanto ela falta, os valores ficam em reais.
>
> Há três tipos de estimativa:
> - **a que converte**, com o valor da hora;
> - **a indisponível com números**: a memória de cálculo traz meses, receitas, desconsideradas e totais. São os motivos "Não há receitas efetivadas nos meses considerados. Assim que houver, a estimativa aparece.", "A jornada configurada não tem horas nos meses considerados. Revise a rotina e as exceções." e os limites de renda, de horas e de valor da hora;
> - **a indisponível sem números**: o motivo sai antes de qualquer receita. São "A fonte escolhida é um espaço PJ. Confirme que quer usar a receita empresarial, ou escolha um espaço PF.", "O relatório oficial deste espaço ainda não está disponível para os meses do cálculo. Tente de novo em instantes.", o recebimento desconsiderado sem a confirmação do estorno e as rotinas ou a véspera reduzida sem cálculo seguro.
>
> **1. A que converte e a indisponível com números esperam a confirmação do servidor (sincronização demorada)**
> - Só aparecem depois que um retorno do servidor à escuta das projeções mensais confirma as bases, e com a sincronização concluída. Vale para toda janela (1, 3, 6 ou 12 meses e mês atual), com uma base ou duas, com ou sem receita desconsiderada.
> - A base guardada no cache não basta. Isso vale para a prévia de Configurações aberta de novo, para o recurso desligado e religado e para a troca da fonte da renda e a volta.
> - Até esse retorno, o topo mostra "Calculando a estimativa de tempo de trabalho: enquanto isso, os valores ficam em reais." A prévia de Configurações e a do assistente mostram "Lendo as receitas oficiais e calculando...".
> - Passados 30 s sem a confirmação, só o texto muda; o prazo não aprova nada.
>   - O topo passa a "Estimativa de tempo de trabalho indisponível agora: os valores continuam em reais. Veja o motivo em Configurações."
>   - A prévia passa a "A estimativa está em atualização: ainda não foi possível confirmá-la com os totais oficiais. Enquanto isso, os valores ficam em reais.", com "Tentar de novo".
> - Os 30 s só contam depois que a estimativa foi calculada. Enquanto as leituras não terminam, fica "calculando", sem a troca de texto. Isso acontece, por exemplo, sem conexão desde a abertura do aplicativo ou com receita desconsiderada antes do primeiro retorno do servidor.
> - O topo e a prévia contam os 30 s separadamente. Logo depois de abrir Configurações, a prévia pode mostrar "Lendo as receitas oficiais e calculando..." por até 30 s, com o topo já em "indisponível agora".
> - Quando o retorno chega e confirma as bases, a conversão volta sozinha, sem recarregar e sem "Tentar de novo". Na indisponível com números, volta o motivo, com os números confirmados. A duração da espera com rede real não foi medida.
> - Uma base que não alcança a projeção depois das releituras (anomalia no servidor) não converte nem mostra números, também com uma base e sem desconsiderada. Fica "em atualização" até uma releitura trazer a base certa (amplia o RR-R31-03).
> - Na indisponível com números, o motivo também espera. Sem a confirmação, a pessoa vê "calculando", "em atualização" ou o erro, e não, por exemplo, "A jornada configurada não tem horas nos meses considerados. Revise a rotina e as exceções.".
> - Quando uma receita nova muda a projeção, o motivo anterior ("Não há receitas efetivadas…") sai na hora e dá lugar a "calculando" até a estimativa nova, confirmada.
>
> **2. A indisponível sem números aparece com o motivo, sem esperar (ADV-01)**
> - A prévia mostra "Estimativa indisponível." com o motivo, sem esperar a confirmação do servidor. Vale também sem conexão, com a escuta encerrada, com a divergência persistente e durante a sincronização. Nada converte, e os valores ficam em reais.
> - O topo mostra desde o começo "Estimativa de tempo de trabalho indisponível agora: os valores continuam em reais. Veja o motivo em Configurações.", sem passar por "Calculando…".
> - O motivo é o da última leitura. Sem conexão, o texto não diz que a conexão caiu nem que o motivo pode ter mudado em outro dispositivo. Com a conexão de volta, a estimativa se atualiza sozinha.
> - Com a escuta encerrada, ou com uma releitura que falha, a prévia mostra junto do motivo "Não foi possível atualizar a estimativa com os lançamentos mais recentes agora. Ela usa a última leitura.", com "Tentar de novo". O topo não mostra essa ressalva.
> - Com receita desconsiderada, a estimativa só é calculada depois do primeiro retorno do servidor, ou com a leitura das desconsideradas já feita na sessão. Antes disso, aparece "Lendo as receitas oficiais e calculando...", sem prazo. Com a escuta encerrada antes do primeiro retorno, aparece "Não foi possível confirmar a estimativa com os totais oficiais. Tente de novo.", até a escuta reabrir (ADV-R2-06, como na R3.1).
> - Se a pessoa resolve o motivo com a escuta encerrada (por exemplo, confirma a receita PJ), a estimativa que resulta segue o item 1. Só converte com a confirmação, e até lá a prévia mostra "Não foi possível confirmar a estimativa com os totais oficiais. Tente de novo.".
> - **Limitação anterior à R3.2 (PT-R3-01).**
>   - A memória de cálculo ("Como este valor foi calculado?") dessa indisponível diz "Você não desconsiderou nenhuma receita.", "Feriados que tiraram dias de trabalho: nenhum." e "Férias, folgas e exceções: nenhuma no período." mesmo quando há desconsiderada, feriado ou exceção na janela.
>   - Isso vale até quando o motivo é a própria desconsiderada ou a jornada reduzida.
>   - Não afeta nenhum valor, e o painel "Receitas consideradas" mostra o que foi desconsiderado. A correção fica para uma etapa própria.
> - Na R3.1, toda indisponível esperava a prova:
>   - sem conexão, o motivo aparecia, porque a confirmação anterior continuava valendo;
>   - durante a sincronização, ele dava lugar a "calculando";
>   - com a escuta encerrada em 12 meses ou com desconsiderada, dava lugar a "Não foi possível confirmar…".
>
> **3. Sem conexão**
> - Quando o aplicativo passa a ler só do cache local, a confirmação anterior deixa de valer: nada converte, e a indisponível com números não aparece. Na R3.1, a conversão continuava pela última confirmação.
> - A que converte e a indisponível com números seguem o item 1; a sem números, o item 2.
> - Os textos não dizem que a causa é a conexão. As leituras ficam pausadas, sem erro. O "Tentar de novo" não tem efeito visível até a conexão voltar, e a ressalva de leitura anterior não aparece só pela queda.
> - Com a conexão de volta, tudo volta sozinho.
> - Numa queda que o navegador não detecta, a confirmação anterior vale até o SDK passar a servir só do cache (RR-R32-07).
>
> **4. Escuta encerrada por erro (por exemplo, acesso perdido ao espaço da renda)**
> - **A que converte e a indisponível com números** ficam em reais, sem a ressalva de leitura anterior, também com uma base e nenhuma desconsiderada.
>   - Já na falha, o topo mostra "Estimativa de tempo de trabalho indisponível agora: os valores continuam em reais. Veja o motivo em Configurações."
>   - A prévia mostra "Não foi possível confirmar a estimativa com os totais oficiais. Tente de novo.", com "Tentar de novo". Esse erro não vira "em atualização" com o tempo.
> - **A sem números** mostra o motivo com a ressalva (item 2).
> - Abrir Configurações reabre a escuta. Se a causa já passou, a conversão volta, também no topo. Se continua, a prévia mostra os estados acima.
> - A escuta só reabre com essa visita, o "Tentar de novo", uma recarga ou o retorno do servidor a outra escuta da mesma conta e do mesmo espaço. Até lá, o topo continua em reais.
> - **RR-R31-04.**
>   - Com conversão, a ressalva de leitura anterior fica só para a releitura que falha com a escuta aberta e a base confirmada. No topo, ela diz "Não foi possível atualizar a estimativa com os lançamentos mais recentes: ela usa a leitura anterior. Tente de novo em Configurações."
>   - Sem conversão, a ressalva da prévia acompanha o motivo da indisponível sem números, com a escuta encerrada ou com a releitura que falha. Acompanha também o motivo da indisponível com números, mas só quando ela continua confirmada e uma releitura falha.
>
> **5. Para onde o aviso do topo leva**
> - "Veja o motivo em Configurações" leva ao cartão "Tempo de trabalho equivalente", com o mesmo ícone de relógio do aviso. O aviso não tem link direto, e a mudança dele não é anunciada por leitores de tela.
> - Na indisponível com números ainda sem a confirmação, o motivo não está em Configurações. A prévia mostra "calculando", "em atualização" ou o erro com "Tentar de novo", e o motivo aparece com a confirmação.
> - Com alterações ainda não salvas, a prévia mostra o rascunho ("Prévia com as alterações"), e o estado da estimativa em uso não aparece em Configurações. O "Valor em uso agora" some enquanto ela não converte.
> - Por exemplo, sem conexão e com uma fonte PJ sem confirmação escolhida no rascunho, o topo diz "indisponível agora" por causa da estimativa em uso, e a prévia mostra o motivo do rascunho (PT-R32-06; a classe já existia na R3.1).
>
> **6. Painel "Receitas consideradas" e contagem do assistente (RR-R31-06, atualizado)**
> - O painel (em Configurações e no assistente) e a contagem do assistente usam a data de referência da estimativa mostrada. Só montam a lista com ela calculada e na tela: a que converte ou a indisponível com números, confirmadas, ou a indisponível sem números, com o motivo.
> - Enquanto a que converte ou a indisponível com números espera a confirmação, o painel mostra "Carregando as receitas do período..." e a contagem mostra "Contando os lançamentos de receita do período...". Na R3.2, isso passa a valer também para uma base sem desconsiderada antes do primeiro retorno do servidor e para toda janela sem conexão.
> - Passados 30 s sem a confirmação, com a escuta encerrada ou com a divergência persistente, o painel mostra "A estimativa não carregou, então a lista ainda não pode ser montada. Feche e tente de novo." e a contagem mostra "Não foi possível contar os lançamentos agora: a estimativa não carregou."
> - O "Tentar de novo" é o da prévia. Sem conexão, só resolve com a conexão de volta, e aí a lista volta sozinha.
> - Com a indisponível sem números, a lista aparece sem a linha de conferência com o relatório oficial em cada mês ("Confere com o relatório oficial: …"), porque essa estimativa não traz os totais.
> - Sem conexão, uma lista que ainda não foi lida na sessão não carrega: a leitura fica pausada, sem erro. O painel mostra só os textos fixos, sem "Carregando as receitas do período...", e a contagem fica em "Contando os lançamentos de receita do período...". Com a conexão de volta, a lista aparece.
> - "Restaurar padrão" e "Concluir" continuam funcionando. Desacoplar o painel do estado da estimativa continua fora do escopo (etapa própria).

**Base de cada item.**
- Item 1: código (`useIncomeEstimateWith.ts:114-141, 374-411`; `Header.tsx:533-537`), sondas (1) a (3), unidade e B03-g. As frases "sem conexão desde a abertura" e "duração não medida" vêm só do código.
- Item 2: sondas (5) e (6), unidade `:1741-1796` e o E2E ADV-01. A limitação vem de `logs/render-probe.txt` (B4 a B6).
- Item 3: seção 3.3 e o teste do React Query da rodada 2.
- Item 4: unidade, E2E P5F `:1230` e sonda (4).
- Item 5: `SettingsView.tsx:721-737`, `WorkTimeSettingsView.tsx:443-451` e PT-R32-06.
- Item 6: `IncomeEditor.tsx:46, 108-111, 145-163, 197-209` e `incomeBasis.ts:312-327`. O comportamento sem conexão vem do código, sem E2E.

## 9. Achados novos

- **PT-R3-01 (LOW, anterior à R3.2): a memória de cálculo da indisponível sem números afirma "nenhum" e "nenhuma" para desconsideradas, feriados e exceções.**
  - **Onde:**
    - `estimate.ts:146-157` (`emptyBase`: `months: []`, `excludedCount: 0`), com os retornos em `:160, 165, 170, 191`;
    - `EstimateDetails.tsx:199-205` ("Você não desconsiderou nenhuma receita.") e `:209-219` ("Feriados que tiraram dias de trabalho: nenhum."; "Férias, folgas e exceções: nenhuma no período.").
  - **Evidência.**
    - `logs/render-probe.txt`:
      - B4, `exclusion_unconfirmed`: o motivo "Não foi possível confirmar se um recebimento que você desconsiderou foi estornado…" aparece ao lado de "Você não desconsiderou nenhuma receita.";
      - B5, rotinas ambíguas com a receita r500 desconsiderada: aparece "Você não desconsiderou nenhuma receita.";
      - B6, véspera reduzida: o motivo cita a jornada reduzida e, ao lado, "Férias, folgas e exceções: nenhuma no período.".
    - No gancho, a sonda (6) mostra a estimativa com `excludedCount=0` e a r500 desconsiderada nos parâmetros. Vale na volta à tela antes do retorno do servidor, sem conexão e com a escuta encerrada.
    - Os arquivos são idênticos aos da R3.1 (`logs/hash-memoria-calculo.txt`).
  - **Cenário.**
    - Um rascunho com rotinas que se cruzam e uma receita desconsiderada: a prévia continua na tela, ao lado do aviso de ambiguidade (`WorkTimeSettingsView.tsx:443-461`).
    - Uma preferência gravada com a véspera reduzida ambígua (E2E S01: "a gravada assim deixa a estimativa indisponível").
    - Um estorno não confirmado (B01).
  - **Impacto.**
    - A tela afirma algo falso sobre a configuração da própria pessoa, num contexto financeiro. Não há conversão nem valor errado, e o painel "Receitas consideradas" mostra "Desconsiderada por você: não entra nesta estimativa.".
    - Não foi introduzido pela R3.2: os mesmos textos já apareciam na R3.1, com a prova.
    - Com o ADV-01 mantido pelo F-08, aparecem também nas condições sem prova que envolvem desconsiderada.
  - **Correção sugerida.** Nenhuma nesta etapa, porque mudaria a condição do texto num componente que a etapa não pode alterar.
    - Registrar na seção K (item 2) e como risco no §M do relatório e no plano: interface, LOW, anterior.
    - Numa etapa própria: na indisponível sem números, não afirmar "nenhum" nem "nenhuma"; por exemplo, dizer que os valores do período aparecem quando a estimativa puder ser calculada, e contar as desconsideradas pela preferência.
  - **Não bloqueia:** não é regressão nem mudança da R3.2.
- **PT-R3-02 (LOW, documentação): partes dos rascunhos ainda não acompanham o F-08.**
  - `RELATORIO-P5F1-R32.md:48` (§F, "Escuta encerrada com erro") diz "a indisponível: o motivo, com a ressalva". Separar: a sem números mostra o motivo com a ressalva; a com números mostra o erro "Não foi possível confirmar…", como a que converte.
  - `plano-20-20.md:70-72` (RR-R32-02):
    - "a indisponível, com o motivo" → "a indisponível sem números, com o motivo, ou a com números, confirmada";
    - "Enquanto a estimativa que converte espera a confirmação" → "a que converte ou a indisponível com números";
    - "Com a estimativa indisponível e sem conexão" → "Com a indisponível sem números e sem conexão".
  - `matriz-antes-depois.md:35`, coluna R3.2, "sem números … sem retorno do servidor": qualificar. Com desconsiderada, ela só aparece depois do primeiro retorno do servidor, ou com a leitura por id já no cache da sessão (ADV-R2-06). Os testes "sem retorno do servidor" do projeto usam `excludedIds: []`.
  - O §K ainda está em `XXX` (PT-R32-04): usar a seção 8.
  - O §M e o plano não têm o PT-R3-01: acrescentar.
  - **Impacto:** o pacote de auditoria descreveria errado o que a pessoa vê na escuta encerrada e no painel. Não afeta a árvore nem a decisão de interface. O gate deve conferir no relatório final.
- **PT-R3-03 (INFO): com o F-08, o motivo acionável da indisponível com números não aparece enquanto falta a prova.**
  - **Onde:** `useIncomeEstimateWith.ts:114-115, 141`.
  - **Evidência:** `logs/revisor-ptbr-r2-na-final.log`, testes 1 a 4 e 6; sondas (1) a (3).
  - **Cenário:** sem conexão, com a escuta encerrada ou com a divergência persistente, a pessoa com a rotina sem horas, por exemplo, vê "A estimativa está em atualização…" ou "Não foi possível confirmar…", e não "A jornada configurada não tem horas nos meses considerados. Revise a rotina e as exceções.". Isso inclui a prévia do rascunho enquanto edita a rotina sem conexão.
  - **Impacto:** o texto mostrado é verdadeiro e acionável ("Tentar de novo"), e os valores ficam em reais. É o custo aceito do F-08, que é integridade financeira. O motivo aparece com a confirmação.
  - **Correção sugerida:** documentar (seção K, itens 1 e 5). Numa etapa própria, avaliar mostrar o motivo de configuração (rotina sem horas) sem a memória de cálculo. Não bloqueia.

Nenhum achado HIGH nem MEDIUM. Nenhuma mudança de interface. Nenhum texto fora do pt-BR.

## 10. Riscos residuais

- **Sem axe nem captura.**
  - A combinação P5 (motivo + ressalva) e o topo nos estados T1 e T2 não passaram por axe nem por captura em desktop e celular nesta etapa.
  - Mitigação: são blocos existentes do mesmo componente, com os papéis da R3.1, e o B03-b cobre o ramo `alert` com axe em 375×812.
- **O motivo acionável espera a prova** na indisponível com números (PT-R3-03). Está documentado.
- **A memória de cálculo da indisponível sem números** continua com afirmações falsas, anteriores à R3.2 (PT-R3-01). Está documentada, para uma etapa própria.
- **A duração da espera com rede real** não foi medida.

## 11. O que não foi possível verificar

- **Inspeção interativa.** Não usei `playwright-cli`, capturas nem leitor de tela, porque o COMUM-R3 proíbe. Como não há mudança de UI, o juízo se apoia em quatro fontes:
  - a renderização com o React real;
  - as sondas no gancho;
  - os testes do projeto;
  - os 27 E2E de tempo de trabalho da execução oficial.
  - Não peço execução E2E adicional como condição.
- **O painel sem números e sem conexão** (L4). Vem do código e do teste do React Query da rodada 2, sem E2E.

## 12. Bloqueadores para PASS

Nenhum na árvore `ef514869`. Para fechar o relatório, sem efeito nesta decisão: o PT-R32-04 e o PT-R3-02, e o registro do PT-R3-01 como risco anterior.

## 13. Comandos executados

- **Git**, com `GIT_OPTIONAL_LOCKS=0` e nenhum comando que escreva no índice:
  - `git diff --stat|--name-status|--name-only --no-renames` entre `efcbd264`, `9fddcb5a` e `ef514869`;
  - `git rev-parse <árvore>:<caminho>`;
  - `git archive ef514869 | tar -x --exclude=docs`.
  - Saídas: `logs/diff-stat.txt`, `logs/escopo-ui.txt`, `logs/diff-src-r2-final.patch`, `logs/diff-src-r31-final.patch`, `logs/diff-e2e-r2-final.patch`, `logs/diff-guard-income-r2-final.patch`, `logs/diff-consistency-r2-final.patch` e `logs/hash-memoria-calculo.txt`.
- **Cópia** (`copia/`), com `node_modules` ligado ao do worktree e `diff -rq` contra o worktree: `logs/copia-vs-worktree.txt` e `logs/copia-vs-worktree-2.txt`.
- **Testes e `tsc`.**
  - `nice -n 19 node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 <arquivos>`, com `--test-name-pattern` nas sondas;
  - `nice -n 19 node_modules/.bin/tsc --noEmit -p tsconfig.json`.
  - Saídas nos logs da seção 5.
- **Renderização.** `nice -n 19 node_modules/.bin/esbuild .revisor/render-probe.tsx --bundle --platform=node --format=cjs --jsx=automatic` e `nice -n 19 node .revisor/out/render-probe.cjs`.
  - O provedor de tema recebe um substituto mínimo de `localStorage` e `matchMedia`.
  - A pasta `.revisor/` foi apagada da cópia depois; o roteiro está em `testes-revisor/render-probe.tsx`.
- **Leitura, sem alterar:**
  - os logs da execução oficial: `logs/extrato-e2e-oficial.txt` e `logs/estados-adv-01-oficial.txt`;
  - os rascunhos `RELATORIO-P5F1-R32.md`, `matriz-antes-depois.md`, `plano-20-20.md`, `testes-substituidos.md` e `revisoes-LEIAME.md`;
  - o histórico de execuções;
  - o F-08 da revisão financeira, rodada 2.
