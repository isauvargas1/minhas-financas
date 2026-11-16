PASS — revisão de UI de produto em PT-BR

# P5-F.1-R3.2 — revisão independente de produto e interface em pt-BR, rodada 2 (`ptbr-product-ui-review`)

Revisão feita em 2026-11-11, das 16:52 às 17:25 (UTC), sobre o código real da árvore final `9fddcb5ad93f030bcd991820db85ca9a2b233976`. Não alterei o worktree nem o índice. Não rodei Emulator, Playwright, E2E nem `verify:*`. Tudo o que rodei foi com `nice -n 19`, um comando de cada vez, em cópias próprias por `git archive`.

- Pasta: `<scratchpad>/p5f1r32/revisoes/ptbr/rodada-2`. Os arquivos citados como `logs/…` e `testes-revisor/…` estão nela.
- Os logs do executor estão em `<scratchpad>/p5f1r32/logs/`.
- Os números de linha são os da árvore final.

## 1. Escopo conferido

- **Requisito.** O pedido do usuário (`relatorio/pedido-r32.md`); o meu pedido da rodada 1 (`ptbr/PEDIDO.md`), que continua valendo; e os quatro pontos desta rodada.
- **Árvores.**
  - R3.1: `efcbd264`.
  - Rodada 1: `93668199`.
  - Final: `9fddcb5a`. O worktree corresponde a ela. O `diff -rq` contra a minha cópia só mostra `dist/`, `functions/lib/`, `test-results/` e `firestore-debug.log`, que não são versionados (`logs/copia-vs-worktree.txt`).
- **Índice do git.** Não foi tocado: mtime 11:47:49 e HEAD `1730a1df`, antes e depois da revisão.
- **O que mudou desde a rodada 1 e pode afetar a tela.** Só dois arquivos de `src/`: `useIncomeEstimateWith.ts` (ADV-01) e `consistency.ts` (F-03). Fora de `src/`, o E2E "ADV-01 (R3.2)" e os testes de unidade (`logs/diff-src-r1-final.txt`, `logs/diff-e2e-r1-final.txt`).
- **Telas e fluxos.**
  - O aviso do topo (`Header`).
  - Configurações → Tempo de trabalho equivalente: a prévia; "Nada foi salvo ainda." e "Valor em uso agora"; o painel "Receitas consideradas"; e a memória de cálculo.
  - O assistente: a prévia, a contagem e o painel.
- **Classificação.** Nenhuma alteração de UI. O ADV-01 muda quando um estado que já existia (a estimativa indisponível, com o motivo) aparece. É uma mudança requerida pelo pedido ("Preservar estados legitimamente indisponíveis…") e pelo ADV-01 da revisão adversarial.

## 2. Item 1: nada de texto, componente, estilo ou navegação mudou

| Critério | Evidência | Conclusão |
| --- | --- | --- |
| Componentes | `git rev-parse <árvore>:src/components`: `1b846c67` em `efcbd264`, `93668199` e `9fddcb5a` | Idênticos |
| Textos do módulo | `…:src/modules/work-time/messages.ts`: `07d7de2f` nas três | Idênticos |
| Diff de UI | `git diff --stat` de `src/components`, `messages.ts`, `index.html`, `tailwind.config.js`, `postcss.config.js`, `src/index.css` e `src/App.tsx`, a partir da R3.1 e da rodada 1: vazio (`logs/diff-ui-vazio.txt`) | Nada mudou |
| Navegação e estilo | `src/App.tsx`, `src/contexts`, `src/index.css`, `index.html` e configurações do Tailwind e do PostCSS com o mesmo hash nas três árvores. O filtro de `.tsx`, `.css`, `.html`, `public/`, `messages.ts` e i18n desde a R3.1 dá "(nenhum)" (`logs/escopo-ui.txt`) | Inalterados |
| Mudanças de `src/` são só de estado | As linhas de código alteradas desde a R3.1 são o `setConfirmed(null)` no `fromCache` (`basisSync.ts:511-515`), a regra `inexact` (`consistency.ts:65`) e a expressão do `holdEstimate` (`useIncomeEstimateWith.ts:128-129`). Os únicos literais são identificadores internos (`logs/src-codigo-alterado.txt`) | Só estado |
| O motivo da prova não chega à tela | `'inexact'` e os demais motivos só servem ao agendamento de releituras (`useIncomeEstimateWith.ts:344-348`; `logs/motivo-da-prova.txt`) | Sem vazamento |
| O F-03 não muda o que aparece | Sem bloco exato, `computeWorkTimeEstimate` devolve sempre uma indisponível (`estimate.ts:164-165`), que passa pelo `holdEstimate` sem depender da prova | Nenhum efeito visível |
| Dependências | Desde a R3.1, o `package.json` só muda scripts; o `package-lock.json` não muda (`logs/diff-package-r31-final.txt`) | O mesmo React Query 5.0.0 |

## 3. Item 2: coerência dos estados que mudaram

### 3.1 O que muda

