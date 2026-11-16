# Revisão independente da P5-F (REQ-FUT-01): revisão 4 (curta)

Base `1730a1df`. Revisei o delta desde a revisão 3, lendo o worktree até 2026-10-19 13:10 UTC. Não rodei testes, `tsc`, Emulator, Playwright nem servidor, e não alterei nenhum arquivo do worktree.

Para comparar a árvore, calculei os hashes dos arquivos com `git hash-object` sem `-w` e com `git ls-tree`, só leitura. O `src` é o mesmo da revisão 3: nenhum arquivo de `src/` mudou desde 12:33.

## 1. Veredito

As mudanças estão corretas e não enfraquecem nenhuma asserção anterior; não achei falso positivo provável no E2E. Ficam 2 LOW e 3 INFO, nenhum bloqueante:
- **L1 (guarda):** a guarda da sessão trava a escrita e o cancelamento, mas não o uso do estado.
- **L2 (documentação):** `VEREDITOS.md` cita um `verify:all` numa árvore anterior às mudanças de teste e um `execucoes.md` que não existe.

## 2. Achados

### L1 (LOW): a guarda da sessão não trava o uso de `current`

**Onde:** `tests/unit/work-time-guard.test.ts:128-140` contra `src/modules/work-time/WorkTimeContext.tsx:94` e `:124`.

**O que a guarda trava:**
- os 4 `setState` marcados com o uid do listener;
- a ausência de atualização funcional;
- a definição de `current`;
- `return subscribeWorkTimePreference(uid, …)`;
- as dependências `[uid, retryNonce]`.

**O que fica de fora:** a guarda não confere que o valor exposto vem de `current`.

**Cenário:** um refactor troca a linha 94 por `const snapshot = state.status === 'ready' ? state.snapshot : null;`. A guarda continua passando; nenhum dos mutantes G32-G34 cobre esse caso (`mutantes.py.txt:164-171`). Na troca direta A → B, durante a renderização com `uid = null`, o `snapshot` de A volta a alimentar `displayMode`, `config` e o alternador do Header até o efeito zerar o estado. É exatamente a janela que a proteção fecha.

**Correção mínima:** acrescentar duas asserções:
- `assert.match(source, /const snapshot = current\.status === 'ready' \? current\.snapshot : null;/)` e `/status: current\.status,/`;
- nenhuma leitura de `state.` além de `state.uid` na linha de `current`. Por exemplo: remover a linha de `current` do texto e exigir `doesNotMatch(/\bstate\./)`.

Quanto à fragilidade, as regexes de formato exato (linha de `current`, dependências) quebram se o código for reformatado. Elas falham alto, não em silêncio, então isso é aceitável para uma guarda estrutural.

### L2 (LOW): `VEREDITOS.md` e `LEIAME.md` não batem com o estado atual

**Onde:** `docs/production/evidence/p5f/VEREDITOS.md`, linhas 3, 10 e 63, e `LEIAME.md`, linha 17.

**O que os documentos dizem:**
- a árvore avaliada é `8c072d25…`, "a árvore do `verify:all` final; depois dele só a documentação mudou";
- o `verify:all` final saiu com 0;
- os detalhes estão em `execucoes.md` (comandos, totais, "2.887 aprovados, 191 E2E").

**O que encontrei:**
- `execucoes.md` não existe no diretório.
- Comparei os blobs de `8c072d25` com o worktree atual. Além da documentação, mudaram `e2e/work-time-p5f.spec.ts` e `tests/unit/work-time-guard.test.ts`, ou seja, o I6/I7, a guarda da sessão e a captura de logs. "Depois dele só a documentação mudou" é falso para o estado atual.
- O `verify:all` que está rodando agora é outro.

**Correção mínima:** quando o `verify:all` em andamento terminar:
- criar `execucoes.md` com o resultado;
- trocar a árvore citada pela da nova execução, conferindo que ela contém a guarda (13:02) e o E2E (12:55) atuais;
- só então manter "saída 0".

### INFO

- **I8: o `converted` não pega a conversão com o nome real da variável em `ClientsReceivablesView`** (`work-time-guard.test.ts:276-277`). Os dois pontos usam `display.cents(receivable.amountCents` e `display.cents(dialog.receivable.amountCents`, mas no arquivo o hook se chama `moneyDisplay`. Com `includes`, que diferencia maiúsculas, `moneyDisplay.cents(receivable.amountCents, …)` não contém `display.cents(…)`.
  - A checagem `brl` continua pegando a troca.
  - O que passaria é só a versão convertida ao lado da original (o caso G30/G31) nesse arquivo.
  - **Correção:** usar `moneyDisplay.cents(` ou uma regex `/[dD]isplay\.cents\(/`.
