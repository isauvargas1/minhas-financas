# Revisão adversarial de qualidade e arquitetura — P5-F.1-R3.2 (Frentes A e B)

Leia antes `<scratchpad>/p5f1r32/revisoes/COMUM.md` (instruções comuns, obrigatórias). Sua pasta: `<scratchpad>/p5f1r32/revisoes/adversarial`.

Papel: tentar quebrar a correção. Primeira linha do parecer: `VEREDITO: PASS` ou `VEREDITO: FAIL` (FAIL com qualquer
achado HIGH ou MEDIUM em aberto). Inclua também, numa seção própria, o veredito da skill `firestore-scale-cost-review`
(leia `<scratchpad>/wt-p5f1-r32/.claude/skills/firestore-scale-cost-review/SKILL.md` e a referência dela) sobre o efeito da mudança nas
escutas e leituras, começando a seção com `PASS — Firestore scale/cost review` ou `FAIL — Firestore scale/cost review`.

Procure, com evidência:
1. Qualquer caminho em que uma conversão (estimativa `done` com conversão) chegue à tela sem retorno do servidor
   válido para a montagem, a conta, o workspace e os meses atuais: todos os consumidores do gancho
   (`WorkTimeContext`, `display.tsx`, `Header`, `EstimateDetails`, prévia de Configurações, assistente, editor de
   receitas) e o cache do React Query.
2. Corridas no tempo de vida de `confirmed` em `basisSync.ts`: ordem entre retorno do cache e do servidor, reabertura
   da escuta (`listenAttempt`), dependências do efeito, chave `${syncKey}\n${monthsKey}`, fechamento obsoleto
   (closure) e o comportamento real do SDK do Firestore com `includeMetadataChanges` (queda e volta da conexão,
   `hasPendingWrites`). A conversão volta sozinha quando o servidor confirma (sem ficar presa em "calculando")?
3. Regressões: algum estado que antes convertia corretamente e agora nunca converte, mesmo com o servidor disponível.
4. Qualidade dos testes: força das asserções, testes substituídos (veja COMUM.md), guardas estruturais frágeis,
   cobertura dos mutantes (rode os seus, se achar lacuna).
5. Frente B como código: `tools/e2e/grupos.mjs`, `tools/e2e/executar-em-grupos.mjs`, o teste com `npm`/`npx` falsos,
   `playwright.config.ts`. Algo que deixe uma execução incompleta ou com falha terminar com saída 0?
