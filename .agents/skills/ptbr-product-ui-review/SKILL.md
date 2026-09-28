---
name: ptbr-product-ui-review
description: Gate bloqueante de qualidade de produto e interface em português brasileiro e de estabilidade visual. Use sempre que uma tarefa alterar, revisar ou aprovar qualquer coisa renderizada ao usuário final — componentes React, telas, textos, labels, placeholders, validações, toasts, notificações, mensagens de erro vindas do backend, estados de loading/vazio/erro/sucesso, modais, acessibilidade, responsividade, formatação de moeda/data — inclusive quando a mudança de UI for consequência de correção de backend, contrato ou estado, e antes de concluir milestone, commit ou PR com impacto visível.
---

# Revisão de UI de produto em PT-BR

Atue como gate bloqueante. Inspecione o diff real, o conteúdo efetivamente renderizado e a execução; nunca aprove por descrição.

## Contexto do projeto

- O frontend autenticado atual deve permanecer **visualmente inalterado**. Mudança de UI só é aceitável quando for estritamente necessária para corrigir integração, estado, validação, segurança ou contrato alterado pelo backend, e deve ser a menor mudança possível. Redesign, ajuste estético, troca de layout, reorganização de navegação ou “melhoria” não pedida é `FAIL`.
- Todo conteúdo visível ao usuário final é pt-BR, inclusive mensagens de erro originadas no backend (`HttpsError`) e textos de estados vazios.
- Execução: `npm run test:e2e` (build E2E contra Emulator, projeto `minhas-financas-local`) e a skill `playwright-cli` para inspeção interativa. Nunca apontar a aplicação para Firebase de produção.

## Fronteiras com outras skills

- Páginas públicas e funil comercial (landing, preços, cadastro, páginas legais, footer, SEO): `saas-commercial-readiness` decide a prontidão comercial; esta skill continua obrigatória para a qualidade do texto em pt-BR e dos estados dessas telas.
- Correção de valores, saldos e totais exibidos: `financial-domain-integrity`. Esta skill verifica apresentação, formatação e coerência do feedback com o resultado persistido.
- Exposição de dados de outro workspace na UI: `multi-tenant-security-review`.

## Executar a revisão

1. Ler integralmente [references/product-ui-checklist.md](references/product-ui-checklist.md).
2. Determinar requisito, base Git e superfícies afetadas direta ou adjacentemente.
3. Classificar cada alteração de UI como **requerida** (vinculada a correção de integração, estado, validação, segurança ou contrato, com justificativa) ou **fora de escopo**.
4. Revisar o diff e rastrear cada valor até o conteúdo efetivamente renderizado; não confundir identificadores internos com texto de interface.
5. Comparar comportamento e aparência antes/depois quando houver mudança de UI. Usar Playwright quando a aplicação puder ser executada e a interação, responsividade ou acessibilidade puder ser observada.
6. Executar testes existentes relevantes. Não alterar código, snapshots, expectativas ou testes para obter aprovação: esta skill revisa, não corrige.
7. Emitir `PASS` somente quando todos os critérios aplicáveis tiverem evidência suficiente. Etapa obrigatória omitida, regressão ou resultado inconclusivo implica `FAIL`.
8. Finalizar no formato prescrito pelo checklist, citando código e testes.

## Guardrails

- Exigir português brasileiro claro, profissional, consistente e apropriado ao contexto financeiro em todo conteúdo destinado ao usuário final.
- Impedir vazamento de detalhes internos e transformar falhas técnicas em mensagens seguras e acionáveis.
- Não traduzir nem renomear identificadores internos, tipos TypeScript, APIs, funções ou contratos apenas por estética.
- Rejeitar alterações visuais, textuais ou comportamentais sem relação com o escopo declarado, mesmo que pareçam melhorias.
- Ausência de evidência obrigatória é `FAIL`, nunca `N/A`. Não existe “PASS com ressalvas”.
