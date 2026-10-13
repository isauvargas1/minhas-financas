# Rodada 3: complemento depois do `verify:all`

Resposta do revisor, somente leitura, às perguntas que ficaram pendentes do `verify:all`.

**Q14 (gate integral na árvore final): OK.** O `verify:all` terminou com `exit=0`, rodando das 14:58:50Z às 15:43:50Z (`verify-all-final.log.meta`). Totais conferidos:
- 2.692 testes `node --test` (661 das Functions, 789 do frontend, 969 de integração e 273 de ferramentas e Rules) e 191 do Playwright, num total de 2.883;
- nenhuma falha, `skip`, `todo`, cancelamento ou `flaky`; o lint tem 0 erros.

O `verify:all` rodou sobre a árvore `025e13ef`. Diante da base, ela tem só os 28 arquivos revisados. Diante da `4940333e`, só 7 arquivos de evidência. O working tree de agora só difere dela em 3 arquivos de evidência. A primeira execução foi interrompida pelo limite de 30 min do executor, não por falha, e não conta para o gate.

**Q15 (regressão em módulo não relacionado): OK.** A suíte E2E inteira passou, com 191/191 e todas as specs dos outros módulos, assim como a integração (969/969) e as Rules (273/273), com o roteador global ativo. A spec F original e `notifications-exit-race` também passaram.

**N4: adequado.**
- O §4.1 ganhou "Riscos residuais (revisões 2 e 3)", com L2a, L2b, L5 (inclusive o caso do "Excluir para mim"), N1, N2, N3 e L8b.
- A frase do foco no §4 (linha 84) está corrigida.
- A rodada 3 está em `revisao-independente.md`.
- Condição: o §4.1 diz "registrados também no plano mestre (§20.12)", e essa seção ainda não existe. A frase só fica verdadeira quando a 20.12 for escrita.

**N1–N3: registro adequado**, com cenário e correção recomendada; não mudar o código depois do gate é coerente. Dois pontos:
- No N1, "Antes, o mesmo gesto abria o aviso" é exato quando a caneta solta sobre o próprio aviso. Se soltar fora dele, antes nada acontecia.
- O N3 se apoia no framer-motion fixado em `10.16.4`, e isso confere: o `package.json` traz a versão sem `^` e o lockfile também a fixa.