- O `holdEstimate` (`useIncomeEstimateWith.ts:123-129`) só segura a estimativa que converte: `done` com `ready`, sem prova ou com a sincronização em curso.
- A indisponível (`done` com `unavailable`) passa sempre, com o motivo e com o `refreshFailed` da renderização.
- O prazo de 30 s não começa para ela, porque `waitingProof` exige `shown.status === 'loading'` (`:379`).
- Ela nunca converte: o `config` só existe com `ready` (`WorkTimeContext.tsx:127-135`).
- A que converte continua exigindo a prova e o fim da sincronização. Os testes ADV-03 e F-04 e a tabela-verdade passaram (seção 5).

### 3.2 O que a prévia recebe, medido no gancho real (testes do revisor)

Escrevi seis testes de gancho, na minha cópia e fora do projeto (`testes-revisor/bloco-revisor.ts`). Eles usam o mundo simulado de `work-time-consistency.test.ts`, com o React Query real, e rodaram em três cópias com o mesmo teste:
- a final;
- uma com o gancho e a prova da rodada 1. Ela difere da `93668199` só em comentários e numa quebra de linha (`logs/copia-pre-vs-rodada1.txt`, `logs/copia-pre-vs-rodada1-gancho.diff`);
- uma com os três arquivos de `src/` da R3.1.

O caso é "rotina sem horas" (`no_work_minutes`), salvo onde está indicado.

| Situação | R3.1 | Rodada 1 | Final |
| --- | --- | --- | --- |
| Sem conexão, 3 meses, sem desconsiderada | Motivo | "calculando" → "A estimativa está em atualização…" | Motivo, sem a ressalva, nenhuma releitura |
| Sem conexão, 12 meses, com desconsiderada | Motivo | "calculando" → "em atualização" | Motivo, sem a ressalva, nenhuma releitura |
| Escuta encerrada, 3 meses, sem desconsiderada | Motivo + ressalva de leitura anterior | "Não foi possível confirmar a estimativa com os totais oficiais. Tente de novo." | Motivo + ressalva |
| Escuta encerrada, 12 meses, com desconsiderada | "Não foi possível confirmar…" | "Não foi possível confirmar…" | Motivo + ressalva |
| Desconsiderada e escuta recusada desde o começo | "calculando" → "Não foi possível confirmar…"; com o "Tentar de novo", o motivo | Igual | Igual: sem a primeira resposta do servidor, a estimativa nem é calculada |
| "Nenhuma renda", e uma receita chega com uma releitura de 600 ms | "calculando" durante a releitura | "calculando" | O motivo "nenhuma renda" durante a releitura → "calculando" breve → a hora confirmada, sem outro valor |

Logs: `logs/revisor-ptbr-r2-gancho.log` (final: 6/6), `logs/revisor-ptbr-r2-gancho-pre-adv01.log` (rodada 1: 1/6) e `logs/revisor-ptbr-r2-gancho-r31.log` (R3.1: 4/6). As reprovações nas cópias antigas são o comportamento anterior, registrado nas linhas `[revisor-ptbr-r2]`. Em todos os casos e nas três cópias, nada converte.

### 3.3 O motivo real, sem conexão e com a escuta encerrada

- **Sem conexão.** O motivo aparece e continua: E2E verde, `work-time-p5f.spec.ts:1333` e `:1336`; os 12 testes "R3.2 (ADV-01)" do gancho; os meus testes 2 e 4.
  - O texto do motivo é o da última leitura e não diz que a conexão caiu. Para motivos que dependem das receitas (nenhuma renda, renda baixa, relatório indisponível), ele pode estar desatualizado. Com a conexão de volta, a estimativa se atualiza sozinha.
  - É verdade e não induz a erro financeiro, porque nada converte. Na R3.1 já era assim.
- **Escuta encerrada.** O motivo aparece com a ressalva de leitura anterior (meus testes 1 e 3; os testes ADV-01 conferem o motivo).
  - Exceção: com desconsiderada e a escuta encerrada antes do primeiro retorno do servidor, a estimativa ainda não foi calculada. A prévia mostra "Não foi possível confirmar a estimativa com os totais oficiais. Tente de novo.", que é verdade. O "Tentar de novo" reabre a escuta, e o motivo aparece (teste 5).
  - É o mesmo comportamento da R3.1 e da rodada 1, pela regra N05 (`useIncomeEstimateWith.ts:368-371`).

### 3.4 A ressalva de leitura anterior junto do indisponível: é verdadeira e clara?

**O que aparece na prévia** (`EstimateDetails.tsx:70-83`):
- "Estimativa indisponível. <motivo>";
- "Não foi possível atualizar a estimativa com os lançamentos mais recentes agora. Ela usa a última leitura.", em `role="status"`;
- um único "Tentar de novo": o do motivo "relatório indisponível" some com a ressalva (`:74`).

O topo não repete a ressalva. A ressalva do topo (`ESTIMATE_QUALIFIER_STALE`) só existe com `ready` (`Header.tsx:45-51`). O topo continua em "indisponível agora…".

**Quando aparece.** A ressalva aparece quando `refreshFailed`, que inclui `listenFailed` (`useIncomeEstimateWith.ts:294`). Isso acontece em dois casos:
- a escuta encerrada, em toda janela;
- uma releitura que falha. Por exemplo, o navegador se considera conectado, mas o servidor não responde, ou o relatório devolve erro.

