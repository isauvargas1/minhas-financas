# Checklist de prontidão Firebase para produção

Citar arquivo:linha para o que é versionado e o item correspondente de `docs/production/FIREBASE_PRODUCTION.md` para o que vive no console/GCP.

## 1. Ambientes DEV/STAGING/PROD

- Projetos Firebase/GCP distintos por ambiente, com IDs registrados. Nenhum ambiente compartilha banco, Auth, buckets, segredos ou chaves Stripe com outro.
- `.firebaserc` com aliases explícitos (`dev`, `staging`, `prod`); o alias `default` nunca é PROD.
- Scripts (`package.json`, `tools/`, CI) nunca têm produção como destino implícito; deploy para produção só por pipeline controlado com aprovação humana e gates verdes.
- Configuração web (`VITE_FIREBASE_*`) por ambiente, fora do repositório, com `.env.example` sem valores reais.
- Dados de produção nunca copiados para DEV/STAGING sem anonimização documentada.
- CI sem credenciais de produção; testes usam somente Emulator com projeto local.

## 2. App Check

- Frontend inicializa App Check (provider web, ex.: reCAPTCHA Enterprise) antes de qualquer uso de Firestore, Functions ou Storage; debug token apenas em DEV/CI via variável de ambiente, nunca versionado.
- Enforcement ativado para cada serviço usado: Firestore, Cloud Functions (`enforceAppCheck: true` em cada callable ou nas opções globais de callables), Authentication (conforme D-33/E-02) e Storage quando existir.
- Operações sensíveis a abuso (checkout, convite, IA, exportação) avaliadas para `consumeAppCheckToken` (proteção contra replay), com o cliente chamando `httpsCallable(..., { limitedUseAppCheckTokens: true })`.
- Métricas de App Check observadas antes do enforcement; plano de rollout e rollback documentado.
- Emulator e E2E funcionam com App Check (debug provider) sem desativar enforcement no código de produção.

## 3. Security Rules e índices (plataforma)

- `firestore.rules`, `firestore.indexes.json` (e `storage.rules` se houver Storage) versionados e referenciados em `firebase.json`.
- Deploy de Rules/índices só é possível após a suíte Emulator de Rules; o caminho de deploy não permite pular o gate.
- Default deny; nenhum `allow read, write: if true` ou curinga permissivo; toda coleção usada pelo código tem bloco explícito e teste (semântica: `multi-tenant-security-review`).
- Evidência de que a versão implantada em cada ambiente corresponde a um commit aprovado.
- Índices compostos cobrem todas as queries; índices sem uso removidos; `fieldOverrides` para campos grandes ou de alta cardinalidade que não precisam de índice.
- Políticas de TTL documentadas por coleção/campo e configuradas em cada ambiente.

## 4. Cloud Functions

- Região co-localizada com o Firestore (`southamerica-east1`) para todas as funções, salvo exceção documentada.
- `timeoutSeconds`, `memory`, `maxInstances` (teto de custo e proteção contra abuso) e `concurrency` definidos globalmente e revisados por função; `minInstances` como decisão explícita de custo × latência.
- Funções agendadas com `timeZone` explícito (`America/Sao_Paulo`), idempotentes e com execução limitada por rodada.
- Gatilhos de evento com retry habilitado somente se idempotentes; sem retry, falhas são detectáveis (log estruturado + alerta).
- Nenhuma função de teste, diagnóstico ou “manual” exportada no bundle de produção. `functions/src/index.ts` exporta apenas o contrato público aprovado, protegido por teste de contrato.
- Runtime Node suportado e idêntico entre CI e deploy; `npm audit` sem vulnerabilidade alta/crítica sem justificativa.
- Endpoints HTTP públicos (ex.: webhooks) com método restrito, validação de origem/assinatura e limites de corpo; nenhum endpoint administrativo público.

## 5. IAM e acesso humano

- Service account dedicada por função ou grupo de funções, com papéis mínimos; nenhuma com Owner/Editor.
- Nenhuma chave de service account criada/baixada para uso local ou CI; usar ADC/Workload Identity Federation.
- Acesso humano a PROD restrito a pessoas nomeadas, com MFA obrigatório; revisão periódica registrada.
- Cloud Audit Logs de atividade administrativa ativos; logs de acesso a dados decididos e documentados.
- Proteção contra exclusão do banco (delete protection) ativada em PROD.

## 6. Segredos

- Segredos de servidor (Stripe, webhook, Gemini, e-mail) via Secret Manager (`defineSecret`) e declarados nas funções que os usam.
- Nenhum segredo em `VITE_*`, bundle do cliente, código, `.env` versionado, fixtures, logs ou mensagens de erro. `.env*` ignorados pelo Git; varredura do histórico sem segredos ativos (ou rotação comprovada).
- Rotação documentada por segredo, com dono.

## 7. Authentication

- Domínios autorizados mínimos por ambiente (sem `localhost` em PROD).
- Proteção contra enumeração de e-mail ativada; política de senha definida; provedores habilitados = provedores usados pelo código.
- Templates de e-mail (verificação, redefinição de senha) em pt-BR e com domínio próprio autenticado (SPF/DKIM/DMARC).
- MFA para contas administrativas; bloqueio/desativação de usuário refletido no backend.

## 8. Hosting

- Headers de segurança: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, proteção contra framing (`frame-ancestors`).
- Domínio customizado com TLS; política de cache correta (HTML sem cache, assets imutáveis).
- Preview channels nunca apontam para dados de PROD.

## 9. Custos e quotas

- Budget com alertas (ex.: 50/90/100%) por projeto: esta skill verifica existência e limiares; roteamento e runbook do alerta são verificados por `observability-incident-readiness`.
- Tetos por `maxInstances`, rate limits de operações caras e quotas de APIs externas (Gemini) configurados.
- Kill switch documentado para desligar funcionalidade cara ou abusada sem deploy de código.

## 10. Monitoramento de plataforma

- Cloud Logging com retenção definida (e sink para bucket com retenção/lock quando exigido por obrigação legal ou forense).
- Error Reporting e Cloud Monitoring habilitados; uptime check para endpoints públicos. Conteúdo de alertas avaliado por `observability-incident-readiness`.

## 11. Backup, PITR e restore

- PITR habilitado no banco de produção.
- Backups agendados (ex.: diário e semanal) com retenção definida e compatível com a política de retenção/eliminação.
- Procedimento de restore documentado em `docs/production/BACKUP_RESTORE_DR.md`: restore para novo banco, validação, troca/reconciliação e rollback.
- Restore exercitado em projeto não produtivo com evidência: data, backup usado, duração, RPO/RTO medidos, verificações de integridade.
- Export periódico para bucket em conta/projeto separado avaliado como decisão explícita (proteção contra comprometimento do projeto).

## 12. Emulator

- `firebase.json` define os emuladores usados; suites executam com projeto local não produtivo (`minhas-financas-local`); `singleProjectMode` ativo.
- Nenhum teste ou script de teste depende de credenciais reais ou de rede externa.
- CI executa as suítes Emulator em todo PR.

## 13. Registro de configuração externa

Para cada item acima que vive fora do repositório, `docs/production/FIREBASE_PRODUCTION.md` registra: ambiente, item, valor esperado, estado verificado, forma de verificação (comando somente leitura ou tela), data, responsável. Item sem registro, com estado desconhecido ou verificado há mais tempo que o ciclo definido é `FAIL`.
