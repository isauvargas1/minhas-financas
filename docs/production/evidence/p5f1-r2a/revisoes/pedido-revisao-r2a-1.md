# Pedido de revisão independente — P5-F.1-R2A (somente leitura)

Você é o revisor independente do delta corretivo P5-F.1-R2A do projeto Minhas Finanças (SaaS financeiro em pt-BR, React + Firebase).

**Árvores.**
- **Base:** a árvore da etapa anterior (P5-F.1-R1), `08d8c5a2f5141f19d06968737c5f7fdc71c4a45f`.
- **Revisada:** uma cópia da árvore R2A em `ARVORE` (diretório informado abaixo). `node_modules` são links; não instale nada.
- **Delta:** `git -C /home/user/minhas-financas diff --stat 08d8c5a2f5141f19d06968737c5f7fdc71c4a45f <ÁRVORE_R2A>` dá a lista. O diff completo está em `DIFF`.

**O pedido que a R2A atende** (parecer independente de 2026-11-06, em `PARECER`):
- **Frente A (implementada):**
  - fechar o S01/B02 em `src/modules/work-time/calendar.ts`. Segunda 20:00–06:00 reduzida a 8 h com terça 00:00–08:00 não pode ser aceita com 960 min para um trecho de 720. O pedido exige "cálculo matematicamente demonstrável ou recusa explícita da configuração, com mensagem clara em pt-BR", sem truncamento arbitrário e sem quebrar a monotonia das rotinas válidas;
  - completar os testes do S03: a digitação inválida marca a edição; mudar a jornada para aplicar a vários dias sem "Aplicar" não cria edição aplicada;
  - testes de unidade, propriedades e comportamento da interface, preservando os anteriores.
- **Frente B (só desenho):** `PROPOSTA-ARQUITETURAL-B03.md`. Nenhum escritor financeiro, gatilho, Rule ou índice deve ter mudado.

**O que revisar (com evidência; rode sondas e testes só na cópia):**
1. **S01, solidez.** Procure uma configuração **aceita** pelo conferidor (`calendarAmbiguity`) em que as horas de algum dia dependam de onde caíram as horas de uma jornada reduzida da véspera, ou da posição dos intervalos. Valem gerador aleatório, busca dirigida e casos de borda: turnos de 24 h, cíclicas, feriados, alteração de escala, ausência, duas reduções seguidas, primeiro dia do mês e início do período, plantão e hora extra perto de 24 h, durações sem horário. Confira o Teorema 3 e o corolário do dia civil (`docs/production/evidence/p5f1-r2a/s01-vespera-reduzida.md`).
2. **S01, monotonia.** Procure `C` e `C' = C + rotina`, ambos aceitos, com menos horas em `C'` na janela da estimativa (o primeiro mês abrindo o período). Confira a prova estendida (§6 do mesmo documento).
3. **S01, conferidor.** Procure um dia sem cálculo seguro, a partir de 12 meses antes de hoje até 2099, que o conferidor não ache. Confira também se as causas (`reduced_eve`, `neighbor`, `period_start`, `routines`) e as mensagens correspondem ao caso.
4. **S01, recusa conservadora.** A documentação admite recusar casos determinados (§5). Avalie se isso é aceitável diante do pedido e se a frequência está medida e declarada com honestidade.
5. **S01, interface e pt-BR.** Mensagem de `validateDraft`, motivo da estimativa (`ambiguous_reduced_eve`), nome acessível no calendário de exceções. Português, clareza e exatidão. Nenhuma mudança visual fora do necessário.
6. **S03.** Confira:
   - se a extração para `src/modules/work-time/routineModels.ts` preservou o comportamento de `RoutineEditor.tsx` (linha a linha);
   - se os testes novos (unidade e E2E) cobrem os dois comportamentos pedidos e matam os mutantes da revisão 5;
   - se a guarda foi atualizada sem enfraquecer.
7. **Testes anteriores.** Confira que nenhum teste anterior foi removido, relaxado ou pulado. O teste que fixava o RR-R1-03 foi reescrito para o contrato novo: avalie se a reescrita é legítima e está registrada. Nenhum `skip` ou `only`, nenhum timeout aumentado, nenhuma asserção enfraquecida.
8. **Frente B.** Revise `PROPOSTA-ARQUITETURAL-B03.md` contra o código real do backend:
   - `functions/src/triggers/transactions.ts`, `functions/src/cash/periods.ts` e `functions/src/cash/rebuild.ts`;
   - as Rules;
   - as leituras da estimativa.

   Procure falhas no desenho:
   - fora de ordem, reentrega, mudança de mês, reconstrução, falha do gatilho, escrita sem `updatedAt`;
   - custo, segurança e prova do cliente com leitura velha;
   - fatos errados sobre o código.

   Diga se a recomendação atende os "Critérios do desenho B03" do parecer.
9. **Escopo.** Nada no backend financeiro, nas Rules, nos índices nem nas Functions mudou. Nada de deploy, rede ou segredo.

**Restrições.**
- Somente leitura no worktree original (`WORKTREE`). Trabalhe na cópia `ARVORE` e num diretório seu (`SAIDA`).
- Não rode E2E, Emulator nem `npm run dev`/`preview`. Pode rodar `node --experimental-strip-types --test` na cópia e sondas suas.
- Não leia `.env*` nem segredos. Não acesse rede nem Firebase.

**Saída.** Um relatório `SAIDA/revisao-r2a.md` em pt-BR, com:
- achados numerados (T01, T02…), cada um com severidade (HIGH, MEDIUM, LOW ou INFO), evidência (`arquivo:linha`, sonda e saída) e correção sugerida;
- uma matriz final: B02 (S01) resolvido ou não; S03 resolvido ou não; Frente B adequada ou não;
- o veredito global, que deve continuar FAIL enquanto o B03 estiver aberto.

Guarde as sondas e os logs em `SAIDA/sondas` e `SAIDA/logs`. Devolva no fim um resumo curto: achados por severidade e veredito.
