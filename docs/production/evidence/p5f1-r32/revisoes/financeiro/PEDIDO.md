# Revisão financeira — P5-F.1-R3.2 (Frente A, RR-R31-05)

Leia antes `<scratchpad>/p5f1r32/revisoes/COMUM.md` (instruções comuns, obrigatórias). Sua pasta: `<scratchpad>/p5f1r32/revisoes/financeiro`.

Execute a skill `financial-domain-integrity` (leia `<scratchpad>/wt-p5f1-r32/.claude/skills/financial-domain-integrity/SKILL.md` e a
referência dela inteira) sobre a mudança R3.1 → R3.2, no estado final da árvore sob revisão. Primeira linha do
parecer: exatamente `PASS — Financial domain integrity` ou `FAIL — Financial domain integrity`.

Pontos que o pedido do usuário exige e que você deve confirmar com evidência (código e testes):
1. Nenhuma estimativa `ready`/`done` é exibida como conversão atual sem a confirmação do servidor exigida, em toda
   janela (1, 3, 6, 12 meses e mês corrente), com uma base ou duas, com ou sem lançamentos desconsiderados.
2. Os dez cenários do pedido: cache aquecido antes do primeiro retorno do servidor; retorno à página e remontagem;
   reativação do modo tempo de trabalho; troca de workspace; sem conexão; escuta encerrada com erro; divergência
   persistente entre base e projeção depois das releituras; janelas de 1, 3, 6 e 12 meses; com e sem desconsiderados;
   retorno à conversão depois de confirmação válida. Para cada um, aponte o teste que o cobre e se ele reprova na R3.1.
3. A passagem de tempo não prova nada; duas releituras não transformam divergência persistente em aceitação.
4. O estado legitimamente indisponível (sem bloco exato, nenhuma conversão) continua aparecendo como está.
5. O mecanismo de marcas financeiras (regras 4 e 5, `projectionProof.ts`) e a correção do R3-AUD-01
   (`holdEstimate`, nenhuma estimativa anterior no lugar da atual) estão preservados.
6. Mês corrente: a série soma os dias até a data de referência e a projeção traz o mês inteiro; a igualdade depende
   de não haver lançamento confirmado com data futura (decisão D-29). Confira nos contratos do backend
   (`functions/src/**/contracts.ts` e equivalentes de caixa, empréstimos, cartões, recebíveis, recorrentes e contas)
   se isso é garantido; se houver caminho que grave receita confirmada com data futura, é achado.
7. Dinheiro em centavos inteiros; nenhuma escrita nova; nada gravado em DTOs, saldos, relatórios, ledger ou auditoria.
8. Testes: os novos reprovam na R3.1 e passam na R3.2; os substituídos não foram enfraquecidos; mutantes das novas
   condições (`mutantes-cliente-r32.log`) são mortos.