Ela **não** aparece só pela falta de conexão que o navegador detecta. O QueryClient do app usa o `networkMode` padrão (`App.tsx:116-123`), e o React Query 5.0.0 pausa a leitura, sem erro. O meu teste mostra isso: `status=success fetchStatus=paused isError=false` na releitura sem conexão (`logs/revisor-ptbr-r2-tanstack.log`). Nos testes do gancho, sem conexão, `refreshFailed` fica falso e nenhuma releitura é tentada.

**Verdadeira: sim.**
- Com a escuta encerrada, nenhuma mudança das projeções chega, e a estimativa não se atualiza sozinha.
- Com a releitura que falha, vale a última leitura.
- O motivo vem dessa leitura (renda) ou da configuração atual (rotina, PJ). Nada converte.

**Clara: sim, com uma ressalva de redação** (INFO, sem efeito financeiro, já existente na R3.1).
- "Ela usa a última leitura", logo abaixo de "Estimativa indisponível.", pode soar estranho: uma estimativa que não existe "usa" uma leitura. O sentido se mantém, porque o estado mostrado vem da última leitura.
- Para os motivos que dependem das receitas, a ressalva é útil. Ela avisa que o "Assim que houver, a estimativa aparece." não vale até o "Tentar de novo".
- Para os motivos de configuração, ela é verdadeira e secundária. Mesmo assim, antecipa o que vem depois: ao corrigir a rotina com a escuta encerrada, a prévia passa a "Não foi possível confirmar…", com "Tentar de novo", sem conversão (teste ADV-01 de `work-time-consistency.test.ts:1781`, asserção em `:1793`, verde).
- A combinação, com os mesmos textos e papéis, já existia na R3.1 com uma base e sem desconsiderada (meu teste 1 na cópia da R3.1).
- Não peço mudança de texto nesta etapa.

### 3.5 O aviso do topo nesses casos

- **Com a estimativa em uso indisponível**, o topo mostra desde o começo "Estimativa de tempo de trabalho indisponível agora: os valores continuam em reais. Veja o motivo em Configurações." (`Header.tsx:535-536`: `done` sem `config`). Vale sem conexão, com a escuta encerrada e durante a sincronização.
  - Na rodada 1, ele passava antes por "Calculando…", o que não era exato para uma estimativa já calculada. Agora é verdadeiro e coerente com os valores em reais.
- **"Veja o motivo em Configurações" leva a um motivo real.** Com a mesma configuração, a prévia mostra o motivo (com a ressalva, se a escuta dela também falha). Abrir Configurações reabre a escuta encerrada da conta e do espaço (`basisSync.ts:520`).
- **Limite (PT-R32-06).** Com alterações ainda não salvas, a prévia mostra o rascunho ("Prévia com as alterações"). O estado da estimativa em uso não aparece em Configurações: "Nada foi salvo ainda." perde o "Valor em uso agora" (`WorkTimeSettingsView.tsx:443-451`).
  - O próprio E2E do ADV-01 é esse caso. O topo diz "indisponível agora" por causa da estimativa em uso, sem conexão, e a prévia mostra o motivo PJ do rascunho (`work-time-p5f.spec.ts:1332-1333`). No vermelho, `error-context.md` mostra "Nada foi salvo ainda." sem o "Valor em uso agora".

### 3.6 Acessibilidade, teclado e celular

- Nenhum elemento novo; os papéis são os da R3.1.
- O motivo (`<p>`, sem papel) não muda na tela. Por isso, nos casos do ADV-01 não há mais as trocas de "calculando" (`status`) para "em atualização" (`alert`), que eram anunciadas sem nada ter mudado de fato.
- A ressalva, quando aparece, é `role="status"` e é anunciada.
- Os componentes são idênticos, então o layout e o celular são os mesmos.
- A combinação "indisponível + ressalva" não passou por axe nem por captura nesta etapa (seção 10).

## 4. Item 3: o E2E "ADV-01 (R3.2)" (`e2e/work-time-p5f.spec.ts:1310`)

| O que o texto do teste afirma | Verde, `9fddcb5a` (`e2e-adv01-r32-1`, 1/1, 53,1 s) | Vermelho, cópia com o `holdEstimate` anterior (`e2e-adv01-na-pre-vermelho`, 0/1, 1,1 min) |
| --- | --- | --- |
| Sem conexão, a indisponível continua com o motivo real | `:1333` passou depois de ao menos 35 s sem conexão | Falhou em `:1333`: "element(s) not found" |
| Sem "calculando" nem "em atualização" | A sequência gravada da prévia tem um único estado, o indisponível com o motivo: sem conexão (`:1336`) e do começo ao fim (`:1346`) | No momento da falha, a prévia é `alert` com "A estimativa está em atualização…" e "Tentar de novo" (`error-context.md:397-399`) |
| A conversão em uso sai e volta com a conexão | `:1330`, `:1332` ("indisponível agora…"), `:1337-1338` e `:1342` | O topo está em "indisponível agora…" na falha (`error-context.md:99`) |
| Nada é gravado | `:1349` | Não chegou |

