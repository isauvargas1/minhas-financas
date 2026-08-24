# Checklist do gate de regressão

## 1. Escopo e base Git

- Registrar branch, `HEAD`, status e arquivos untracked.
- Resolver a base na ordem: base informada pelo usuário/PR; upstream da branch; branch remota padrão; branch padrão local. Confirmar que a referência existe.
- Calcular o merge-base e inspecionar `git diff --stat`, `--name-status`, diff textual e diff staged/unstaged. Incluir conteúdo relevante de arquivos untracked.
- Classificar componentes e funcionalidades afetadas direta e adjacentemente: frontend, Functions, dados, regras, rotas, contratos e configuração.
- Comparar também alterações em testes, snapshots, fixtures, cobertura, scripts de CI/build e flags que possam mascarar regressões.

## 2. Proibições e revisão semântica do diff

Falhar ao detectar, sem justificativa de requisito explícita e cobertura equivalente ou superior:

- remoção, skip, `only`, desativação, renomeação evasiva ou redução de abrangência de teste;
- redução de threshold, exclusão adicional de cobertura ou alteração de baseline para esconder regressão;
- asserção menos específica, erro ignorado, mock excessivo, retry/timeout aumentado para ocultar flakiness;
- tipo, schema, regra de segurança, autorização, validação de entrada ou invariante relaxada;
- caminho crítico convertido em no-op, fallback permissivo ou feature flag que evita o comportamento testado.

Pesquisar mecanismos equivalentes do framework, não apenas palavras literais. Todo skip deve ter teste identificado, motivo, evidência ambiental reproduzível e impacto. Motivo funcional, flakiness ou falta de tempo não é causa ambiental.

## 3. Matriz obrigatória de execução

Descobrir os comandos em manifests, configuração e CI. Preferir comandos oficiais do repositório. Registrar comando, diretório, exit code, duração e resumo. Executar em ambiente limpo/reprodutível quando seguro.

1. **Typecheck:** frontend e demais pacotes TypeScript aplicáveis; build não conta como typecheck separado se existir comando dedicado.
2. **Build frontend:** build de produção, sem warnings críticos ignorados.
3. **Build Functions:** compilação/build da codebase Firebase Functions.
4. **Testes unitários:** todos os pacotes afetados e suítes compartilhadas relevantes, com cobertura quando configurada.
5. **Testes de integração:** integrações afetadas e adjacentes; usar serviços reais locais/emulados exigidos pelo projeto.
6. **Firebase Emulator:** iniciar os emuladores necessários com projeto não produtivo, aguardar readiness, executar consumidores e encerrar processos. Não apontar para produção.
7. **Firestore Rules tests:** executar a suíte de regras contra Emulator. Ausência da suíte quando regras ou acesso Firestore estão no escopo é `FAIL` e risco explícito.
8. **Playwright E2E:** executar a suíte relevante e, para mudança ampla/crítica, a suíte completa. Preservar traces, screenshots e vídeos de falha.
9. **Smoke adjacente:** testar o fluxo alterado, um fluxo anterior/posterior, estados de erro e ao menos uma funcionalidade que compartilhe rota, componente, contrato, coleção ou Function.

Se uma camada obrigatória não tiver script, localizar a configuração/suíte e executar diretamente. Se ela realmente não existir, não inventar um teste superficial: registrar lacuna e emitir `FAIL`.

## 4. Cobertura, skips e qualidade dos resultados

- Comparar métricas com a base ou baseline versionada: linhas, branches, funções e statements, além de cobertura dos arquivos alterados. Qualquer redução é `FAIL`.
- Auditar saída por skipped/pending/todo/disabled/quarantined e também fontes/configurações alteradas.
- Distinguir sucesso real de "no tests found", suíte filtrada, cache indevido, processo morto, timeout ou serviço indisponível.
- Reexecutar falha apenas para diagnosticar determinismo; uma passagem posterior não apaga flakiness. Reportar ambas e manter `FAIL` salvo causa ambiental comprovada.

## 5. Superfícies inesperadas

Comparar contra a base e contra o requisito declarado:

- **UI:** hierarquia, layout, responsividade, acessibilidade, estados loading/empty/error, foco e interações; usar evidência visual quando aplicável.
- **Textos:** rótulos, mensagens, moeda/data, traduções e conteúdo de erro.
- **Rotas:** paths, parâmetros, redirects, guards, deep links e navegação de retorno.
- **Contratos:** tipos públicos, payloads, status/erros, nomes e semântica de campos, documentos Firestore, índices, eventos e compatibilidade de consumidores.

Toda alteração não requerida deve ser explicada e validada; caso contrário, é `FAIL`.

## 6. Decisão e relatório

Emitir um destes cabeçalhos exatos: `PASS — regression release gate` ou `FAIL — regression release gate`.

Incluir:

1. **Escopo Git:** base, merge-base, `HEAD`, worktree e resumo do diff.
2. **Evidências:** tabela com etapa, comando/inspeção, resultado, duração e artefato/log relevante.
3. **Achados:** violações e regressões, com arquivo/linha quando possível.
4. **Skips e cobertura:** contagens, justificativas comprovadas e comparação com baseline.
5. **Mudanças de superfície:** UI, textos, rotas e contratos, inclusive “nenhuma” com fundamento.
6. **Riscos residuais:** apenas riscos que permanecem após o gate, com impacto e mitigação; usar “nenhum identificado” se apropriado.
7. **Bloqueadores para PASS:** ações objetivas necessárias quando a decisão for `FAIL`.

Não suavizar `FAIL` como “passou com ressalvas”. Avisos só podem coexistir com `PASS` quando não representam etapa omitida, regressão, perda de cobertura, skip injustificado ou risco material não validado.
