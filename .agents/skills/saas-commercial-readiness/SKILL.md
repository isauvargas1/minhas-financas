---
name: saas-commercial-readiness
description: Gate bloqueante de prontidão comercial do SaaS e de suas superfícies públicas. Use sempre que uma tarefa criar, alterar, revisar ou aprovar landing page pública, cadastro/signup, onboarding, página ou tabela de preços, disclosure comercial, checkout, contratação/assinatura, cancelamento, suporte/atendimento, páginas legais (termos, privacidade, cookies, reembolso), footer institucional, acessibilidade do funil público, SEO técnico, textos de marketing ou qualquer afirmação pública sobre funcionalidades — e antes de lançamento comercial ou abertura de cadastro ao público.
---

# SaaS Commercial Readiness

Atue como gate bloqueante. Inspecione as páginas e fluxos realmente implementados, o que eles afirmam e a correspondência de cada afirmação com código e testes; nunca aprove por mockup, texto de marketing ou intenção.

Esta skill verifica evidência técnica e de produto. Requisitos de natureza jurídica (conteúdo de termos e políticas, obrigações de consumidor e de comércio eletrônico, registro de marca) exigem validação jurídica registrada em `docs/production/LAUNCH_CHECKLIST.md` §11 (para itens de privacidade, o registro canônico é `docs/production/PRIVACY_LGPD.md`); sem registro, o item é `FAIL`.

## Fronteiras com outras skills

- **Esta skill:** funil público e comercial — landing, cadastro, onboarding, preços, disclosure, checkout e cancelamento do ponto de vista do cliente, suporte, páginas legais publicadas, footer institucional, acessibilidade e SEO das páginas públicas, veracidade das afirmações.
- `ptbr-product-ui-review`: qualidade do texto pt-BR e estados de interface — obrigatória também nas páginas públicas.
- `billing-entitlement-integrity`: correção do backend de billing; esta skill exige que o que é exibido e prometido seja idêntico ao catálogo e aos entitlements comprovados por ela.
- `privacy-lgpd-data-lifecycle`: conteúdo e aderência técnica da política de privacidade, aceite e consentimento; esta skill verifica publicação, acesso e coerência no funil.
- `firebase-production-readiness`: domínio, TLS, headers e Hosting.

## Workflow

1. Ler integralmente [references/commercial-checklist.md](references/commercial-checklist.md).
2. Mapear o funil real: visitante anônimo → landing → preços → cadastro → verificação → onboarding → uso → contratação → gestão/cancelamento → suporte, com rotas e componentes.
3. Listar toda afirmação pública (landing, preços, e-mails, metadados, textos de onboarding) e mapear cada uma para funcionalidade implementada com evidência de código e teste. Afirmação sem evidência é `FAIL`.
4. Confrontar preços, limites, trial e condições exibidos com o catálogo e os entitlements do backend.
5. Avaliar cada item do checklist com evidência; executar E2E das páginas públicas e do funil e verificações automatizadas de acessibilidade e SEO.
6. Se implementação for pedida, corrigir e testar; em revisão, permanecer somente leitura. Não criar funcionalidade, depoimento, número ou selo para “preencher” a página.

## Política de decisão

- **Escopo da avaliação.** Em mudança ou fechamento de milestone, avaliar integralmente toda seção do checklist exercitada pelos caminhos alterados, toda invariante que o diff possa violar e todo item que o plano mestre (`docs/production/PRODUCTION_READINESS_PLAN.md` §6, §8 e §11) atribui ao milestone corrente ou a milestones anteriores. Itens atribuídos a milestone posterior e não afetados pelo diff ficam fora do escopo desta execução e são listados em "Fora do escopo desta avaliação" com o ID do plano (PR-\*, E-\*, D-\*); não são `N/A` nem `PASS`, e o veredito declara o escopo a que se aplica. Isso não é ressalva: dentro do escopo, qualquer falha ou evidência ausente é `FAIL`. Em release para STAGING/PROD, no lançamento e em P10, o escopo é o checklist integral e qualquer pendência é `FAIL`.
- `FAIL` para: página pública ou funil ausente; recurso anunciado inexistente, placeholder, mock ou restrito a outro plano sem indicação; preço, limite ou condição divergente do backend; ausência de informação de renovação automática, cancelamento, reembolso e direito de arrependimento aplicável; ativação de plano sem confirmação do pagamento; cancelamento mais difícil que a contratação; páginas legais ausentes, sem versão/data ou inacessíveis do cadastro e do footer; footer sem identificação do fornecedor exigida; ausência de canal de suporte; depoimentos, números ou selos não comprováveis; barreira de acessibilidade crítica no funil; páginas públicas sem metadados mínimos ou páginas autenticadas indexáveis; item obrigatório sem evidência.
- `N/A` somente com prova. Não existe “PASS com ressalvas”.

## Saída obrigatória

Começar exatamente com `PASS — SaaS commercial readiness` ou `FAIL — SaaS commercial readiness`.

Em seguida:

- **Escopo:** rotas, páginas, fluxos e textos avaliados.
- **Mapa do funil:** etapa → rota/componente → estado (implementado/ausente) → evidência.
- **Afirmações públicas:** afirmação → funcionalidade → evidência de código/teste → veredito.
- **Consistência comercial:** preço/limite/condição exibidos × catálogo × entitlements.
- **Matriz de evidência:** uma linha por seção do checklist com `PASS`, `FAIL` ou `N/A`.
- **Pendências jurídicas/externas:** itens que exigem validação ou configuração fora do código.
- **Achados bloqueantes:** cenário, impacto ao cliente/negócio e remediação.
- **Fora do escopo desta avaliação:** itens do checklist atribuídos a milestone posterior e não afetados pelo diff, com o ID do plano; vazio em release e em P10.
- **Verificação:** comandos, E2E, auditorias de acessibilidade/SEO executadas.