- **A cópia do vermelho.** Difere da final só no `holdEstimate` e na regra do F-03, com o e2e e as configurações idênticos (`logs/copia-vermelho-vs-final.txt`). O cenário é o mesmo, e no vermelho a escuta da prévia perdeu a confirmação sem conexão. Logo, o verde exercitou de fato a condição.
- **A fase "calculando" do vermelho.** Não está no log: o anexo de `:1335` não foi alcançado. A minha execução do gancho da rodada 1 mostra "calculando → em atualização" na mesma transição (testes 2 e 4).
- **O log verde só traz o "✓" e o tempo.** As sequências foram para anexos do Playwright, que não ficam no log, e o `test-results/` é limpo pelas execuções seguintes. A prova é a igualdade exata das sequências inteiras (PT-R32-08).
- **Fora do E2E.**
  - A estimativa em uso, ela mesma indisponível sem conexão. O topo vai direto a "indisponível agora".
  - A escuta encerrada com a indisponível, que mostra o motivo e a ressalva.
  - Os dois casos têm cobertura de unidade e dos meus testes, não de E2E (PT-R32-08).
- **Conclusão.** Sim, os logs verde e vermelho mostram o comportamento que o texto do teste afirma. Extrato e SHA-256: `logs/extrato-e2e-adv01.txt`.

## 5. Evidências de execução

| Comando / teste | Árvore ou cópia | Resultado | Log |
| --- | --- | --- | --- |
| Unidade, os 10 arquivos de `test:unit:work-time`, `--test-concurrency=1` | Cópia `9fddcb5a` | 261/261, 0 skip, 0 todo, 80 s. Inclui os 12 testes "R3.2 (ADV-01)" do gancho, os 3 ADV-03, os 3 F-04 e a tabela-verdade | `logs/unit-work-time-ptbr-r2.log` |
| Unidade, os 7 arquivos de `test:unit:reports` | Idem | 107/107 | `logs/unit-reports-ptbr-r2.log` |
| Unidade, UI: `icon-pack-props` e `messages-removal-guard` | Idem | 9/9 | `logs/unit-ui-ptbr-r2.log` |
| `tsc --noEmit` da raiz, com `e2e/` e `tests/` | Cópia limpa, sem os meus testes | Saída 0, 22 s | `logs/tsc-root-ptbr-r2.log` |
| Testes do revisor no gancho (6) | Final / rodada 1 / R3.1 | 6/6; 1/6; 4/6 (seção 3.2) | `logs/revisor-ptbr-r2-gancho*.log` |
| Teste do revisor: React Query sem conexão | Cópia final | 1/1. A 1ª tentativa reprovou por erro meu: faltou `client.mount()`, que o `QueryClientProvider` faz no app. As afirmações da pausa já passavam | `logs/revisor-ptbr-r2-tanstack.log`, `logs/revisor-ptbr-r2-tanstack-1a-tentativa.txt` |
| E2E ADV-01, verde e vermelho (executados pelo executor) | Seção 4 | Seção 4 | `logs/extrato-e2e-adv01.txt` |
| `verify:all` oficial (`verify-all-r32-3`) | `9fddcb5a` | Em andamento. Às 17:18 já estava no E2E, com 0 "not ok" no log | Não concluído (seção 11) |

**E2E existentes que o ADV-01 poderia afetar**, por inspeção (`logs/e2e-estados-transitorios.txt`):
- Nenhum E2E afirma "calculando", "em atualização" ou "Não foi possível confirmar" para uma estimativa que seria indisponível.
- Os estados de erro (`:758`, falha do relatório; `:1016`, falha da leitura por id) são `error`, e o `holdEstimate` não os toca.
- Os testes que esperam o motivo (`:729`, `:732`, `:1533`, `:1660`) só o veem mais cedo.

## 6. Comparação antes e depois

- **Esperado e presente.** A estimativa indisponível aparece como está, com o motivo, sem conexão, com a escuta encerrada e durante a sincronização. Com a escuta encerrada, ou com a releitura que falha, ela vem com a ressalva de leitura anterior da prévia. O topo vai direto a "indisponível agora…".
  - Diante da rodada 1, saem os "calculando", "em atualização" e "Não foi possível confirmar…" que escondiam o motivo.
  - Diante da R3.1, há duas diferenças:
    - a escuta encerrada com duas bases ou com desconsiderada passa de "Não foi possível confirmar…" ao motivo com a ressalva;
    - a releitura demorada passa de "calculando" ao motivo da última leitura.
  - Sem conexão, o resultado é o mesmo da R3.1 (seção 3.2).
- **Sem mudança.** A estimativa que converte: espera a prova e o fim da sincronização em toda janela, sem conversão anterior nem prazo que aprove. O modo dinheiro, os textos, os papéis e o layout.
- **Inesperado.** Nenhuma regressão de interface. O limite do rascunho (PT-R32-06) não é novo: na R3.1, a mesma classe já ocorria com qualquer motivo da estimativa em uso.
- **Testes substituídos, vistos pela interface.** Nenhum foi enfraquecido.
  - A guarda exige a expressão nova exata do `holdEstimate` (`work-time-guard.test.ts:469`).
  - A contagem de aprovações baixou de 3 para 2, o que é mais estrito.
  - A tabela-verdade nova cobre seis motivos × prova × sincronização × falha, com e sem `refreshFailed`.

## 7. Item 4: redação dos impactos para o relatório

