**Veredito da rodada 2: PASS.** Não encontrei, na árvore de código congelada `377c2f3`, caminho para prova verdadeira com valor errado, nem na operação do produto nem seguindo os procedimentos documentados. A poda nova é correta e não toca nada de que a prova dependa. Ficam itens LOW e INFO, nenhum bloqueante. O `verify:all` da árvore (19:42:32–20:22:55 UTC, 1ª execução) terminou com `exit=0`: 3.250 testes, 0 falha e 0 skip, inclusive a integração das marcas (16/16).

# Parecer de arquitetura — P5-F.1-R3, rodada 2 (gatilho × reconstrução × leitura, B03)

## Escopo e método

**Leitura, só na árvore congelada:**
- `pruneMarkDoc` e a chamada dela em `applyCashPeriodWriteOnce`;
- os testes de integração 15 (poda) e 16 (F-02), com os logs `int-copia-marcas-f02.log`, `int-copia-marcas-f02b.log` e `mutantes-backend-poda.log`;
- a isenção de índices em `firestore.indexes.json` e a remoção de `observeDependentRead`;
- as §4, §6 e §10 de `DESENHO-MARCAS-B03.md`, as §3 e §6 de `BACKUP_RESTORE_DR.md`, o rascunho `evidencia/plano-20-18.md` e `respostas-revisao-arquitetura-1.md`.

Os hashes dos arquivos lidos estão em `hashes-rodada-2.txt`.

**Pacotes e execução:**
- Gerei os pacotes das funções reais com o `esbuild` do próprio repositório, nesta pasta: `build/backend-r2.cjs`, copiado para `build/backend.cjs`, e `build/client-r2.cjs`, copiado para `build/client.cjs`.
- Não toquei em `functions/lib` do WT, não subi Emulator e não usei rede nem Firebase.
- Rodei tudo em prioridade baixa (`nice`) enquanto o `verify:all` rodava.

**O que a árvore muda em relação à última leitura da rodada 1.**
- **No backend:** só a poda, nos módulos do caminho da prova (`projectionMarks.ts` e `periods.ts`). O diff dos pacotes contém apenas `pruneMarkDoc` e a troca de `markDoc` por `pruneMarkDoc(markDoc, liveGenerations)` no `transaction.set` da marca.
- **No cliente:** o pacote do caminho da prova (`projectionProof`, `incomeBasis`, `consistency`) é idêntico ao da rodada 1.
- **Inalterados:** `rebuild.ts`, com a correção do A01, e `projectionProof.ts`, com a defesa do A02.

**Modelo aleatório da rodada 2** (`modelo-r2.cjs`, `modelo-r2-duas.cjs`, `mundo.cjs`):
- É o mesmo da rodada 1, agora com o gatilho podando (função real) e a publicação com a conferência do A01. Os cenários têm:
  - uma reconstrução ou até três seguidas;
  - janela de 0, 8 ou 50 ms entre o `serverTimestamp` do corte e o commit do checkpoint;
  - entregas fora de ordem, repetidas, atrasadas para antes do corte e durante a preparação;
  - recomeços e preparação abandonada;
  - exclusão física com recriação.
- Ganhou uma **sombra** sem poda: a última versão de cada componente (posição, geração) já gravada.
- Depois de cada entrega, commit de página, checkpoint e publicação, toda componente da geração vigente e da preparada (pelo estado atual) tem de estar na marca, igual à última gravada. Qualquer perda conta como `perdasDePoda`.

## Resultado do modelo na árvore final

Cada variante tem 20.000 cenários.

| Variante | Perdas de componente viva | Provas verdadeiras | Violações | Finais sem prova sem exclusão física |
| --- | ---: | ---: | ---: | --- |
| 1 reconstrução, janela 0 | 0 | 127.161 | **0** | nenhum |
| 1 reconstrução, janela 8 ms | 0 | 127.390 | **0** | nenhum |
| 1 reconstrução, janela 50 ms | 0 | 127.771 | **0** | nenhum |
| até 3 reconstruções, janela 0 | 0 | 124.686 | **0** | nenhum |
| até 3 reconstruções, janela 8 ms | 0 | 125.031 | **0** | nenhum |
| até 3 reconstruções, janela 50 ms | 0 | 124.802 | **0** | nenhum |