- **I9: referência de linha desatualizada.** `VEREDITOS.md` cita "guarda `:307`, mutante G11" para "modo dinheiro idêntico". O teste está em `work-time-guard.test.ts:321`; a linha 307 fica dentro do teste dos pontos elegíveis.
- **I10: resíduo, e não falso positivo provável, das formas de busca no E2E.**
  - `INCOME_AS_JSON_NUMBER` (`e2e/work-time-p5f.spec.ts:35`) exige delimitador JSON antes (`: , [`) e depois (`, ] }`) de exatamente 4400 ou 440000, com `.0+` opcional. Por isso não casa com UUIDs, IDs base36 ou carimbos ISO (estão entre aspas e não têm delimitador), nem com milissegundos de 13 dígitos (o número inteiro teria de ser 4400), linha e coluna de pilha (`:4400:` e `:4400)`) ou URL `:4400/`. Nenhuma constante 4400 ou 440000 existe em `src`, `functions/src` ou `e2e/support` (`grep -w`).
  - As formas `4400,00` e `4400.00` não aparecem em hex, base36 ou UUID (não há `,` nem `.`), nem em ISO (`44:00.000`).
  - O único resíduo é a busca de substring `440000` em texto, que já existia desde a revisão 1. Ela pode casar por acaso dentro de um hash ou UUID hex (cerca de 2·10⁻⁶ por UUID) ou no `id: Date.now().toString()` do histórico da IA (cerca de 2·10⁻⁶ por mensagem). É desprezível.
  - Na captura de console, as mensagens de recurso do Chromium não trazem a URL no `text()`, e os avisos do logger do Firebase só têm o carimbo ISO.
  - Falso negativo menor: a renda em reais como string JSON `"4400"` não é procurada.

## 3. Verificado

### I6 e linhas da guarda
- São 19 entradas, 18 com `converted`: 6 da revisão 3 e mais 12 agora. A que fica sem ele é a anulação da despesa dividida, com o comentário na linha 274.
- Cada expressão `brl` aparece exatamente uma vez no seu arquivo, e nenhum `converted` existe no código. Conferi por leitura estática; os testes não rodaram.
- Nenhuma asserção anterior saiu: formato de log, `logCode` literal, Rules, curinga genérico, `importsWorkTime`, 5 eixos, 5 larguras, margens, Header da prévia, modo dinheiro idêntico.
- A guarda tem 13 testes, e o work-time soma 14 + 9 + 13 = 36.

### Guarda da sessão
- Ela casa com o código: os 4 `setState` (`WorkTimeContext.tsx:74, 77, 80, 85`), a linha de `current` (91-93), o `return subscribeWorkTimePreference(` e `}, [uid, retryNonce]);`.
- G32-G34 (`mutantes.py.txt:164-171`) mutam a definição de `current`, o `return` e o `setState` funcional.

### E2E: I7, perfil e logs
- **`INCOME_NEEDLES` e `INCOME_AS_JSON_NUMBER`** (33-35) valem para o payload da IA (436-439), o histórico (442-443), o `localStorage` (500-503) e os logs (493-497).
- **`carriesIncome`** (476-485):
  - número igual a 440000 ou 4400;
  - texto com qualquer das formas;
  - ignora objetos com `toMillis`.
- **Perfil** (189): a checagem trocou o `JSON.stringify` por `carriesIncome`. Não ficou mais fraca para vazamentos realistas, porque acrescenta reais e texto. Só deixa de olhar chaves e números que contêm 440000 como parte, por exemplo 4400000.
- **Captura de logs:** `watchBrowserLogs` está nos 4 testes (129, 248, 326, 388), inclusive no segundo dispositivo (237) e na segunda aba (333), e `expectNoIncomeInLogs` fecha cada um (243, 321, 383, 468).
- **Asserções que continuam:** observador de vazamento do teste 2, 360 px, chaves do payload, axe, offline, `listDocuments()`.
- **Higiene:** 4 testes, sem `skip` nem `only`.

### Matriz (I5)
- Linha 64: margem 0 e 80 px só no modo tempo; no modo dinheiro, os valores da base.
- Linha 165, com a nova linha R-CF 166, `SplitBillDetailsModal.tsx:160-164`.
- O total BRL dá 129 (Divisão 8), e a soma por superfície confere.

### `VEREDITOS.md` e `mutantes.md` contra o código
- **Linhas citadas que conferem:**
  - Rules: `firestore.rules:1165-1169`, `1171-1192`, `1230-1235`, `1234`;
  - `api.ts:24`, `api.ts:50-61`;
  - `WorkTimeContext.tsx:68`, `:72-93`, `:84`;
  - `WorkTimeSettingsView.tsx:23-27`, `:37`, `:117`, `:119`, `:146`, `:149`, `:185`;
  - `Header.tsx:49-50`, `:371-373`, `:520-528`;
  - guarda `:58-93`, `:94`, `:109`.
- **Contagens:**
  - 57 mutantes de unidade e guarda: C1-C12, K1-K8, F1-F3, G1-G34;
  - 15 nas Rules;
  - Rules 10/10;
  - 103 capturas (`visual/LEIAME.md:29`).
- **Backend:** `git diff --quiet 1730a1df -- functions firestore.indexes.json firebase.json` sai com 0.
- **Afirmações:** "13 das 19 só exigiam presença" e "cada expressão aparece uma única vez" conferem.

### `revisoes/`
- `revisao-1` e `revisao-3` são idênticas às originais, só com `<scratchpad>` no lugar do caminho.
- `revisao-2` difere apenas no trecho do caminho abreviado (`<scratchpad>/axe/...`).
- A única menção restante a um caminho temporário era texto da revisão 3, que só afirmava a ausência desses caminhos; na cópia versionada ela foi reescrita sem o caminho.
- Os roteiros novos (`mutantes-guarda-r3`, `mutantes-guarda-sessao`, `mutante-e2e-r3`, `mutante-e2e-logs`) não citam o projeto de produção, segredos nem caminhos absolutos.