**A redação do executor, como está nos rascunhos** (lidos às 17:16; SHA-256 e trechos em `logs/rascunhos-trechos.txt`):
- Na seção K do relatório ("Impactos documentados"), a redação ainda é `XXX` (`RELATORIO-P5F1-R32.md:84`).
- A resposta do executor diz que o relatório usará a minha redação da rodada 1. Com o ADV-01, ela ficou inexata em dois pontos:
  - "só montam a lista com a estimativa pronta e confirmada";
  - "se continua, a prévia mostra 'Não foi possível confirmar…'".
- Os rascunhos têm, além disso, frases inexatas depois do ADV-01, ou sem evidência (PT-R32-07).

Proponho esta redação, com os textos citados literalmente:

> **Impactos conhecidos, sem mudança de interface (P5-F.1-R3.2)**
>
> Nenhum texto, componente, estilo ou navegação mudou; muda só quando cada estado que já existia aparece. Nenhum valor é convertido sem a confirmação do servidor; enquanto ela falta, os valores ficam em reais.
>
> **1. Estimativa que converte: espera pela confirmação do servidor (sincronização demorada)**
> - A estimativa só converte depois que um retorno do servidor à escuta das projeções mensais confirma as bases. Vale para toda janela (1, 3, 6 ou 12 meses e mês atual), com uma base ou duas, com ou sem receita desconsiderada.
> - A base guardada no cache não converte sozinha: nem na prévia de Configurações aberta de novo, nem no recurso desligado e religado, nem na troca da fonte da renda e na volta.
> - Até esse retorno, o topo mostra "Calculando a estimativa de tempo de trabalho: enquanto isso, os valores ficam em reais." A prévia de Configurações e a do assistente mostram "Lendo as receitas oficiais e calculando...".
> - Passados 30 s sem a prova, só o texto muda; o prazo não aprova nada. O topo passa a "Estimativa de tempo de trabalho indisponível agora: os valores continuam em reais. Veja o motivo em Configurações." A prévia passa a "A estimativa está em atualização: ainda não foi possível confirmá-la com os totais oficiais. Enquanto isso, os valores ficam em reais.", com "Tentar de novo".
> - Os 30 s só contam depois que a estimativa foi calculada. Enquanto as leituras não terminam (por exemplo, sem conexão desde a abertura do aplicativo), fica "calculando", sem a troca de texto.
> - O topo e a prévia contam os 30 s separadamente. Logo depois de abrir Configurações, a prévia pode mostrar "Lendo as receitas oficiais e calculando..." por até 30 s, com o topo já em "indisponível agora".
> - Quando o retorno chega e confirma as bases, a conversão volta sozinha, sem recarregar e sem "Tentar de novo". A duração da espera com rede real não foi medida.
> - Uma base que não alcança a projeção depois das releituras (anomalia no servidor) continua sem conversão, também com uma base e sem desconsiderada. Fica "em atualização" até uma releitura trazer a base certa (amplia o RR-R31-03).
>
> **2. Estimativa indisponível: aparece com o motivo, sem esperar (ADV-01)**
> - Quando a estimativa calculada é indisponível, a prévia mostra "Estimativa indisponível." com o motivo, sem esperar a confirmação do servidor. Vale também sem conexão, com a escuta encerrada e durante a sincronização. Nada converte, e os valores ficam em reais.
> - Exemplos de motivo: "A jornada configurada não tem horas nos meses considerados. Revise a rotina e as exceções." e "Não há receitas efetivadas nos meses considerados. Assim que houver, a estimativa aparece."
> - O topo mostra desde o começo "Estimativa de tempo de trabalho indisponível agora: os valores continuam em reais. Veja o motivo em Configurações.", sem passar por "Calculando…".
> - O motivo é o da última leitura. Durante uma releitura demorada, ele fica na tela até ela terminar; por exemplo, "Não há receitas efetivadas…" logo depois de uma receita lançada. A conversão só aparece depois da confirmação.
> - Sem conexão, o texto não diz que a conexão caiu nem que o motivo pode ter mudado em outro dispositivo. Com a conexão de volta, a estimativa se atualiza sozinha.
> - Com a escuta encerrada, ou com uma releitura que falha, a prévia mostra junto do motivo "Não foi possível atualizar a estimativa com os lançamentos mais recentes agora. Ela usa a última leitura.", com "Tentar de novo". O topo não mostra essa ressalva.
> - Se a pessoa corrige o motivo com a escuta encerrada (por exemplo, põe horas na rotina), a estimativa só converte com a confirmação. Até lá, a prévia mostra "Não foi possível confirmar a estimativa com os totais oficiais. Tente de novo.", com "Tentar de novo".
> - Com receita desconsiderada e a escuta encerrada antes do primeiro retorno do servidor, a estimativa nem chega a ser calculada. A prévia mostra "Não foi possível confirmar a estimativa com os totais oficiais. Tente de novo.", sem o motivo, até a escuta reabrir.
> - Na R3.1, o motivo já aparecia sem conexão. Durante a sincronização, ele dava lugar a "calculando". Com a escuta encerrada em 12 meses ou com desconsiderada, dava lugar a "Não foi possível confirmar…".
>
> **3. Sem conexão**
> - Quando o aplicativo passa a ler só do cache local, a confirmação anterior deixa de valer, e nenhuma estimativa converte. Na R3.1, a conversão continuava pela última confirmação.
> - A estimativa que converte segue o item 1; a indisponível, o item 2.
> - Os textos não dizem que a causa é a conexão. As leituras ficam pausadas, sem erro. O "Tentar de novo" não tem efeito visível até a conexão voltar, e a ressalva de leitura anterior não aparece só pela queda.
> - Com a conexão de volta, a conversão volta sozinha.
> - Numa queda que o navegador não detecta, a confirmação anterior vale até o SDK passar a servir só do cache (RR-R32-07).
>
> **4. Escuta encerrada por erro (por exemplo, acesso perdido ao espaço da renda)**
> - A estimativa que converte fica em reais, sem a ressalva de leitura anterior, também com uma base e nenhuma desconsiderada.
> - Já na falha, o topo mostra "Estimativa de tempo de trabalho indisponível agora: os valores continuam em reais. Veja o motivo em Configurações." A prévia mostra "Não foi possível confirmar a estimativa com os totais oficiais. Tente de novo.", com "Tentar de novo".
> - A estimativa indisponível mostra o motivo com a ressalva (item 2).
> - Abrir Configurações reabre a escuta. Se a causa já passou, a conversão volta, também no topo. Se continua, a prévia mostra os estados acima.
> - A escuta só reabre com essa visita, o "Tentar de novo", uma recarga ou o retorno do servidor a outra escuta da mesma conta e do mesmo espaço. Até lá, o topo continua em reais.
> - RR-R31-04: com conversão, a ressalva de leitura anterior fica só para a releitura que falha com a escuta aberta e a base confirmada. No topo, ela diz "Não foi possível atualizar a estimativa com os lançamentos mais recentes: ela usa a leitura anterior. Tente de novo em Configurações."
> - Sem conversão, a ressalva da prévia acompanha o motivo da estimativa indisponível, com a escuta encerrada ou com a releitura que falha, em toda janela.
>
> **5. Para onde o aviso do topo leva**
> - "Veja o motivo em Configurações" leva ao cartão "Tempo de trabalho equivalente", com o mesmo ícone de relógio do aviso. O aviso não tem link direto, e a mudança dele não é anunciada por leitores de tela.
> - Com alterações ainda não salvas, a prévia mostra o rascunho ("Prévia com as alterações"), e o estado da estimativa em uso não aparece em Configurações. O "Valor em uso agora" some enquanto ela não converte.
> - Por exemplo, sem conexão e com outra fonte escolhida no rascunho, o topo diz "indisponível agora" por causa da estimativa em uso, e a prévia mostra o motivo do rascunho.
>
> **6. Painel "Receitas consideradas" e contagem do assistente (RR-R31-06, atualizado)**
> - O painel (em Configurações e no assistente) e a contagem do assistente usam a data de referência da estimativa mostrada. Só montam a lista quando ela está calculada e na tela: a que converte, confirmada, ou a indisponível, com o motivo, também sem conexão, com a escuta encerrada e durante a sincronização.
> - Enquanto a estimativa que converte espera a confirmação, o painel mostra "Carregando as receitas do período..." e a contagem mostra "Contando os lançamentos de receita do período...". Na R3.2, isso passa a valer também para uma base sem desconsiderada, antes do primeiro retorno do servidor, e para toda janela sem conexão.
> - Passados 30 s sem a confirmação, ou com a escuta encerrada, o painel mostra "A estimativa não carregou, então a lista ainda não pode ser montada. Feche e tente de novo." e a contagem mostra "Não foi possível contar os lançamentos agora: a estimativa não carregou."
> - O "Tentar de novo" é o da prévia. Sem conexão, só resolve com a conexão de volta, e aí a lista volta sozinha.
> - Com a estimativa indisponível e sem conexão, uma lista que ainda não foi lida na sessão não carrega. A leitura fica pausada, sem erro: o painel mostra só os textos fixos, sem "Carregando as receitas do período...", e a contagem fica em "Contando os lançamentos de receita do período...". Com a conexão de volta, a lista aparece. Na R3.1, sem conexão, era assim para toda estimativa mostrada.
> - "Restaurar padrão" e "Concluir" continuam funcionando. Desacoplar o painel do estado da estimativa continua fora do escopo (etapa própria).