O total é de 756.841 provas verdadeiras e nenhuma violação. A poda atua de fato: num lote de 3.000 cenários com até 3 reconstruções, removeu 732 componentes, e nenhuma delas era viva.

**O detector foi validado com dois mutantes da poda, na pasta `build/mutantes/`:**
- **Poda pelas gerações do evento** (`markGenerationsFor`), em vez do estado: 436 perdas em 800 cenários. Não houve prova falsa, mas houve recusas. É o erro que o pedido mandou descartar, e o código não o comete.
- **Poda que guarda só a vigente:** 318 perdas e **4 provas verdadeiras com valor errado**.

## Poda do gatilho (`pruneMarkDoc`): conferência

O conjunto mantido é `[state.categoryGeneration, state.categoryStaging?.generation]`, tirado do estado lido no mesmo `getAll` da transação do gatilho, e não das gerações do evento. Âncoras e cadeias são filtradas pelo `g`.

1. **A âncora da preparada sobrevive a uma entrega anterior ao corte durante a preparação.**
   - A entrega só alimenta a vigente, porque `eventTime ≤ corte`. Mesmo assim, a preparada está no conjunto mantido, porque vem do estado.
   - Coberto pelo teste 15, pela sombra do modelo (0 perdas) e pelos mutantes B13 a B16 (5/5 mortos).
2. **Recomeço e preparação abandonada.**
   - O id abandonado nunca volta: o recomeço sempre gera um `rebuildId` novo, e a publicação exige `categoryStaging.generation === checkpoint.rebuildId`. As componentes dele saem na próxima regravação, e ninguém as lê.
   - As componentes da tentativa nova só existem depois do commit do checkpoint dela. Para um gatilho com o estado velho podá-las, ele teria de ler o estado antes desse commit e a marca depois de um commit de página da tentativa nova. Isso não é serializável: o gatilho lê marca de entrega, estado e marca num só `getAll` e segura as travas, e o checkpoint e o commit da página esperam ou o fazem recomeçar.
3. **Janela do A01.**
   - Um gatilho serializado antes do commit do checkpoint não tem a preparada no conjunto mantido, mas também não há componente dela para perder.
   - O evento que ele aplicou sem alimentar a preparada é recusado na publicação (`post_cutoff_event_missed_staging`), o que vale também para a janela do checkpoint de recomeço.
   - No modelo, com 8 e 50 ms: 0 violação e 0 perda.
4. **O cliente nunca precisa de uma componente podada.**
   - Os meses lidos no instante `c` levam `G = state.categoryGeneration(c)`, porque a publicação regrava todos os meses e o estado num commit.
   - Entre o checkpoint de G e a publicação, a preparada é G. Depois, G é a vigente. Logo, toda regravação entre a primeira componente de G e `c` tem G no conjunto mantido.
   - A regra `superseded` do cliente só recusa. Como a leitura é atômica, a poda pode, no máximo, tirar uma recusa conservadora; nunca cria prova errada.

## Teste 16 (F-02) e demais mudanças

- **Teste 16.**
  - O corpo do gatilho lê a marca e segura a transação aberta por 500 ms enquanto a página tenta o commit da âncora com merge, sem ler a marca.
  - Em produção, com travas pessimistas, a página espera ou faz o gatilho recomeçar. No Emulator, ela esperou: o gatilho fez o commit na 1ª tentativa (`int-copia-marcas-f02b.log`, 16/16).
  - O estado final é coerente: a âncora tem a impressão da base, e a cadeia tem raiz `event` com a mesma base e o nó posterior ao corte. A ordem inversa (página antes da leitura do gatilho) é segura por construção: o gatilho lê a âncora e a mantém.
  - A falha da 1ª execução (`int-copia-marcas-f02.log`) é uma asserção do próprio teste, como foi registrado.
