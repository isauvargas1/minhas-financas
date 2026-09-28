# Checklist de prontidão comercial do SaaS

Referências a confirmar com o jurídico antes do lançamento: Código de Defesa do Consumidor (Lei 8.078/1990, inclusive publicidade enganosa e direito de arrependimento), Decreto 7.962/2013 (comércio eletrônico), Lei Brasileira de Inclusão (Lei 13.146/2015) e LGPD. Esta lista orienta evidência; não substitui parecer jurídico.

## 1. Landing pública

- Rota pública acessível sem autenticação, servida no domínio de produção, com proposta de valor precisa.
- Cada afirmação (funcionalidade, integração, segurança, disponibilidade, número, depoimento, selo, “grátis”, “ilimitado”) mapeada para evidência de código/teste ou documento verificável. Afirmação sem evidência, recurso placeholder/mock ou recurso de outro plano sem indicação é `FAIL`.
- CTAs levam a cadastro e preços; nenhum link quebrado.
- Transparência sobre natureza do serviço: ferramenta de gestão financeira que não é instituição financeira, não movimenta recursos e não presta recomendação de investimento; respostas de IA não são aconselhamento financeiro.

## 2. Cadastro e onboarding

- Cadastro funcional (métodos definidos), verificação de e-mail, recuperação de senha, mensagens pt-BR sem detalhes internos.
- Aceite de Termos e Política de Privacidade com links visíveis, versão registrada pelo servidor (evidência via `privacy-lgpd-data-lifecycle`), sem caixa pré-marcada para finalidades opcionais.
- Proteção contra abuso do cadastro (App Check, rate limit, anti-enumeração), com evidência via `firebase-production-readiness`.
- Criação do primeiro workspace e onboarding PF/PJ concluídos sem estado inconsistente; estados vazios orientam a próxima ação.

## 3. Preços e disclosure comercial

- Página de preços pública com valores finais em BRL, periodicidade, o que cada plano inclui (limites exatos idênticos aos entitlements do backend), condições de trial, renovação automática, forma de pagamento, política de cancelamento e reembolso, direito de arrependimento aplicável e tratamento de impostos (incluso ou não).
- Nenhuma divergência entre preço/limite exibido, catálogo versionado e preço cobrado pelo Stripe.
- Mudança de preço comunicada conforme política definida.

## 4. Checkout

- Resumo do contrato (plano, valor, periodicidade, renovação, cancelamento) apresentado antes da confirmação, com ferramenta para identificar e corrigir erros antes de finalizar a contratação.
- Contrato e termos disponíveis em meio que permita conservação e reprodução imediatamente após a contratação.
- Confirmação imediata do recebimento da contratação e e-mail/recibo com os dados da contratação.
- Retorno de sucesso não ativa plano sem confirmação de pagamento (evidência via `billing-entitlement-integrity`); retorno de cancelamento não altera estado; mensagens pt-BR claras em falha e em pagamento pendente.

## 5. Assinatura, cancelamento e inadimplência (experiência do cliente)

- Cliente gerencia plano, meio de pagamento e faturas sem contato com suporte.
- Cancelamento disponível pelo mesmo meio e com facilidade equivalente à contratação, sem etapas enganosas; efeito e data comunicados.
- Direito de arrependimento em 7 dias exercível pela mesma ferramenta da contratação, com confirmação imediata do recebimento da manifestação, cancelamento, reembolso integral e estorno no meio de pagamento.
- Downgrade explica o que acontece com dados acima do novo limite (sem perda de histórico).
- Inadimplência comunicada com prazo de regularização e consequência.

## 6. Suporte

- Canal de atendimento publicado (e-mail ou formulário) com prazo de resposta informado, compatível com o prazo legal para informação, dúvida, reclamação, suspensão ou cancelamento (referência: até 5 dias); canal do titular de dados identificado.
- Central de ajuda/FAQ mínima para cadastro, cobrança, cancelamento, privacidade e segurança da conta.
- Comunicação de indisponibilidade definida (ex.: página de status ou aviso no produto).

## 7. Páginas legais

- Termos de Uso, Política de Privacidade, Política de Cookies e Política de Cancelamento/Reembolso publicadas, com versão e data de vigência, acessíveis da landing, do cadastro, do footer e de dentro do produto.
- Conteúdo coerente com o comportamento do código (subprocessadores, retenção, direitos, preços) e validado pelo jurídico, com registro.

## 8. Footer institucional

- Nome empresarial, CNPJ, endereço físico e eletrônico e demais informações de identificação exigidas para comércio eletrônico; links para páginas legais e suporte; ano corrente.

## 9. Acessibilidade das superfícies públicas e do funil

- Conformidade com WCAG 2.1 AA (meta 2.2 AA) em landing, preços, cadastro, login, recuperação de senha, checkout e páginas legais: `lang="pt-BR"`, estrutura de headings, contraste, foco visível, operação por teclado, labels e mensagens de erro associadas, alternativas textuais, zoom de 200% sem perda.
- Evidência automatizada (ex.: axe via Playwright) e verificação manual por teclado registrada.

## 10. SEO técnico

- Por página pública: `title` e `meta description` únicos, canonical, Open Graph/Twitter, favicon/manifest, `lang` correto.
- `robots.txt` e `sitemap.xml` publicados; páginas autenticadas e de estado (`/app`, callbacks de checkout) com `noindex` e fora do sitemap.
- Páginas públicas renderizam conteúdo indexável (pré-render/SSG ou estratégia equivalente documentada) e têm página 404 própria.
- Desempenho básico medido nas páginas públicas (ex.: LCP, CLS) com meta definida.

## 11. Marca, domínio e comunicação

- Domínio próprio com TLS; e-mails transacionais do domínio com SPF, DKIM e DMARC; remetente e textos pt-BR.
- Verificação de disponibilidade/registro da marca como decisão externa registrada.

## 12. Testes obrigatórios

1. E2E do funil: landing → preços → cadastro → verificação → onboarding → contratação (Stripe em modo test ou fronteira simulada) → gestão/cancelamento.
2. Links de footer e páginas legais respondem e exibem versão/data.
3. Consistência: teste que compara preços/limites exibidos com o catálogo do backend.
4. Acessibilidade automatizada sem violações críticas/sérias nas páginas públicas e no funil.
5. SEO: presença de metadados obrigatórios e `noindex` nas rotas autenticadas.
6. Arrependimento dentro de 7 dias: cancelamento, reembolso integral e confirmação imediata ao cliente.