**Base de cada item.**
- Itens 1 e 3: o código (`useIncomeEstimateWith.ts:358-398`, `basisSync.ts:511-520`, `Header.tsx:533-537`), o B03-g e os testes ADV-03. A frase "sem conexão desde a abertura do aplicativo" vem só do código (`useIncomeEstimateWith.ts:247, 379`), sem execução.
- Item 2: a seção 3 e os testes do revisor.
- Item 4: o E2E "escuta das projeções encerrada" e os testes 1, 3 e 5.
- Item 5: a seção 3.5.
- Item 6: `IncomeEditor.tsx:46, 107, 145-148, 197-204` e o teste do revisor do React Query. O comportamento do painel sem conexão vem do código e desse teste, sem E2E.

## 8. Achados da rodada 1: situação

- **PT-R32-01 (INFO): o aviso do topo orienta de forma indireta.** Aberto, para documentar (item 5 da redação).
  - Com o ADV-01, o caso da indisponível melhorou: o topo vai direto a "indisponível agora", e Configurações mostra o motivo real.
  - Continuam o aviso sem link direto, o aviso sem região viva e o mesmo texto para causas diferentes. Entra também o caso do rascunho (PT-R32-06).
- **PT-R32-02 (INFO): sem conexão, o texto não cita a conexão.** Aberto, para documentar (item 3).
  - Na estimativa que converte, continua o "em atualização" genérico. Na indisponível, aparece o motivo real, como na R3.1, também sem citar a conexão.
  - O "Tentar de novo" sem conexão não tem efeito visível até ela voltar, porque o React Query pausa a leitura.
