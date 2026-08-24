# Checklist de revisão de UI de produto em PT-BR

## 1. Escopo e evidência

- Registrar requisito, base Git, merge-base, `HEAD`, status e resumo dos arquivos alterados.
- Inspecionar diff committed, staged, unstaged e arquivos untracked relevantes.
- Mapear telas, componentes, rotas, modais, formulários, notificações e fluxos afetados direta e adjacentemente.
- Localizar testes, stories, snapshots e contratos associados. Não aceitar snapshot atualizado como prova única de correção.
- Para cada achado, citar arquivo e linha; para comportamento, registrar teste/comando e resultado, anexando screenshot, trace ou vídeo quando útil.

## 2. Português brasileiro e linguagem financeira

Verificar todo conteúdo visível ou anunciado ao usuário final, inclusive títulos, labels, placeholders, ajuda, tooltips, botões, tabelas, filtros, validações, toasts, diálogos, aria-labels, loading, vazio, erro e sucesso.

- Exigir português brasileiro natural, ortografia e acentuação corretas, tom profissional e instruções objetivas.
- Usar terminologia financeira consistente entre telas e fluxos. Conferir significado, não apenas grafia: fatura, lançamento, receita, despesa, saldo, limite, vencimento, pagamento e termos equivalentes não são intercambiáveis automaticamente.
- Formatar moeda, números, percentuais e datas conforme o contexto brasileiro e sem ambiguidade.
- Evitar inglês acidental, texto provisório, chave de tradução, código de erro e mensagens contraditórias.
- Aceitar marca, sigla ou termo consagrado somente quando fizer sentido para o público final e estiver consistente no produto.

Falhar se conteúdo destinado ao usuário estiver em outro idioma ou for obscuro, informal, impreciso ou inadequado ao contexto financeiro.

## 3. Isolamento de detalhes internos

Falhar se a interface expuser detalhes como Firebase, Firestore, API, stack trace, exception, collection, callable, nomes de Functions, códigos internos, paths, payloads ou mensagens brutas de SDK/backend.

- Rastrear caminhos de erro desde reject/throw/resposta até catch, estado e renderização.
- Exigir tradução de falhas internas para mensagem segura, compreensível e, quando possível, acionável.
- Preservar detalhes diagnósticos apenas em logging/telemetria adequados, sem dados sensíveis e sem exibição ao usuário.
- Verificar fallback para erro desconhecido, indisponibilidade, timeout, permissão, validação e conflito.

Não “corrigir” estética interna: identificadores, tipos TypeScript, nomes de APIs, funções, campos, eventos e contratos devem permanecer tecnicamente estáveis salvo mudança funcional explícita. Strings internas não renderizadas não precisam ser traduzidas.

## 4. Estados e feedback

Para cada operação assíncrona ou coleção alterada, validar:

- **Loading:** feedback imediato, sem tela congelada; ação protegida contra duplicidade; rótulo/indicador acessível; layout sem salto indevido.
- **Empty:** distinguir ausência legítima de dados de erro; explicar o estado e oferecer próxima ação quando aplicável.
- **Error:** mensagem segura e contextual; dados digitados preservados quando seguro; retry/correção possível; foco ou anúncio adequado.
- **Success:** confirmar o resultado real sem antecipação enganosa; atualizar dados e controles; evitar toast duplicado ou estado obsoleto.

Validar transições loading→success, loading→empty e loading→error, não apenas estados isolados. Falhar se feedback visual e resultado persistido divergirem.

## 5. Acessibilidade e modais

- Operar todo fluxo por teclado: Tab e Shift+Tab em ordem lógica, Enter/Espaço quando apropriado, Escape quando permitido e nenhuma armadilha de foco.
- Exigir elementos semânticos nativos ou papel equivalente correto, nome acessível, labels associados, headings hierárquicos e mensagens de estado anunciáveis.
- Não depender somente de cor, ícone ou placeholder para transmitir significado. Conferir contraste e indicação de foco perceptível quando afetados.
- Em modal: mover foco previsivelmente para título ou primeiro controle útil, conter foco enquanto aberto, fechar conforme contrato e devolver foco ao acionador.
- Em validação: associar erro ao campo, anunciar o erro e conduzir foco previsivelmente ao primeiro problema sem apagar dados.

Automação não substitui inspeção do fluxo por teclado. Registrar a sequência exercitada.

## 6. Responsividade e estabilidade visual

- Verificar pelo menos um viewport mobile e um desktop representativos; incluir estados com texto longo, listas vazias/cheias e modal quando aplicável.
- Conferir overflow, truncamento indevido, sobreposição, ordem do conteúdo, alvos de toque, navegação, tabelas/gráficos, teclado virtual e ações fixas.
- Comparar antes/depois com a mesma base de dados, viewport e estado. Separar mudança requerida de regressão colateral.
- Falhar por alteração visual, textual ou comportamental fora do escopo, mesmo que pareça melhoria, salvo requisito ou aprovação explícita.

## 7. Playwright e testes

Quando houver alteração de UI e a aplicação puder ser executada:

1. Executar os testes Playwright existentes do fluxo alterado e dos fluxos adjacentes.
2. Navegar pela versão/base anterior e pela versão posterior em condições equivalentes. Se não for seguro alternar worktrees, usar evidências versionadas ou execução isolada; nunca sobrescrever mudanças do usuário.
3. Exercitar caminho principal, validação, loading, empty, error e success aplicáveis.
4. Repetir por teclado e nos viewports mobile/desktop.
5. Capturar screenshot e/ou trace para diferenças relevantes; usar assertions de conteúdo e comportamento, não apenas screenshot.

Se Playwright não for aplicável, registrar a razão concreta e usar a melhor evidência executável disponível. Ausência de ambiente, fixture ou teste necessário impede `PASS` quando deixar um critério obrigatório sem comprovação.

Executar também typecheck e testes unitários/de integração que cubram formatação, validação, mapeamento de erros e contratos alterados. Confirmar que nenhum teste foi skipped, enfraquecido ou desativado para acomodar a mudança.

## 8. Decisão e relatório

Usar um cabeçalho exato:

- `PASS — revisão de UI de produto em PT-BR`
- `FAIL — revisão de UI de produto em PT-BR`

Incluir:

1. **Escopo:** requisito, base/HEAD, telas e fluxos revisados.
2. **Evidências do código:** tabela com critério, arquivo/linha e conclusão.
3. **Evidências de execução:** comando/teste, viewport ou interação, resultado e artefato.
4. **Comparação antes/depois:** mudanças esperadas e inesperadas em UI, texto e comportamento.
5. **Achados:** severidade, impacto no usuário e evidência reproduzível.
6. **Riscos residuais:** lacunas restantes e mitigação; usar “nenhum identificado” quando apropriado.
7. **Bloqueadores para PASS:** ações objetivas necessárias se a decisão for `FAIL`.

Não emitir “PASS com ressalvas” quando faltar evidência obrigatória ou existir vazamento técnico, texto inadequado, regressão, problema de acessibilidade/responsividade ou mudança fora de escopo.