- **Isenção de índices.** Os seis campos da marca (`schemaVersion`, `workspaceId`, `transactionId`, `anchors`, `chains`, `updatedAt`) ficam com `indexes: []`. Nada consulta a coleção: o backend e o cliente leem por id e as Rules negam `list`. Não há impacto na prova.
- **`observeDependentRead`:** não restou nenhuma referência em `src`, `tests` ou `e2e`.
- **Desenho.**
  - §4 (poda) e §6 (F-02): conferem com o código.
  - §10, F-03: condição para mudanças futuras das regras de efeito. Conferi que a R3 não muda nenhuma das duas regras:
    - `cashPeriodDeltaFor` e `isUnsettledCashEntry` são idênticos aos do `HEAD`;
    - os `cashEffect.ts` de domínio não têm diff;
    - `incomeBasis.ts` não mudou desde a base da R2A.
  - §10, F-04: o argumento está correto sob a INV-M e coincide com a rodada 1. A defesa do cliente sozinha não cobria a leitura por id anterior à criação, mas isso só pesa sem a INV-M, e o A01 foi corrigido.
- **`BACKUP_RESTORE_DR.md`, §3 e §6.** O texto agora diz o que a sonda mostra: com meses de um instante e marcas e lançamentos de outro, a prova pode sair verdadeira com valor errado, e a reconstrução vem antes de reabrir o acesso. Na restauração parcial, meses e marcas nunca são reescritos a partir do banco restaurado. A sonda `sonda-a02-importacao-inconsistente.cjs` continua dando prova falsa nesse cenário fora do produto, como documentado.

## Achados novos (rodada 2)

- **N01 — INFO — preparação abandonada sem nova invocação continua "viva".**
  - `categoryStaging` só é trocado ou apagado por uma nova invocação da reconstrução. A verificação de 24 h (`isStale`) só roda dentro dela.
  - Se o operador não volta, o gatilho continua alimentando a cadeia e as categorias dessa geração depois do corte, e a poda mantém as impressões dela. Isso custa escritas e retém pseudônimos sem finalidade.
  - Não afeta a solidez e o comportamento vem da P5-C1. Sugestão: registrar no risco, ou descartar a preparação vencida numa rotina de manutenção.
- **N02 — INFO — números divergentes no rascunho da §20.18.** "Até 31 releituras por hora por estimativa montada" (Custos) contra "35 por hora por sessão" (RR-R3-01 e as respostas). O agendador dá 5 releituras seguidas e depois uma a cada 120 s: 35 na primeira hora e 30 por hora depois.

## Estado dos achados da rodada 1

| ID | Severidade | Estado na árvore congelada | Conferência |
| --- | --- | --- | --- |
| A01 | HIGH | **corrigido** | `rebuild.ts` igual ao da rodada 1. Sonda: com a janela, a publicação recomeça (`post_cutoff_event_missed_staging`), e sem a correção o cliente recusa. Modelo com poda: 0 violação com 8 e 50 ms. |
| A02 | MEDIUM | **corrigido** (cliente), com o resíduo operacional documentado | A sonda de dados sem marca dá `recusada (content)`. A importação inconsistente continua dando prova falsa, agora descrita corretamente no DR (§3 e §6) e no desenho (§10), com reconstrução antes de reabrir o acesso. |
| A03 | LOW | **corrigido** | Sonda: os três conflitos e o estouro registram `markRecoveryNeeded`. |
| A04 | LOW | **aceito como risco** RR-R3-01, sem mudança de código | A sonda da pendência eterna continua sem sinal (`markRecoveryNeeded: false`). O alerta e a exibição ficam para a P7. Não bloqueia: a tela fica em reais. |
| A05 | INFO | **corrigido no desenho** (§3, §6, §7 e §10); a §20.18 só existe como rascunho | O plano mestre não muda desde as 16:26. O rascunho `evidencia/plano-20-18.md` precisa entrar no plano no fechamento. |
| A06 | INFO | **corrigido** | Só o comentário de `isBackendOwnedCollection`; a regra está igual. |
| A07 | INFO | **classificado** (RR-R3-02) | A sonda de paridade continua igual: `VectorValue` é recusado dos dois lados. |

## Arquivos desta rodada

Todos neste diretório:
- **Parecer:** `PARECER-ARQUITETURA-R3-RODADA-2.md` e `hashes-rodada-2.txt`.
- **Modelo:** `modelo-r2.cjs`, `modelo-r2-duas.cjs`, `mundo.cjs` (com sombra e contagem de podas; a versão da rodada 1 está em `mundo-r1.cjs`) e `rodar-modelos-r2.sh`.
- **Resultados:** `rodar-modelos-r2.out`, `r2-*.log` e `sonda-*-r2.log`.
- **Pacotes:** `build/` e `build/mutantes/`.
