# Checklist de privacidade, LGPD e ciclo de vida de dados

Referências normativas a confirmar com o jurídico antes de cada lançamento: Lei 13.709/2018 (LGPD), Lei 12.965/2014 (Marco Civil da Internet) e regulamentos vigentes da ANPD (agentes de pequeno porte, comunicação de incidentes, encarregado, transferência internacional). Esta lista orienta a coleta de evidência; não substitui parecer jurídico.

## 1. Inventário e registro das operações de tratamento

- Inventário derivado do código real: para cada coleção/campo, log, payload a terceiro e armazenamento local do navegador, registrar categoria de dado pessoal (identificação, contato, autenticação, financeiro, dados de terceiros como clientes/devedores/participantes, conteúdo livre, metadados de acesso), titular, finalidade, base legal, origem, compartilhamento, retenção, localização e subprocessador.
- Dados de terceiros inseridos pelos usuários (clientes, devedores, participantes de divisão) têm finalidade, base legal e tratamento de direitos definidos.
- Campos de texto livre (descrições, notas, mensagens) considerados potenciais portadores de dados pessoais, inclusive sensíveis.
- O inventário é mantido em `docs/production/PRIVACY_LGPD.md` e atualizado na mesma mudança que cria ou altera um campo pessoal.

## 2. Finalidade, necessidade e minimização

- Cada campo pessoal tem finalidade vinculada a uma funcionalidade existente; campos sem uso são removidos.
- Payloads enviados à IA, a logs e a monitoramento contêm o mínimo necessário (sem identificadores diretos quando evitáveis, sem segredos, sem documentos completos).
- Logs usam identificadores pseudonimizados quando a identificação direta não é necessária para a finalidade.

## 3. Bases legais, transparência e aceite

- Base legal registrada por finalidade (execução de contrato, obrigação legal, legítimo interesse com avaliação registrada, consentimento). Validação jurídica registrada.
- Política de Privacidade e Termos de Uso versionados (versão, data de vigência) e coerentes com o comportamento do código e com a lista de subprocessadores.
- Aceite registrado pelo servidor no cadastro e após mudança material: usuário, documento, versão, timestamp de servidor e contexto necessário. Aceite não pode ser forjado pelo cliente (Rules/backend).
- Consentimentos para finalidades opcionais (marketing, cookies não essenciais, usos de IA que dependam de consentimento) são separados, granulares, registrados e revogáveis com a mesma facilidade com que foram dados; revogação produz efeito técnico verificável.
- Idade mínima e tratamento de dados de crianças e adolescentes definidos nos termos e no cadastro.

## 4. Direitos do titular

- Canal publicado para o titular (e-mail ou formulário) e identificação do encarregado ou justificativa documentada de dispensa aplicável.
- Fluxos implementados com verificação de identidade: confirmação e acesso, correção, anonimização/bloqueio/eliminação de dados desnecessários, portabilidade/exportação em formato estruturado, informação sobre compartilhamento, revogação de consentimento, eliminação de dados tratados com consentimento.
- Prazos de resposta definidos conforme a lei e registro de cada solicitação (data, tipo, resposta, responsável).
- Exportação contém todos os dados do titular dos workspaces a que ele tem direito e nenhum dado de outro tenant ou de outro titular sem base.

## 5. Eliminação, exclusão de conta e anonimização

- Exclusão de conta executada no servidor após autenticação recente, com efeitos definidos para: workspaces em que o usuário é único owner (transferência obrigatória ou eliminação do workspace), workspaces compartilhados (remoção de membership, anonimização do ator em trilhas que precisam permanecer), convites pendentes, assinatura Stripe (cancelamento), dados em subprocessadores.
- Conflito com a invariante de não apagar histórico financeiro resolvido por decisão documentada; eliminação a pedido do titular não é bloqueada por essa invariante sem base legal para retenção.
- Dados mantidos por obrigação legal (ex.: registros de acesso à aplicação exigidos pelo Marco Civil; registros fiscais do billing) ficam bloqueados para outros usos, com prazo e eliminação ao fim.
- Backups: prazo máximo em que dados eliminados permanecem em backups definido e comunicado; restore não reintroduz silenciosamente dados eliminados sem reaplicar eliminações.
- Anonimização, quando usada, é irreversível por meios razoáveis e testada.

## 6. Retenção

- Tabela de retenção por categoria (dados de conta, dados financeiros do workspace, dados de terceiros, logs de aplicação, registros de acesso, audit logs, chaves de idempotência, rate limits, eventos de webhook, backups, dados após cancelamento da assinatura ou inatividade).
- Cada prazo tem mecanismo implementado (TTL configurado, job de eliminação idempotente e limitado) com evidência; prazo sem mecanismo é `FAIL`.

## 7. Subprocessadores e transferência internacional

- Lista de subprocessadores derivada do código e da configuração (ex.: Google Firebase/Cloud, Stripe, provedor de IA, e-mail, monitoramento), com finalidade, dados compartilhados, localização do processamento e contrato (DPA) aplicável.
- Transferências internacionais identificadas por serviço e região efetiva; mecanismo legal de transferência registrado e validado pelo jurídico.
- Lista publicada (Política de Privacidade ou página própria) e mantida em `docs/production/SUBPROCESSORS.md`; novo subprocessador exige atualização antes do uso em produção.
- Termos do provedor de IA quanto a retenção e uso de dados para treinamento verificados e refletidos na política.

## 8. Cookies, armazenamento local e trackers

- Inventário de cookies, `localStorage`, `sessionStorage`, IndexedDB e scripts de terceiros, classificados como essenciais ou não essenciais.
- Nenhum tracker/analytics não essencial carregado antes do consentimento; recusa tão fácil quanto aceite; escolha registrada e revogável.
- Dados financeiros ou pessoais não persistidos em armazenamento local sem necessidade e sem limpeza no logout.

## 9. Segurança como obrigação de privacidade

- Evidência de controles de acesso por tenant (resultado de `multi-tenant-security-review`), criptografia em trânsito e repouso, acesso administrativo restrito e auditado, ambientes não produtivos sem dados reais.

## 10. Incidentes de segurança com dados pessoais

- Procedimento em `docs/production/INCIDENT_RESPONSE.md` que inclui avaliação de risco ou dano relevante aos titulares, decisão de comunicação à ANPD e aos titulares dentro do prazo regulamentar vigente, conteúdo mínimo da comunicação, responsáveis e registro de incidentes mantido pelo prazo regulamentar.
- Contatos e modelos de comunicação preparados.

## 11. Testes obrigatórios

1. Exportação: contém todos os dados do titular nas coleções inventariadas; não contém dados de outro tenant.
2. Exclusão de conta: remove ou anonimiza em todas as coleções inventariadas; respeita retenções legais; comportamento correto para owner único e para workspace compartilhado; idempotente sob retry.
3. Aceite: registrado pelo servidor com versão; cliente não consegue forjar ou alterar.
4. Consentimento: revogação desativa o tratamento correspondente.
5. Retenção: TTL/job elimina apenas o que expirou e é limitado por execução.
6. Rules (Emulator): dados pessoais de um workspace inacessíveis a outro; registros de aceite e solicitações de titular imutáveis pelo cliente.
7. Correção: alteração de dado cadastral pelo fluxo oficial propaga-se às cópias denormalizadas (memberships, índices, convites) e é auditada.

## 12. Registro documental

`docs/production/PRIVACY_LGPD.md` e `docs/production/SUBPROCESSORS.md` atualizados, com data, responsável e validação jurídica registrada para cada item jurídico. Documento ausente, desatualizado em relação ao código ou sem validação é `FAIL` para lançamento.
