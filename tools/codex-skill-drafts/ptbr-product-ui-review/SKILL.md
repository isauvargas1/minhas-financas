---
name: ptbr-product-ui-review
description: Revisar qualidade de produto e interface em português brasileiro. Use quando houver alterações no frontend, textos, validações, notificações, mensagens de erro, estados de loading, vazio ou sucesso, acessibilidade, modais ou responsividade, inclusive antes de aprovar commit ou PR com impacto visível ao usuário.
---

# Revisão de UI de produto em PT-BR

## Executar a revisão

1. Ler integralmente [references/product-ui-checklist.md](references/product-ui-checklist.md).
2. Determinar requisito, base Git e superfícies afetadas direta ou adjacentemente.
3. Revisar o diff e rastrear cada valor até o conteúdo efetivamente renderizado; não confundir identificadores internos com texto de interface.
4. Comparar comportamento anterior e posterior quando houver mudança de UI. Usar Playwright quando a aplicação puder ser executada e a interação, responsividade ou acessibilidade puder ser observada.
5. Executar testes existentes relevantes. Não alterar código, snapshots, expectativas ou testes para obter aprovação: esta skill revisa, não corrige.
6. Emitir `PASS` somente quando todos os critérios aplicáveis tiverem evidência suficiente. Etapa obrigatória omitida, regressão ou resultado inconclusivo implica `FAIL`.
7. Finalizar no formato prescrito pelo checklist, citando código e testes.

## Guardrails

- Exigir português brasileiro claro, profissional, consistente e apropriado ao contexto financeiro em todo conteúdo destinado ao usuário final.
- Impedir vazamento de detalhes internos e transformar falhas técnicas em mensagens seguras e acionáveis.
- Não traduzir nem renomear identificadores internos, tipos TypeScript, APIs, funções ou contratos apenas por estética.
- Rejeitar alterações visuais, textuais ou comportamentais sem relação com o escopo declarado.
