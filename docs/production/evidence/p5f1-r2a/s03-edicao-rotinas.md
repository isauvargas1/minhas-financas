# P5-F.1-R2A — S03: o que põe Configurações em edição (testes de comportamento)

## Origem

- **Revisão 5, S03 (INFO).** Dois comportamentos do Q02 da R1 estavam certos pela leitura de código, mas sem teste:
  - a jornada para aplicar a vários dias, mudada sem "Aplicar", não deve pôr a tela em edição;
  - a digitação inválida deve pôr.

  Dois mutantes semânticos passavam nos 158 testes de unidade e, pela leitura, no E2E:
  - `mut-tpl` (a chave inclui a jornada para aplicar);
  - `mut-tplfail` (um ramo que engole a recusa por digitação inválida).
- **Parecer de 2026-11-06:** "Testes faltantes". Pede teste de comportamento, não só de revisão de código.

## O contrato

1. Uma configuração gravada que o editor recusa ao montar (rotinas que se cruzam com intervalo) não é edição. A tela abre fora de edição:
   - título "Valor estimado da sua hora";
   - sem "Nada foi salvo ainda." nem "Descartar alterações";
   - salvar desabilitado.
2. Mudar só a jornada para aplicar a vários dias, sem aplicar, não muda as rotinas, a chave nem o resultado. A tela continua fora de edição.
3. "Aplicar aos dias marcados" muda os dias de trabalho marcados, e só eles. A recusa passa a ser uma edição.
4. A digitação inválida (um dia sem "Fim", um intervalo maior que a jornada, um ciclo fora de 1 a 28) é edição, com a mensagem do problema na rotina. Corrigir de volta ao gravado desfaz a edição.
5. "Descartar alterações" volta ao gravado, com a jornada para aplicar de volta a 14:00 (a do primeiro dia de trabalho), e tira a tela da edição.

## O que mudou no código

- **A lógica pura saiu do componente.** O modelo, a conversão, a chave, "Aplicar" e o resultado com `edited` foram de `RoutineEditor.tsx` para o módulo puro `src/modules/work-time/routineModels.ts`:
  - `modelOf`, `routineOf`, `routinesKey`, `applyTemplate` e `editorResultOf`.
  - A tela chama essas mesmas funções. O comportamento e a aparência não mudam: as linhas foram movidas, não reescritas.
- **A guarda** (`tests/unit/work-time-guard.test.ts`) confere a nova fiação:
  - a chave da montagem;
  - `editorResultOf` a cada mudança;
  - `applyTemplate` no botão;
  - nenhuma cópia local do modelo no componente;
  - e, no módulo, `edited` e as duas recusas com `edited`.

## Os testes

- **Unidade** (`tests/unit/work-time-preference.test.ts`, os dois testes "S03 (P5-F.1-R2A)"):
  - contrato 1: recusada ao montar, sem edição;
  - contrato 2: a jornada mudada sem aplicar, válida ou inválida, dá o mesmo resultado da montagem;
  - contrato 3: aplicar muda segunda a sexta para 11:00–15:00, mantém sábado e domingo sem trabalho e marca edição;
  - contrato 4: "Fim" apagado em segunda, intervalo de 300 min na quarta e ciclo com 0 dia de folga, cada um com a mensagem exata, e a correção volta a `{ ok: true }`;
  - contrato 5: montar de novo devolve o resultado da montagem, com a jornada em 14:00.
- **E2E** (`e2e/work-time-p5f.spec.ts`, "B02 (P5-F.1-R1)"), depois do `reload` com a configuração gravada que se cruza:
  - o "Fim" da jornada para aplicar está em 14:00; é mudado para 15:00, sem aplicar, e a tela continua fora de edição (`notEditing`), com o aviso;
  - "Aplicar" põe em edição, e "Descartar" volta ao gravado, com a jornada em 14:00;
  - apagar o "Fim" de segunda na rotina 3 põe em edição: "Prévia com as alterações", a nota de não salvo, a mensagem "Rotina 3, segunda-feira: Use horários no formato 08:00." e salvar desabilitado;
  - "Descartar" volta a 14:00, e nada é gravado.

## Antes × depois

| Comportamento | R1 (`08d8c5a2`) | R2A |
| --- | --- | --- |
| Jornada para aplicar mudada sem aplicar, numa configuração gravada recusada | certo pela leitura, sem teste; `mut-tpl` sobrevive | testado em unidade e no E2E; `mut-tpl` morre nos dois |
| Digitação inválida numa rotina | certo pela leitura, sem teste; `mut-tplfail` sobrevive | testado no E2E (`mut-tplfail` morre); a regra de `edited`, também em unidade |
| Jornada em 14:00 depois de "Descartar" | sem teste | testado no E2E e em unidade |

Os mutantes e os resultados estão em `mutantes.md`.
