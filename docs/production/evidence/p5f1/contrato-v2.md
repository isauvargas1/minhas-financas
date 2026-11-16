# P5-F.1 — Contrato v2 da preferência privada

Documento único por usuário: `users/{uid}/private_preferences/work_time_equivalent`. Só o titular, com conta ativa, lê, grava e apaga. Sem `list` e sem outro id na subcoleção. Nenhuma Function lê o documento.

O v2 substitui o v1 (renda e carga digitadas) sem migração, compatibilidade ou leitura dupla: as Rules não aceitam mais o v1, e o cliente o trata como "fora do contrato" (valores em reais).

## Campos (exatamente estes; `hasOnly` + `hasAll` nas Rules)

| Campo | Tipo | Valores aceitos |
| --- | --- | --- |
| `schemaVersion` | inteiro | `2` |
| `enabled` | booleano | — |
| `displayMode` | texto | `money`, `time` |
| `estimateMode` | texto | `habitual`, `current_month` |
| `historyMonths` | inteiro | `1`, `3`, `6`, `12` |
| `incomeWorkspaceId` | texto | `[A-Za-z0-9_-]{1,128}` |
| `allowBusinessIncome` | booleano | confirmação expressa para fonte PJ |
| `excludedIncomeIds` | texto | lista de ids separados por `,`; até 50; até 6.449 caracteres |
| `routines` | texto | 1 a 3 rotinas separadas por `;`; até 400 caracteres |
| `worksOnHolidays` | booleano | — |
| `uf` | texto | vazio ou uma das 27 UFs |
| `municipality` | texto | vazio ou até 60 caracteres: letra, depois letras, espaço, ponto, apóstrofo e hífen |
| `localHolidays` | texto | até 40 itens separados por `;`; até 440 caracteres |
| `exceptions` | texto | até 120 itens separados por `;`; até 3.400 caracteres |
| `updatedAt` | timestamp | igual a `request.time` (hora do servidor) |

Não há mapas nem listas. Nada derivado (renda, minutos, valor da hora, totais) cabe no documento: um campo extra, mesmo com esses nomes, é negado pelas Rules (`tests/firestore/work-time-p5f.rules.integration.test.mjs`).

## Gramáticas (`src/modules/work-time/grammar.ts`; as mesmas peças em `firestore.rules`)

- **Data:** `AAAA-MM-DD` real de 2000 a 2099 (dias por mês e anos bissextos validados pela própria expressão).
- **Dia da rotina:** `-` (sem trabalho), `D<minutos 1–1440>` (duração sem horário) ou `HH:MM-HH:MM/<intervalo 0–1440>` (janela; fim antes do início cruza a meia-noite; fim igual ao início é um turno de 24 h).
- **Rotina:** semanal `W:` + 7 dias (segunda a domingo) separados por `,`; escala `C:<data de referência>:<1–28>x<1–28>:<dia de trabalho>`.
- **Exceção:** `F`/`O`/`A` + data ou `<início>/<fim>` (férias, folga, ausência); `H<data>` (feriado trabalhado); `P<data>+<minutos>` e `E<data>+<minutos>` (plantão e hora extra, somam); `R<data ou intervalo>=<minutos>` (jornada reduzida, limita os dias de trabalho); `S<data>=<minutos 0–1440>` (alteração de escala, define o dia).
- **Feriado local:** data `AAAA-MM-DD` ou anual `MM-DD` (29/02 anual não é aceito).
- **Exclusões:** ids `[A-Za-z0-9_-]{1,128}` separados por `,`.

As Rules limitam cada expressão a 100 agrupamentos; por isso a lista é conferida com uma cópia só do item: `(texto + separador)` casa `(?:item<sep>)+`. Como nenhum item contém o separador, a linguagem é a de `item(<sep>item)*`. A guarda `tests/unit/work-time-guard.test.ts` avalia as funções `wt*` das Rules e compara cada padrão com o do cliente; o corpus compartilhado `tests/fixtures/work-time-grammar-cases.json` (121 casos) roda no cliente e nas Rules (Emulator). Em 13 casos as Rules aceitam e o cliente recusa, por desenho (semântica que as Rules não alcançam; ver abaixo); nenhum caso é aceito pelo cliente e negado pelas Rules.

## O que só o cliente confere (semântica)

Fim antes do início, intervalo acima de 366 dias, sobreposição de exceções do mesmo tipo, repetição, forma canônica (ordem e sem `X/X`), pausa maior ou igual à janela, rotina sem nenhum dia de trabalho. Um documento que passe pelas Rules mas falhe aqui só pode ter sido gravado fora do app pelo próprio titular; a interface o trata como fora do contrato (valores em reais, aviso e opção de excluir ou configurar de novo).

## Gravação

`saveWorkTimePreference` grava `workTimePreferenceFields(preferência)` + `updatedAt: serverTimestamp()` com `setDoc` (documento inteiro); `workTimePreferenceFields` só devolve o que o `parseWorkTimePreference` aceita. A troca de modo pelo Header grava só `displayMode` e `updatedAt` (`updateDoc`). A exclusão apaga o documento, que é tudo o que o recurso grava.