- **PT-R32-03 (INFO): os itens I-02 a I-06 da R3.1.** Aberto, para documentar. Com o ADV-01, ficam menos frequentes nos estados indisponíveis; na estimativa que converte, ficam como na rodada 1. Entra também o painel sem conexão, que não mostra que está carregando (item 6), como já acontecia na R3.1.
- **PT-R32-04 (INFO): o relatório da R3.2 ainda não traz os impactos.** Aberto. A seção K está em `XXX`. Usar a redação da seção 7 desta rodada, não a da rodada 1.
- **PT-R32-05 (INFO): a 1ª execução do p5f estourou o prazo.** Fechado.
  - A causa registrada confere com o código: o botão `e2e-login-button` só existe com `VITE_E2E_MODE === 'true'` (`LoginView.tsx:38, 73`), que só o `build:e2e` define.
  - O `.meta` da execução não tem a linha de build, ao contrário das seguintes. A reexecução com o build novo passou 19/19.
  - Não há `.env*` no worktree (conferi só a existência) e o Vite lê da raiz (`vite.config.ts:6`). O `dist/` reaproveitado não tinha configuração de produção.

## 9. Achados novos

- **PT-R32-06 (INFO): com alterações não salvas, o "Veja o motivo em Configurações" do topo leva ao motivo do rascunho.**
  - Onde: `Header.tsx:535-536`; `WorkTimeSettingsView.tsx:443-451`. Também `work-time-p5f.spec.ts:1332-1333` e `e2e-adv01-na-pre-vermelho-error-context.md:99, 397-400`.
  - Cenário: a estimativa em uso deixa de converter (sem conexão, sem confirmação ou com um motivo próprio) com um rascunho de outra fonte aberto. O topo diz "indisponível agora"; a prévia mostra o motivo do rascunho (no E2E, o motivo PJ); o "Valor em uso agora" some sem explicação.
  - Impacto: quem segue o aviso durante uma edição pode tomar o motivo do rascunho pelo motivo do valor em uso. Os valores ficam em reais, sem erro financeiro. A classe já existia na R3.1 (I-05). O ADV-01 só troca o "em atualização" genérico da prévia pelo motivo específico do rascunho.
  - Correção sugerida: documentar (item 5 da redação). Numa etapa própria, mostrar o estado da estimativa em uso junto de "Nada foi salvo ainda.". Nenhuma mudança de interface nesta etapa.
- **PT-R32-07 (LOW, documentação): frases dos rascunhos ficaram inexatas com o ADV-01 ou não têm evidência.**
  - Onde: `logs/rascunhos-trechos.txt`.
    - `matriz-antes-depois.md:30`: "Sempre o erro 'Não foi possível confirmar…'" na escuta encerrada. Só vale para a estimativa que converte; a indisponível mostra o motivo com a ressalva (testes 1 e 3).
    - `matriz-antes-depois.md:35` (coluna R3.1) e `RELATORIO-P5F1-R32.md:50`: "aparece como está" na R3.1. Na R3.1, a indisponível virava "calculando" durante a sincronização, também com uma base, e "Não foi possível confirmar…" com a escuta encerrada em 12 meses ou com desconsiderada (teste 6 e teste 3 na cópia da R3.1).
    - `plano-20-20.md:62`: "Com rede, o retorno chega em menos de um segundo nos E2E". Não achei medida nos logs nem nos rascunhos; os registros dos E2E não têm tempo.
    - `plano-20-20.md:66-67` (RR-R32-02): diz que o painel "depende da estimativa pronta" e que "A estimativa não carregou…" aparece só "sem conexão e passado o tempo de interface". O painel também monta a lista com a indisponível, e "A estimativa não carregou…" também aparece com a escuta encerrada e com a divergência persistente.
    - `plano-20-20.md:75` (RR-R31-04): falta a ressalva junto da indisponível.
    - `matriz-antes-depois.md:29` cita "Estimativa em atualização", que é paráfrase. O texto é "A estimativa está em atualização: …".
    - `matriz-antes-depois.md:35` conta "(11 testes)" de unidade "R3.2 (ADV-01): …". São 12 no gancho (`logs/unit-work-time-ptbr-r2.log`, testes 115 a 126), mais a tabela-verdade.
  - Impacto: o relatório e o plano descreveriam errado quando aparecem o erro, o motivo e o painel. Não afeta a árvore sob revisão nem a decisão de interface; afeta o pacote de auditoria.
  - Correção sugerida: adotar a seção 7. Na matriz, qualificar a linha 6 ("estimativa que converte") e corrigir a coluna R3.1 da linha 11 e do §F. Medir a espera ou trocar a frase por "não medida". Atualizar o RR-R32-02 e o RR-R31-04, citar os textos literalmente e corrigir a contagem para 12. O gate deve conferir no relatório final.
- **PT-R32-08 (INFO, cobertura e evidência): três partes do ADV-01 só têm prova fora do E2E, ou fora do projeto.**
  - (a) Nenhum teste do projeto afirma, no gancho, a ressalva junto da indisponível com a escuta encerrada (`refreshFailed` verdadeiro), nem a ausência dela sem conexão.
    - A cadeia está guardada por expressão regular (`work-time-guard.test.ts:567, 569`) e pela tabela-verdade. O comportamento só foi executado nos meus testes.
    - Sugestão: acrescentar `refreshFailed` aos testes ADV-01 de `work-time-consistency.test.ts` (verdadeiro depois de `failListen`, falso depois de `goOffline`).
  - (b) O log verde do E2E não traz as sequências gravadas. Sugestão: imprimi-las como os registros `[valores-b03-g]`.
  - (c) Não há E2E da estimativa em uso indisponível sem conexão (topo direto em "indisponível agora") nem da indisponível com a escuta encerrada.
  - Nada disso é defeito, e não bloqueia.

Nenhum achado HIGH ou MEDIUM. Nenhum achado de interface acima de INFO.

## 10. Riscos residuais

- **A combinação "Estimativa indisponível + ressalva de leitura anterior".** Já existia na R3.1 e agora vale em toda janela. Não passou por axe nem por captura em desktop e celular nesta etapa.
  - Mitigação: são dois blocos já existentes do mesmo componente, sem mudança de classe nem de papel. O B03-b cobre o ramo `alert` com axe em desktop e 375×812.
- **O motivo da última leitura** pode estar desatualizado sem conexão, ou durante uma releitura demorada, sem aviso. Não há conversão. Documentado (item 2).
- **A duração da espera com rede real** não foi medida (item 1).
- **O E2E completo na árvore final** depende do `verify-all-r32-3`. Até a minha revisão, na árvore final, só rodou o E2E do ADV-01; o resto de `work-time-p5f.spec.ts` e o B03 rodaram na rodada 1 com o `src/` anterior (19/19 e 7/7).
  - Por inspeção, o ADV-01 só faz o motivo aparecer mais cedo nesses testes (seção 5).
  - Se algum E2E de tempo de trabalho falhar na execução oficial, esta decisão precisa ser refeita.

## 11. O que não foi possível verificar

- **Inspeção interativa.** Sem `playwright-cli`, capturas antes e depois nem leitor de tela: as portas estão em uso, e o COMUM-R2 proíbe. Como não há mudança de UI, as asserções do E2E, os testes de gancho e o código bastam para o juízo. Não peço execução E2E adicional como condição.
- **Resultado do `verify:all` oficial.** Às 17:18 estava no E2E, sem falha registrada. O gate confere.
- **Medida do tempo até o retorno do servidor** (PT-R32-07).

## 12. Bloqueadores para PASS

Nenhum na árvore `9fddcb5a`. Para fechar o relatório, sem efeito nesta decisão: o PT-R32-04 e o PT-R32-07.

## 13. Comandos executados

- **Git** (com `GIT_OPTIONAL_LOCKS=0`; nenhum comando que escreva no índice): `git diff --stat|--name-status|--name-only --no-renames` entre `efcbd264`, `93668199` e `9fddcb5a`; `git rev-parse <árvore>:<caminho>`; `git show <árvore>:<arquivo>`; `git archive`. Saídas em `logs/diff-stat.txt`, `logs/escopo-ui.txt`, `logs/diff-ui-vazio.txt`, `logs/diff-src-*.txt`, `logs/diff-e2e-r1-final.txt`, `logs/diff-tests-unit-r1-final.txt`, `logs/diff-package-r31-final.txt`, `logs/src-codigo-alterado.txt` e `logs/r31-*.ts`.
- **Cópias.**
  - `copia`: a final.
  - `copia-pre`: a final com os dois arquivos da cópia do vermelho do executor, lidos sem alterar.
  - `copia-r31src`: a final com os três `src/` da R3.1.
  - Comparações: `logs/copia-vs-worktree.txt`, `logs/copia-vermelho-vs-final.txt`, `logs/copia-pre-diff-src.txt`, `logs/copia-pre-vs-rodada1*.{txt,diff}`.
- **Testes e `tsc`.** Com `nice -n 19 node --experimental-strip-types --test --test-concurrency=1 …` e `nice -n 19 node_modules/.bin/tsc --noEmit`; saídas nos logs da seção 5. Os testes do revisor estão em `testes-revisor/` (SHA-256 em `logs/testes-revisor-sha256.txt`) e foram copiados só para as cópias.
- **Leitura dos logs e rascunhos do executor**, sem alterar: `logs/extrato-e2e-adv01.txt`, `logs/rascunhos-trechos.txt`, `logs/e2e-estados-transitorios.txt`.
- **Existência de `.env*` no worktree**, só com `ls`/`find`, sem ler conteúdo.
