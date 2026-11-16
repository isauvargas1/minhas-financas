# E-00 / PR-AI-02 — chave Gemini exposta: causa, correção no código, roteiro de contenção e registro de evidências

**Estado (2026-11-16, rodada P5-E00-A-02):** a contenção e a revogação **não estão comprovadas**.
- O proprietário informou, por transcrição, a exclusão da chave Gemini conhecida, o registro `DeleteKey`, as
  restrições da chave web e o faturamento (§8). Os originais não foram inspecionados.
- As sete linhas da parte A seguem em NÃO VERIFICADO na §9.4 e na matriz do §4. Nas linhas 1, 2, 6 e 7, a informação
  parcial está registrada como "informado"; o estado é decidido pelo proprietário no passo 9.
- Nenhuma linha está VERIFICADA.

A chave deve ser tratada como **comprometida e ainda válida**. As ações dependem da conta Google do proprietário: nenhum
agente as executa, e nenhum agente marca uma linha como VERIFICADA.

**Nenhuma publicação em produção (Hosting, Functions ou configuração) pode ocorrer enquanto a chave exposta continuar
válida.** A única publicação prevista no E-00 é a substituição controlada da chave web do Firebase (passo 5), se for
necessária. Ela só pode ocorrer depois dos passos 4 e 7, com build verificado (passo 5, item 7). Sem a
evidência da parte A, as revisões de plataforma e de privacidade da P5 ficam `FAIL`.

| Seção | Conteúdo |
| --- | --- |
| §1 | Causas no código e a correção |
| §2 | O roteiro que o proprietário executa, passo a passo |
| §3 | Critérios objetivos |
| §4 | Matriz de evidências |
| §5 | Lista de conferência dos consoles |
| §6 | Matriz de risco e de impacto aos titulares |
| §7 | Resumo da pendência jurídica (parte C) |
| §8 | Informações do proprietário (P5-E00-A-02) e o que cada uma prova |

## 1. A arquitetura ainda permitia expor outra chave? Sim: as causas e a correção

| Vetor | Situação antes desta etapa | Correção |
| --- | --- | --- |
| `define` do Vite injetando variável do ambiente no bundle (a causa original, `39806fb` a `92473c8`) | Já neutralizado na P0 (`'process.env.GEMINI_API_KEY': JSON.stringify('')`) | A guarda carrega a configuração efetiva pelo próprio Vite (`loadConfigFromFile`, modos `production` e `development`) e exige o `define` com só as duas neutralizações, com texto vazio, e nenhum `envPrefix`. O `vite.config.ts` não carrega mais o ambiente (`loadEnv` removido: estava sem uso) |
| **Chamadas ao Gemini direto do navegador** (`d6a9047`: `src/components/TransactionModal.tsx:622,697` e `src/modules/reports/api.ts:96,112-153`) | O cliente chamava o Gemini com a chave do bundle e enviava comprovantes, transcrições de voz, o retrato financeiro e a pergunta do usuário. A leitura de `VITE_GOOGLE_AI_KEY` (`reports/api.ts:96`) punha o valor no bundle por esse nome, além do `define`. Removidas em `360aeaf` (2026-08-24); a IA passou ao backend | A guarda recusa SDK de IA e nomes de chave de IA no cliente, e a lista fechada abaixo impede outro nome |
| **Leitura de `import.meta.env` como objeto no cliente** (`src/lib/firebase.ts:26`, `(import.meta.env as Record<…>)[key]`, presente desde pelo menos `d6a9047`) | Com isso o Vite embute no bundle público **o objeto inteiro com todas as variáveis `VITE_*` do ambiente de build**, inclusive as que nenhum código usa. Comprovado no bundle E2E (o objeto `{…VITE_E2E_MODE:…,VITE_FIREBASE_…}` estava no JavaScript) e na prova G4: com uma `VITE_GEMINI_API_KEY` falsa no ambiente, a chave falsa apareceu 2 vezes em `dist/`. O commit `1730a1df` ainda tem essa leitura | `src/lib/firebase.ts` lê cada variável por nome fixo. Guarda: o cliente só lê variáveis de uma lista fechada (configuração web do Firebase, emuladores e modo E2E), por nome, nunca o objeto, em todo arquivo de `src/` (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`). Com a correção, a mesma chave falsa no ambiente aparece 0 vezes no bundle |
| **Qualquer variável `VITE_*` lida pelo cliente** | A guarda conhecia só quatro nomes de chave de IA (`VITE_GOOGLE_AI_KEY`, `VITE_GEMINI_API_KEY`, `GEMINI_API_KEY`, `API_KEY`); outro nome passaria | A lista fechada acima: uma variável nova no cliente exige mudar a guarda, com a justificativa de que o valor pode ser público |
| **`%NOME%` no `index.html`** (o Vite substitui pelo valor da variável) | Nada conferia | A guarda recusa qualquer marcador `%NOME%` no `index.html` |
| **Nada conferia o bundle gerado** | Só o código-fonte era varrido | `tools/seguranca/varrer-bundle.mjs` roda no fim de todo `npm run build` (logo, também no `build:e2e`, no CI e no `deploy:hosting`) e no `predeploy` do Hosting (`firebase.json`; vale também para um `firebase deploy --only hosting` direto). Reprova se `dist/` tiver objeto de ambiente do Vite, chave de API do Google fora da configuração web do Firebase (ou mais de uma), chave secreta ou restrita e segredo de webhook do Stripe, chave privada PEM, conta de serviço do Google, segredo OAuth do Google, ou os nomes das variáveis de chave de IA do backend. Lê **todo** arquivo publicado, de qualquer extensão. Roda de qualquer caminho (antes, com espaço ou acento no caminho, ou por link simbólico, saía com 0 sem varrer nada: PLAT-09). Nunca imprime o valor achado |

**A correção ainda não foi publicada.** Ela está na árvore de código testada (`06cf3296`, execução oficial
`gate-verify-all-p5gate-2`), que não foi commitada. Um build feito de `1730a1df`, ou de qualquer árvore anterior, volta
a publicar todas as `VITE_*` da estação e não roda a varredura do bundle (passo 5).

**A chave web do Firebase também é credencial.** `VITE_FIREBASE_API_KEY` continua no bundle por desenho: identifica o
projeto, e o acesso aos dados depende do Auth, das Rules publicadas e do App Check (PR-APPCHK-01, P6). As Rules
publicadas hoje são anteriores à P1 e não são as testadas (D-ORD-04). Uma chave de API do Google autoriza toda API
habilitada no projeto da qual não esteja restrita. Se a Generative Language API, ou outra API de IA como a do Firebase
AI Logic ou a Vertex AI, estiver habilitada no mesmo projeto, e a chave web ("Browser key (auto created by Firebase)")
não tiver restrição de API, ou tiver uma API de IA ou de ML na lista (caso da E03, §8), a chave pública do bundle pode
funcionar como credencial de IA. Por isso a desativação dessas APIs (passo 3) e a restrição das chaves (passo 5 e
linha 7 da §9.4) fazem parte da contenção.

**Onde fica a chave do backend.** As callables de IA declaram o segredo `GOOGLE_AI_API_KEY` desde `14ac195`
(2026-08-25; `functions/src/ai/callables.ts:74`) e o leem como `process.env.GOOGLE_AI_API_KEY`. Se essas Functions
foram publicadas, o valor está no Secret Manager do projeto: a cobrança de Secret Manager da E06 sugere que sim
(inferência técnica, a conferir no passo 1, item 3). Nesse caso, o passo 4, item 5, testa a partir dele. A chave nova
por ambiente, no Secret Manager de cada projeto, é a parte B (E-05, P6).

**Testes e provas:**
- `tests/unit/ai-backend-only.test.ts`: 10 testes, com os vermelhos G1 e G2 e, na 2ª revisão, os mutantes A a D e G de
  `p5gate/logs/mutantes-plat.log`.
- `tests/tools/varrer-bundle.test.mjs`: 14 testes com segredos falsos montados em tempo de execução, com o vermelho G3 e
  os mutantes E e F.
- Prova G4 no bundle real: o build reprova com o `firebase.ts` anterior.
- O passo `test:tools:bundle` está no `verify:fast` e no CI.

## 2. O que o proprietário faz, fora do repositório, em três partes

As três partes têm obrigações e prazos diferentes:

| Parte | O que é | Quando é exigida |
| --- | --- | --- |
| **A** | A contenção do incidente: tira a validade de toda credencial que pode estar comprometida | Para aprovar a P5, porque o PR-AI-02 é da P0 |
| **B** | A configuração nova: chave por ambiente e Secret Manager. É o E-05 da P6 e depende dos ambientes da P6 (PR-PLAT-01) | Antes da IA remota e da produção |
| **C** | A decisão sobre comunicar o incidente | No prazo regulamentar, se houver risco relevante (§7), e sempre antes da produção |

Separar as partes não reduz nenhuma exigência. A chave exposta só deixa de ser risco com a parte A verificada. Nada de
produção nem de IA remota acontece sem a parte B, e nada de produção sem a parte C.

### Regras para todos os passos

- **Nunca registre o valor de uma chave ou segredo:** nem em chat ou assistente de IA externo (como o ChatGPT), issue, commit, documento, captura de tela, histórico
  do shell ou arquivo. De cada chave, registre só o nome, o identificador (uid), o projeto, a data de criação, as
  restrições e os 4 últimos caracteres.
  - **Exceção temporária:** para o teste do passo 4, o valor pode ficar no seu gerenciador de senhas até o teste.
    Depois, apague-o.
- **Nunca leve a chat, a assistente de IA externo (como o ChatGPT), a repositório ou a matriz um dado pessoal achado** (nomes, CPF, e-mails, conteúdo de arquivos ou de
  registros), nem uma captura que o mostre. No repositório entram só as categorias, as contagens, a conclusão e o
  identificador da evidência; a um assistente de IA externo vão só contagens e categorias. Um agente transcreve só
  isso.
- **Guarde as evidências numa pasta privada sob seu controle, fora do repositório.** Dê a cada uma um identificador
  (`EV-E00-L<linha>-<nº>`, por exemplo `EV-E00-L2-01`). No repositório (§4 e §9.4) entram só o identificador, a data, o
  responsável e o resultado.
- **Rode os comandos no bash.** No macOS, digite `bash` no Terminal antes; no Windows, use o Git Bash ou o WSL. O
  comando do passo 6, item 3, chama o bash por conta própria.
- **Faça cada passo na ordem.** O item "Prossiga quando" de cada passo diz o que precisa estar feito antes do seguinte.

**Período e vetores de exposição.** Pelo registro do plano (P0), a chave do Gemini foi injetada no bundle pelo `define`
do Vite de `39806fb` (2026-01-22) a `92473c8` (2026-08-24). O clone usado aqui é raso: o commit mais antigo disponível é
`d6a9047` (2026-05-24). Na janela disponível, há três vetores (§1):

| Vetor | Até quando |
| --- | --- |
| O `define` do Vite | `92473c8` (2026-08-24) |
| As chamadas do navegador com `VITE_GOOGLE_AI_KEY` ou `process.env.API_KEY` | `360aeaf` (2026-08-24) |
| A leitura de `import.meta.env` como objeto, que publicava **todas** as `VITE_*` do ambiente de quem fez o build | A correção da P5-GATE-FINAL, nunca publicada |

Por causa do terceiro vetor, o corte de 2026-08-24 não basta: toda chave cujo valor esteve numa variável `VITE_*` no
ambiente de um build publicado, em qualquer data, também é afetada (classe V, passo 1).

Todo deploy é manual, a partir de uma estação: `npm run deploy:hosting` roda `npm run build` localmente, e o CI não
publica nem usa segredos. É o ambiente dessa estação que define o que entrou no bundle.

O fim do período é a revogação, não `92473c8`: o Hosting de produção pode ainda servir um bundle antigo.

### Parte A — contenção e revogação da credencial exposta (exigida para aprovar a P5; §9.4, linhas 1, 2 e 5 a 9)

**Ordem segura:**
- passo 0: preparação;
- passo 1: inventário;
- passo 2: uso, numa fotografia curta antes de revogar;
- passo 3: revogação e desativação das APIs de IA no projeto do Firebase;
- passo 4: conferência;
- passo 4.1: faturamento;
- passo 5: restrição das chaves que continuam válidas;
- passo 6: inventário das `VITE_*`;
- passo 7: limpeza das estações;
- passo 8: avaliação;
- passo 9: registro.

Os passos 1 a 3 devem ocorrer na mesma sessão de trabalho. O passo 2 serve para preservar o mínimo de metadados, mas
não justifica manter a chave válida por mais tempo: limite-o a cerca de uma hora.

**Passo 0 — Preparação** (sem linha própria; sustenta todas).
- **Ação:**
  - Abra o registro do incidente, com data e hora de início.
  - Crie a pasta privada de evidências.
  - Liste todos os projetos Google da conta, inclusive os criados pelo AI Studio, que costumam se chamar "Gemini API"
    ou "Generative Language Client".
  - Confirme que você tem papel de proprietário (Owner) em cada um.
  - Anote quem tem permissão para restaurar chaves excluídas (`apikeys.keys.undelete`, presente em Owner, Editor e
    administrador de chaves de API). Retire os papéis desnecessários **só de contas de pessoas**. Não altere contas
    de serviço: as Functions rodam com a conta de serviço padrão, e mexer nela derruba o app. O IAM de serviço é da
    P6 (E-04).
- **Onde:** Google Cloud Console, seletor de projetos → "Todos"; IAM e administrador → IAM.
- **Responsável:** o proprietário dos projetos (titular da conta Google).
- **Evidência:** `EV-E00-L1-00`, com:
  - a lista de projetos (ID e nome);
  - o seu papel em cada um;
  - quem pode restaurar chaves.
- **Resultado esperado:** todos os projetos acessíveis, com permissão para excluir chaves e ver logs.
- **Risco:** um projeto esquecido deixa uma chave válida.
- **Prossiga quando:** a lista de projetos estiver completa.

**Passo 1 — Encontrar as chaves** (linha 1).
- **Ação:**
  1. No AI Studio, liste as chaves e o projeto de cada uma.
  2. Em cada projeto, abra a lista de chaves de API e anote, para cada chave:
     - nome;
     - uid (o final do nome do recurso `projects/…/keys/<uid>`, visível nos detalhes da chave);
     - projeto;
     - data de criação;
     - restrição de aplicativo;
     - restrição de API;
     - 4 últimos caracteres.
  3. Em cada projeto, veja quais APIs de IA estão habilitadas: Generative Language API, a do Firebase AI Logic e a
     Vertex AI. Confira os nomes exatos no console. Anote também, só os nomes:
     - os segredos do Secret Manager (Segurança → Secret Manager), ou, no terminal,
       `gcloud secrets list --project=<projeto> --format='value(name)'`. As callables de IA declaram
       `GOOGLE_AI_API_KEY` desde 2026-08-25 (§1);
     - as variáveis de ambiente e os segredos das Functions publicadas (Cloud Run → o serviço de cada função →
       Variáveis e segredos), sem abrir valores.
  4. Em cada estação que publicou o app ou rodou o `npm run dev` (passo 6), inclusive cada Codespace, descubra quais
     chaves do Google estiveram numa `VITE_*` ou em `GEMINI_API_KEY`, `API_KEY` ou `GOOGLE_AI_API_KEY` (o vetor do
     `define`). Na pasta do projeto, rode o comando abaixo. Ele procura nos `.env*` da raiz e de `functions/`, nos
     perfis do shell e no ambiente (`env`, onde ficam os segredos do Codespaces), e imprime só o local, o nome da
     variável e os 4 últimos caracteres do valor, que você compara com o inventário. Ele foi validado com arquivos e
     variáveis fictícios. Não espere as estações de outras pessoas para excluir as chaves G já identificadas: as chaves
     V achadas depois passam por uma segunda rodada dos passos 3 e 4.

     ```bash
     bash -s <<'FIM'
     e="^(export +)?(VITE_[A-Z0-9_]+|GEMINI_API_KEY|API_KEY|GOOGLE_AI_API_KEY)=[\"']?AIza[0-9A-Za-z_-]{35}"
     { for f in .env .env.* functions/.env functions/.env.* ~/.bashrc ~/.zshrc ~/.profile; do [ -f "$f" ] && grep -hoE "$e" "$f" | sed "s|^|${f/#$HOME/\~}: |"; done; env | grep -oE "$e" | sed 's|^|env: |'; } | sed -E 's/^([^:]+): (export +)?([A-Z0-9_]+)=.*(.{4})$/\1: \3 …\4/' | sort -u
     FIM
     ```

     No Codespaces, anote também se a porta do `npm run dev` já ficou com visibilidade pública ("Public"): em
     desenvolvimento, o Vite entrega ao navegador as `VITE_*` do ambiente, a quem abrir a página.

  5. Classifique cada chave:

     | Classe | Critério |
     | --- | --- |
     | **W** | A chave web do Firebase do app. **Prevalece sobre as outras classes:** não é excluída aqui, segue o passo 5 (restrição, ou substituição controlada) |
     | **G** | Pode ou podia chamar a Generative Language API (sem restrição de API, ou com essa API na lista, num projeto em que ela está ou já esteve habilitada) e foi criada **até 2026-08-24, inclusive**. Na dúvida, é G |
     | **V** | O valor esteve numa variável `VITE_*`, ou em `GEMINI_API_KEY`, `API_KEY` ou `GOOGLE_AI_API_KEY`, do ambiente de um build publicado, em qualquer data (item 4 deste passo e passo 6). Também a `VITE_*` de um `npm run dev` servido em porta pública, como a de um Codespace com visibilidade "Public" |
     | **O** | As outras chaves. Nenhuma delas pode continuar com acesso à Generative Language API (passo 5) |

  6. Para conferir as datas de criação e ligar cada nome ao uid, use também o Cloud Audit Logs: os registros
     `CreateKey` do serviço `apikeys.googleapis.com`. Para a chave W, anote também os `UpdateKey` desde a criação:
     eles mostram as restrições que ela teve no período (§6, R5). A retenção desse registro é limitada (a confirmar no
     console); o que ele não cobrir fica "não se sabe" em R8.
- **Onde:**
  - <https://aistudio.google.com/apikey>.
  - Cloud Console → APIs e serviços → Credenciais → Chaves de API.
  - APIs e serviços → APIs e serviços ativados.
  - Logging → Logs Explorer.
  - As estações que publicaram.
- **Responsável:** o proprietário, mais o dono de cada estação que publicou.
- **Evidência:** `EV-E00-L1-01`, a tabela de chaves sem valores, com a classe de cada uma e as APIs de IA habilitadas
  por projeto.
- **Resultado esperado:** a lista completa, com toda chave W, G, V e O identificada.
- **Risco:** o console mostra o valor da chave ao clicar em "mostrar chave". Não copie o valor para o registro.
- **Prossiga quando:** todas as chaves de todos os projetos do passo 0 estiverem na lista.

**Passo 2 — Ver o uso antes de revogar** (linha 6; fotografia curta, cerca de uma hora).
- **Ação:**
  - Para cada chave G e V, e para a chave W, abra as métricas da Generative Language API filtradas por credencial e
    anote:
    - o período que o console realmente mostra;
    - o volume;
    - os picos;
    - erros.

    A profundidade desse histórico é limitada e pode não chegar a 2026-01-22. Anote o período coberto; o resto fica
    como "histórico indisponível".
  - Antes de excluir, conte os recursos que guardam conteúdo no provedor, com cada chave G e V. Faça o mesmo com a
    chave W, se ela puder chamar a API: nesse caso, o valor está nas configurações do app da Web. O comando:
    - confere os 4 últimos caracteres da chave colada;
    - imprime só a contagem, o código HTTP e, se houver, o código de erro.

    ```bash
    read -rs CHAVE && printf 'final: %s\n' "${CHAVE: -4}" && for r in files cachedContents batches fileSearchStores tunedModels; do resp=$(printf 'x-goog-api-key: %s\n' "$CHAVE" | curl -sS -H @- -w '\nhttp=%{http_code}' "https://generativelanguage.googleapis.com/v1beta/$r?pageSize=100"); printf '%s: itens=%s %s %s\n' "$r" "$(printf '%s' "$resp" | grep -c '"name"')" "$(printf '%s' "$resp" | grep -oE 'http=[0-9]+')" "$(printf '%s' "$resp" | grep -oE '"status": *"[A-Z_]+"' | head -1)"; done; unset CHAVE resp
    ```

    **Como ler o resultado:**
    - `http=200` com `itens=0`: nada guardado.
    - `itens=100`: há mais páginas. Registre "100 ou mais".
    - Qualquer `itens` acima de zero: a contagem é aproximada, porque conta os campos `name`. Abra o recurso no AI
      Studio e registre a quantidade real.
    - `http=404` ou outro erro: o recurso não pôde ser conferido. Registre "não conferível" (§6, R2 e R8).

    Os arquivos expiram em pouco tempo: uma contagem zero vale só para hoje e não prova que nunca houve arquivos (§6,
    R2).
  - No AI Studio, veja se o registro de solicitações (logs) estava ativo no projeto e se há registros.
- **Onde:**
  - Cloud Console → APIs e serviços → Generative Language API → Métricas (filtro ou gráfico por credencial).
  - O seu terminal.
  - AI Studio.
- **Responsável:** o proprietário.
- **Evidência:**
  - `EV-E00-L6-01`: uma captura das métricas, sem valores de chave, com o período coberto;
  - `EV-E00-L6-02`: as contagens por chave e por recurso (com os não conferíveis) e se havia logs.
- **Resultado esperado:** para cada chave, o período coberto e uma classificação preliminar:
  - uso legítimo;
  - uso suspeito;
  - uso não autorizado confirmado;
  - histórico indisponível ou inconclusivo.
- **Risco:** prolongar a validade da chave. Por isso a fotografia é curta, e o faturamento fica para o passo 4.1, porque
  não depende da chave.
- **Prossiga quando:** as métricas e as contagens estiverem registradas, ou registrado que o console não as mostra.

**Passo 3 — Revogar e desativar as APIs de IA no projeto do Firebase** (linhas 2 e 7).
- **Ação:**
  - **Exclua toda chave G e toda chave V,** exceto a W, que segue o passo 5:
    - no AI Studio, menu da chave → excluir;
    - no Cloud Console, Credenciais → a chave → **Excluir**.

    Exclua, não "gire": a rotação do console pode manter a anterior válida por um tempo. Exclua mesmo que a chave tenha
    uso legítimo.
  - **Logo em seguida, no projeto do Firebase do app, desative a Generative Language API** e, se estiverem
    habilitadas, as APIs do Firebase AI Logic e da Vertex AI. O app não as usa no cliente. A IA do backend já fica sem
    chave com a revogação, e a parte B cria a chave nova no projeto de cada ambiente. Assim a chave W deixa de ser
    credencial de IA durante a espera do passo 4, antes mesmo da restrição do passo 5.
  - Nos projetos criados pelo AI Studio, desativar a API também é recomendado, se não houver outro uso.
  - Antes de excluir, guarde o valor de cada chave G e V só para o teste do passo 4, pela exceção das regras.
- **Onde:** AI Studio; Cloud Console → Credenciais; APIs e serviços → APIs e serviços ativados.
- **Responsável:** o proprietário.
- **Evidência:**
  - `EV-E00-L2-01`: a hora da exclusão de cada chave;
  - `EV-E00-L7-02`: as APIs de IA desativadas no projeto do Firebase, ou a justificativa para manter alguma, com a prova
    de que nenhuma chave válida a permite.
- **Resultado esperado:** toda chave G e V aparece como excluída, e nenhuma API de IA fica habilitada no projeto do
  Firebase sem justificativa.
- **Risco:**
  - A IA do backend para de funcionar até a parte B e falha fechada: sem chave configurada, `readApiKey` recusa a
    chamada (`functions/src/ai/callables.ts:133-142`); com a chave revogada, o provedor recusa. Isso é aceitável, porque
    não há usuários reais (plano §1).
  - A exclusão é **reversível por 30 dias** (undelete): a chave volta a valer se alguém com permissão a restaurar (passo
    0).
- **Prossiga quando:** todas as chaves G e V estiverem excluídas e as APIs de IA do projeto do Firebase, desativadas ou
  justificadas.

**Passo 4 — Conferir a revogação** (linha 2).
- **Ação:**
  1. Espere **pelo menos 30 minutos** depois da exclusão: a exclusão pode levar cerca de 20 minutos para valer em todos
     os servidores.
  2. Teste cada chave G e V no seu terminal, sem deixá-la no histórico nem na lista de processos. O cabeçalho vai pela
     entrada padrão do `curl`, e o comando imprime só:
     - os 4 últimos caracteres, para conferir que você colou a chave certa (um valor errado também dá
       `API_KEY_INVALID`);
     - o motivo;
     - o código HTTP.

     ```bash
     read -rs CHAVE && printf 'final: %s\n' "${CHAVE: -4}" && printf 'x-goog-api-key: %s\n' "$CHAVE" | curl -sS -H @- -w '\nhttp=%{http_code}\n' https://generativelanguage.googleapis.com/v1beta/models | grep -oE 'API_KEY_INVALID|API_KEY_SERVICE_BLOCKED|API_KEY_HTTP_REFERRER_BLOCKED|PERMISSION_DENIED|SERVICE_DISABLED|http=[0-9]+' | sort -u; unset CHAVE
     ```

     No Windows, use o Git Bash ou o WSL.
  3. No Logs Explorer, guarde o registro da exclusão com a consulta abaixo. Anote, de cada exclusão, a data e hora, o uid
     da chave e a conta que excluiu:

     ```
     protoPayload.serviceName="apikeys.googleapis.com"
     protoPayload.methodName=~"DeleteKey|UndeleteKey|UpdateKey"
     ```

  4. Confirme que não há `UndeleteKey` nem `UpdateKey` da chave depois da exclusão. Repita essa conferência:
     - no dia seguinte;
     - na reemissão das revisões;
     - antes de qualquer publicação em produção;
     - depois de 30 dias, quando a chave deixa de ser restaurável.
  5. **Se você não tem mais o valor da chave à mão,** procure-o, sem mostrá-lo, em todos os lugares abaixo, e teste
     cada valor achado. O vínculo entre o valor e a chave do inventário é o final e o uid (`CreateKey` e `DeleteKey`).
     Se o inventário não tiver o final (caso da `FênixGran`, E01), registre de cada valor o local, o final, o motivo e
     o código HTTP: o teste vale para aquele valor.
     - **Secret Manager de cada projeto,** para cada segredo anotado no passo 1, item 3, que possa guardar uma chave do
       Google, a começar por `GOOGLE_AI_API_KEY`. Rode no Cloud Shell, ou num terminal com o `gcloud` autenticado,
       trocando `<projeto>` pelo ID do projeto e, se for o caso, o nome do segredo. O comando lê cada versão sem
       mostrá-la, não envia ao Google nada que não seja uma chave `AIza` e imprime só o segredo, a versão, o final, o
       motivo e o código HTTP. Ele foi validado com um `gcloud` simulado e valores fictícios. Nunca rode
       `gcloud secrets versions access` sozinho: ele imprime o valor.

       ```bash
       bash -s '<projeto>' 'GOOGLE_AI_API_KEY' <<'FIM'
       p="$1"; s="$2"; for ver in $(gcloud secrets versions list "$s" --project="$p" --format='value(name)'); do n="${ver##*/}"
         v=$(gcloud secrets versions access "$n" --secret="$s" --project="$p" 2>/dev/null) || { printf '%s versão %s: não acessível (desativada ou destruída)\n' "$s" "$n"; continue; }
         printf '%s' "$v" | grep -qE '^AIza[0-9A-Za-z_-]{35}$' || { printf '%s versão %s: não é chave AIza, não testada\n' "$s" "$n"; unset v; continue; }
         r=$(printf 'x-goog-api-key: %s\n' "$v" | curl -sS -H @- -w '\nhttp=%{http_code}' https://generativelanguage.googleapis.com/v1beta/models | grep -oE 'API_KEY_INVALID|API_KEY_SERVICE_BLOCKED|API_KEY_HTTP_REFERRER_BLOCKED|SERVICE_DISABLED|PERMISSION_DENIED|http=[0-9]+' | sort -u | tr '\n' ' ')
         printf '%s versão %s: AIza…%s: %s\n' "$s" "$n" "${v: -4}" "$r"; unset v; done
       FIM
       ```

       Uma versão "não acessível" não prova nada sobre a chave: registre-a assim.
     - **Numa estação ou num Codespace,** nos `.env*` da raiz e de `functions/`, nos perfis do shell e no ambiente
       (`env`, onde ficam os segredos do Codespaces). Rode na pasta do projeto, **antes da limpeza do passo 7**. O
       comando imprime só o local, o nome da variável, o final, o motivo e o código HTTP, e foi validado com arquivos e
       variáveis fictícios:

       ```bash
       bash -s <<'FIM'
       e="^(export +)?(GEMINI_API_KEY|API_KEY|GOOGLE_AI_API_KEY|VITE_[A-Z0-9_]+)=[\"']?AIza"
       { for f in .env .env.* functions/.env functions/.env.* ~/.bashrc ~/.zshrc ~/.profile; do [ -f "$f" ] && grep -E "$e" "$f" | while IFS= read -r l; do printf '%s|%s\n' "${f/#$HOME/\~}" "$l"; done; done
         env | grep -E "$e" | while IFS= read -r l; do printf 'env|%s\n' "$l"; done; } | while IFS='|' read -r f l; do
         n=$(printf '%s' "$l" | sed -E 's/^(export +)?([A-Z0-9_]+)=.*/\2/'); v=$(printf '%s' "$l" | grep -oE 'AIza[0-9A-Za-z_-]{35}' | head -1); [ -n "$v" ] || continue
         r=$(printf 'x-goog-api-key: %s\n' "$v" | curl -sS -H @- -w '\nhttp=%{http_code}' https://generativelanguage.googleapis.com/v1beta/models | grep -oE 'API_KEY_INVALID|API_KEY_SERVICE_BLOCKED|API_KEY_HTTP_REFERRER_BLOCKED|SERVICE_DISABLED|PERMISSION_DENIED|http=[0-9]+' | sort -u | tr '\n' ' ')
         printf '%s: %s AIza…%s: %s\n' "$f" "$n" "${v: -4}" "$r"; unset v; done
       FIM
       ```

     - **Num `dist/` ou build antigo guardado:** rode na pasta que o contém, trocando `dist` pelo nome dela. O comando
       imprime só a pasta, o final, o motivo e o código HTTP, e foi validado com um bundle fictício:

       ```bash
       bash -s 'dist' <<'FIM'
       grep -rhoE 'AIza[0-9A-Za-z_-]{35}' "$1" | sort -u | while read -r k; do r=$(printf 'x-goog-api-key: %s\n' "$k" | curl -sS -H @- -w '\nhttp=%{http_code}' https://generativelanguage.googleapis.com/v1beta/models | grep -oE 'API_KEY_INVALID|API_KEY_SERVICE_BLOCKED|API_KEY_HTTP_REFERRER_BLOCKED|SERVICE_DISABLED|PERMISSION_DENIED|http=[0-9]+' | sort -u | tr '\n' ' '); printf '%s: AIza…%s: %s\n' "$1" "${k: -4}" "$r"; done
       FIM
       ```

     - **No bundle servido, em cada site e canal:** a varredura do passo 6, item 3, testa cada chave `AIza` que achar.
     - **No gerenciador de senhas, ou num histórico de chat ou de assistente de IA em que o valor tenha sido colado:**
       use o teste do item 2, colando o valor. Depois apague a mensagem do histórico (passo 7).
     - **Valor inexistente em todos esses lugares:** vale a prova alternativa do D-ORD-08 (§3, linha 2), chave a chave.
       Ela não substitui o teste quando ele é possível.

     Se algum valor achado der `http=200`, a chave ainda funciona: faça com ela o passo 2, curto, e volte ao passo 3.
- **Como ler o teste:**

  | Saída | Significado |
  | --- | --- |
  | `final:` igual ao inventário, `API_KEY_INVALID` e `http=400` | Chave excluída. É o esperado |
  | `http=403`, com `API_KEY_SERVICE_BLOCKED`, `API_KEY_HTTP_REFERRER_BLOCKED`, `SERVICE_DISABLED` ou `PERMISSION_DENIED` | A chave **existe** e está só restrita, ou a API está desativada: não prova a exclusão |
  | `http=200` | **A chave ainda funciona.** Faça o passo 2, curto, e volte ao passo 3 |
  | `http=000` ou erro do `curl` | Falha de rede, sem resultado. Repita |

- **Onde:** o seu terminal; Cloud Console → Logging → Logs Explorer.
- **Responsável:** o proprietário.
- **Evidência:**
  - `EV-E00-L2-02`: a saída do teste por valor achado (local, final, motivo e código);
  - `EV-E00-L2-03`: o registro `DeleteKey` por chave, sem `UndeleteKey` nem `UpdateKey` depois, conferido pelo menos
    24 horas depois da exclusão;
  - `EV-E00-L2-04`, só na prova alternativa do D-ORD-08: a chave em estado excluído, com a data, e as declarações de
    que o valor não existe em nenhum dos lugares do item 5.
- **Resultado esperado:** para cada chave G e V, `API_KEY_INVALID` e `http=400` em todo valor achado, com o final
  conferido, num teste feito pelo menos 30 minutos depois da exclusão, e o `DeleteKey` correspondente. Só quando o
  valor não existir em nenhum lugar do item 5, a prova alternativa do D-ORD-08.
- **Risco:** um teste cedo demais ainda pode passar.
- **Prossiga quando:** toda chave G e V tiver esse resultado, ou a prova alternativa, e o `DeleteKey`.

**Passo 4.1 — Faturamento do período** (linha 6; depois da revogação).
- **Ação:** nos relatórios de faturamento, desde 2026-01-22, anote o custo e o volume:
  - por projeto e por SKU do Gemini;
  - para o projeto do Firebase, de todos os serviços cobrados (o uso da chave W).

  Compare com o uso esperado do app e anote picos e serviços inesperados. Se o projeto não tiver conta de faturamento
  (uso gratuito), registre isso: nesse caso não há dado de faturamento.
- **Onde:** Cloud Console → Faturamento → Relatórios (filtros por projeto, serviço e SKU).
- **Responsável:** o proprietário.
- **Evidência:** `EV-E00-L6-03`, o resumo do faturamento, sem dados de pagamento.
- **Resultado esperado:** a conclusão por projeto, uma das quatro classificações do passo 2, com o período coberto.
- **Risco:** nenhum para a contenção.
- **Prossiga quando:** o resumo estiver registrado.

**Passo 5 — Tirar a IA da chave web e restringir as chaves que continuam válidas** (linha 7; decisão D-ORD-07).
- **Por que a chave web importa.** Ela é pública por desenho, então a contenção não depende de mantê-la em segredo, e
  sim do que ela permite:
  - Com a Firebase AI Logic API na lista, ela permite chamar o Gemini pelo proxy da Firebase AI Logic, se esse serviço
    estiver configurado no projeto e o App Check não estiver aplicado nele. A cobrança vai para o projeto.
  - A restrição por referenciador HTTP não muda isso: o cabeçalho `Referer` é escolhido pelo cliente, e um script o
    falsifica.
  - Por isso, na P5, contam a lista de APIs da chave e o estado das APIs de IA no projeto. O referenciador é
    endurecimento da P6 (D-ORD-07).
  - O risco que fica até a P6 está registrado no D-ORD-07 e não é aceito: abuso de quota e de custo das APIs que não
    são de IA (cadastro em massa, e-mails de redefinição de senha, SMS se o provedor Telefone estiver ativo, leituras e
    escritas sob as Rules publicadas). O referenciador também não o impediria. As Rules publicadas são anteriores à P1
    e não são as testadas (D-ORD-04), por isso não contam como controle.
- **Ação:**
  1. **Confirme o passo 3 no projeto do Firebase.**
     - A Generative Language API, a Firebase AI Logic API e a Vertex AI API estão desativadas, ou há justificativa para
       cada uma habilitada.
     - No Firebase Console, a página da AI Logic mostra o serviço não configurado.
     - O app não usa a Firebase AI Logic: o cliente não importa `firebase/ai` nem `firebase/vertexai` em nenhum commit
       disponível.
     - Se um dia a AI Logic for configurada, só com o App Check aplicado nela e por nova decisão que reavalie o
       D-ORD-07. Até lá, a Firebase AI Logic API não volta à chave web.
  2. **Na chave W, tire da lista de APIs permitidas toda API de IA ou de ML.**
     - Saem a Firebase AI Logic API e a ML Kit API, que estão hoje na lista (E03, §8).
     - Sai também qualquer uma destas, se aparecer: Generative Language API, Vertex AI API, Firebase ML API, Cloud Vision
       API, Cloud Natural Language API, Cloud Speech-to-Text API, Cloud Text-to-Speech API e Cloud Translation API.
     - Essas APIs, mais qualquer outra de IA ou de ML, são o que este documento, a §9.4 e o D-ORD-07 chamam de "API
       de IA ou de ML".
     - Por enquanto ficam as outras APIs do Firebase. A redução à lista mínima do app vai, com o referenciador, para a
       P6 (item 3).

     Pelo código, o app usa:
     - Firebase Authentication (e-mail e senha, e Google por popup): Identity Toolkit API e Token Service API;
     - Cloud Firestore: Cloud Firestore API;
     - callables do Cloud Functions, que não usam a chave;
     - o Storage é inicializado, mas não é usado.

     Tirar APIs que o app não usa não afeta o app.
  3. **Restrição de aplicativo (referenciadores HTTP): transferida para a P6 pelo D-ORD-07.**
     - **Não é exigida para a P5.**
     - **É obrigatória antes de qualquer usuário real e antes da homologação** (`LAUNCH_CHECKLIST.md`, item 1.13.1; E-03
       do `FIREBASE_PRODUCTION.md`), junto com a lista mínima de APIs, numa chave por ambiente. Nenhum domínio de
       Codespace entra nas chaves de PROD e STAGING.
     - **Com os ambientes separados da P6,** o desenvolvimento no GitHub Codespaces usa o projeto de DEV ou o Emulator.
       Os domínios autorizados do Firebase Authentication não aceitam curinga: o login com Google num codespace exige o
       domínio daquele codespace na lista do DEV, ou o Emulator.
     - **Por que não uma lista provisória na chave de produção hoje.** Uma lista com os dois domínios do Hosting e
       `https://*.app.github.dev/*` não quebraria o Codespaces, mas valeria pouco: qualquer conta do GitHub cria um
       codespace com endereço nesse padrão, e o `Referer` é escolhido pelo cliente. Só os domínios do Hosting
       quebrariam o Codespaces, que hoje desenvolve contra o projeto de produção (PR-PLAT-01).
     - **Gatilhos que antecipam o referenciador e a lista mínima:** sinal de abuso na linha 6 (uso não reconhecido, pico
       ou serviço inesperado no faturamento), uma conta de fora da equipe no Authentication de produção (§6, R7) ou
       qualquer publicação em produção.
  4. **Prove que a chave W não chama o Gemini.** O valor da chave W é público por desenho, mas ainda assim não vai em
     argumento de linha de comando:

     ```bash
     read -rs CHAVE && printf 'final: %s\n' "${CHAVE: -4}" && printf 'x-goog-api-key: %s\nReferer: https://<projeto>.web.app/\n' "$CHAVE" | curl -sS -H @- -w '\nhttp=%{http_code}\n' https://generativelanguage.googleapis.com/v1beta/models | grep -oE 'API_KEY_SERVICE_BLOCKED|API_KEY_HTTP_REFERRER_BLOCKED|SERVICE_DISABLED|PERMISSION_DENIED|http=[0-9]+' | sort -u; unset CHAVE
     ```

     O esperado é `http=403`, com `API_KEY_SERVICE_BLOCKED` ou `SERVICE_DISABLED`. Um `http=200` significa que a chave
     W ainda é credencial do Gemini: corrija a lista. A varredura do passo 6, item 3, repete esse teste com a chave W
     servida no site. O 403 prova só o caminho direto ao Gemini. O caminho pela AI Logic se prova pela lista da chave
     (`EV-E00-L7-01`) e pelo serviço não configurado, com as APIs desativadas (`EV-E00-L7-02`).
  5. **Teste o app depois de mudar a lista,** no Codespaces e nos dois domínios do Hosting:
     - login com e-mail e senha;
     - login com Google;
     - carregar o painel;
     - uma ação que chama uma callable;
     - depois de cerca de uma hora, recarregar sem sair da conta.

     Se algo quebrar, devolva à lista só a API, que não seja de IA, de que o app precisar. Nunca devolva uma API de IA
     ou de ML.
  6. **Chaves O:** restrinja cada uma às APIs de que precisa, nunca às de IA ou de ML, ou exclua-a se não tiver uso.
  7. **Substituição da chave W, só se a lista não puder ser corrigida, ou se os passos 2 e 4.1 mostrarem abuso dela.**
     É uma publicação em produção: decisão sua, só depois dos passos 4 e 7.
     1. Crie uma chave nova com a restrição de API, sem IA nem ML. O referenciador fica para a P6.
     2. Escolha a origem do build:
        - **A versão do frontend que está em produção hoje, publicando só o Hosting.** É o caminho de menor impacto,
          porque não muda o contrato com o backend de produção. Esse código ainda lê `import.meta.env` como objeto e não
          tem a varredura do bundle (§1). Por isso só é aceitável numa estação já limpa (passo 7), com apenas as
          variáveis públicas por desenho, e com o `dist` conferido antes do deploy (item 3).
        - **Uma árvore com a correção do §1:** a árvore testada `06cf3296` ou sucessora, o que exige o checkpoint
          autorizado. Ela tem a varredura no build e no `predeploy`, mas o frontend dela espera o backend da P5:
          publicar só o Hosting sobre o backend atual pode quebrar o app. Publicar o backend junto é uma liberação de
          produção, sujeita aos bloqueios da P6 em diante.
     3. Faça o build com `VITE_FIREBASE_API_KEY` trocada e confira o `dist` antes de publicar. O comando imprime só nomes
        e finais mascarados:

        ```bash
        grep -ohE 'VITE_[A-Z0-9_]+|AIza[0-9A-Za-z_-]{35}' dist/assets/*.js | sed -E 's/^(AIza).*(.{4})$/\1…\2/' | sort | uniq -c
        ```

        O esperado é ver só os nomes públicos por desenho (passo 6, item 4) e uma única chave `AIza`, com o final da
        chave nova. Qualquer outro nome ou chave impede o deploy.
     4. Publique o Hosting. Registre a origem do build (commit ou árvore), a saída do item 3 e o identificador da versão
        do Hosting.
     5. Rode o passo 6, item 3, no site publicado. Depois exclua a chave antiga e confira com o passo 4.

     Até isso acontecer, a lista sem IA e sem ML na chave atual é a contenção mínima obrigatória.
  8. **Recomendado já, sem ser critério da P5:** um alerta de orçamento no projeto de produção (antecipa o E-08) e os
     provedores Telefone e Anônimo do Authentication desativados, se estiverem ativos (o app usa só e-mail e senha, e
     Google).
- **Onde:**
  - Cloud Console → Credenciais → a chave → restrições de API.
  - APIs e serviços → APIs e serviços ativados.
  - Firebase Console → AI Logic.
  - O seu terminal.
  - O app, no Codespaces e no Hosting.
- **Responsável:** o proprietário. A decisão de publicação também é dele.
- **Evidência:**
  - `EV-E00-L7-00`: a lista de APIs e as restrições da chave W antes da mudança (o estado informado na E03), numa
    captura sem o valor;
  - `EV-E00-L7-01`: a lista de APIs da chave W e das chaves O depois da mudança, numa captura sem o valor;
  - `EV-E00-L7-02`: as APIs de IA desativadas no projeto e a página da AI Logic;
  - `EV-E00-L7-03`: o teste do app;
  - `EV-E00-L7-04`: a saída do item 4.
- **Resultado esperado:**
  - Em todo projeto da linha 1 e no do Firebase, nenhuma chave válida permite uma API de IA ou de ML. Uma chave sem
    restrição de API conta como se permitisse.
  - As APIs de IA ficam desativadas no projeto do Firebase, ou justificadas.
  - O item 4 dá `http=403`.
  - O app funciona.
  - A restrição por referenciador não é exigida para a P5 (D-ORD-07).
- **Risco:** tirar uma API que o app usa derruba o login ou o Firestore. Por isso só saem as de IA e de ML.
- **Prossiga quando:** nenhuma chave válida permitir IA ou ML e o app funcionar.

**Passo 6 — Inventariar as outras `VITE_*` publicadas** (linha 8).
- **Ação:**
  1. **Delimite a janela de publicação.** No Firebase Console, abra cada site do Hosting do projeto e, em cada um, o
     histórico de versões e os canais de visualização (preview channels). Anote:
     - a data da primeira e da última publicação;
     - a versão ativa hoje;
     - quem publicou cada versão;
     - os canais de visualização existentes.

     Depois da varredura do item 3, exclua os canais de visualização sem uso, porque eles servem bundles antigos. A
     data de 2026-05-24 é só o limite do clone raso, não o primeiro deploy.
  2. **Em cada estação que publicou,** liste só os **nomes**:
     - na pasta do projeto, `grep -hoE '^(export +)?VITE_[A-Z0-9_]+' .env .env.local .env.production .env.production.local 2>/dev/null | sed -E 's/^export +//' | sort -u`;
     - no shell, `env | grep -oE '^VITE_[A-Z0-9_]+' | sort -u`;
     - nos perfis do shell (`~/.bashrc`, `~/.zshrc`, `~/.profile`), a mesma busca do primeiro comando.

     Os comandos não mostram valores.
  3. **No site publicado, em cada site e canal,** varra todo o JavaScript servido, inclusive os arquivos carregados sob
     demanda que a busca das ferramentas do navegador não vê. O comando:
     - imprime a quantidade de arquivos, os nomes de `VITE_*` e as chaves `AIza` só com os 4 últimos caracteres;
     - não grava nada em disco.

     Ele foi validado num build local com um marcador fictício num arquivo carregado sob demanda, e chama o bash por
     conta própria, também a partir do zsh. Troque o endereço pelo do site:

     ```bash
     bash -s 'https://<projeto>.web.app' <<'FIM'
     site="$1"; fila=$(curl -fsS "$site/" | grep -oE '(assets/|\./)[A-Za-z0-9._-]+\.js' | sed 's#^\./#assets/#' | sort -u); vistos=""
     while [ -n "$fila" ]; do novos=""; for f in $fila; do vistos="$vistos $f"; novos="$novos $(curl -fsS "$site/$f" | grep -oE '(assets/|\./)[A-Za-z0-9._-]+\.js' | sed 's#^\./#assets/#')"; done; fila=$(for f in $novos; do case " $vistos " in *" $f "*) ;; *) echo "$f";; esac; done | sort -u); done
     js=$(for f in $vistos; do curl -fsS "$site/$f"; done); echo "arquivos JS: $(echo $vistos | wc -w)"; printf '%s' "$js" | grep -oE 'VITE_[A-Z0-9_]+' | sort | uniq -c
     printf '%s' "$js" | grep -oE 'AIza[0-9A-Za-z_-]{35}' | sort -u | while read -r k; do r=$(printf 'x-goog-api-key: %s\n' "$k" | curl -sS -H @- -w '\nhttp=%{http_code}' https://generativelanguage.googleapis.com/v1beta/models | grep -oE 'API_KEY_INVALID|API_KEY_SERVICE_BLOCKED|API_KEY_HTTP_REFERRER_BLOCKED|SERVICE_DISABLED|PERMISSION_DENIED|http=[0-9]+' | sort -u | tr '\n' ' '); printf 'AIza…%s: %s\n' "${k: -4}" "$r"; done; unset js
     FIM
     ```

     O comando também testa cada chave `AIza` achada, sem mostrá-la. Ele imprime só o final, o motivo e o código
     HTTP. **A saída só vale** se mostrar:
     - `arquivos JS:` maior que zero;
     - nenhuma mensagem de erro do `curl`;
     - a chave web (`AIza…` com o final dela), com `http=403` e `API_KEY_SERVICE_BLOCKED` ou `SERVICE_DISABLED`.

     Se não mostrar, repita. Uma chave `AIza` diferente da chave web é outra chave do Google publicada, da classe V:
     - com `API_KEY_INVALID` e `http=400`, ela já está excluída, e essa saída serve de evidência da linha 2;
     - com qualquer outra saída, volte ao passo 3.
  4. **Classifique os nomes:**

     | Classe | Nomes |
     | --- | --- |
     | Públicos por desenho | Os seis `VITE_FIREBASE_*` (`API_KEY`, `AUTH_DOMAIN`, `PROJECT_ID`, `STORAGE_BUCKET`, `MESSAGING_SENDER_ID`, `APP_ID`), `VITE_USE_FIREBASE_EMULATORS` e `VITE_E2E_MODE` |
     | Segredos conhecidos | `VITE_GOOGLE_AI_KEY`, que o cliente leu até 2026-08-24, e `VITE_GEMINI_API_KEY` |
     | Qualquer outro nome | Possível segredo |

  5. **Revogue cada segredo no provedor, ou gire-o com a anterior invalidada na hora.** Uma rotação com período de
     carência não conta; no Stripe, por exemplo, isso é a rotação com expiração "agora".
  6. **Se a janela não puder ser comprovada,** porque o histórico não chega ao primeiro deploy ou uma estação não pode
     mais ser consultada, trate como exposta toda credencial que esteve em qualquer `.env*` ou no shell de uma estação
     que publicou, durante o período não coberto. Revogue ou gire cada uma com invalidação imediata, e registre a lista.
     A declaração do passo 7 cobre também essas credenciais.
- **Onde:**
  - Firebase Console → Hosting (cada site, histórico de versões e canais).
  - As estações que publicaram.
  - O seu terminal.
  - O console de cada provedor.
- **Responsável:** o proprietário, mais o dono de cada estação que publicou.
- **Evidência:**
  - `EV-E00-L8-01`: a janela de publicação, com os sites e os canais;
  - `EV-E00-L8-02`: os nomes por estação;
  - `EV-E00-L8-03`: a saída do item 3 por site e canal;
  - `EV-E00-L8-04`: a data da revogação ou da rotação de cada segredo, inclusive os do item 6.
- **Resultado esperado:** a lista de nomes desde o primeiro deploy, ou a compensação do item 6, com todo segredo
  revogado ou girado com invalidação imediata, e a data de cada um.
- **Risco:** um segredo esquecido continua válido. Abrir os valores dos `.env` expõe o segredo outra vez.
- **Prossiga quando:** todo nome não público tiver destino registrado.

**Passo 7 — Limpar as estações** (linha 5).
- **Ação:**
  1. Cada pessoa que rodou desenvolvimento, build ou deploy do app apaga da própria estação:
     - `GEMINI_API_KEY`, `VITE_GOOGLE_AI_KEY` e `VITE_GEMINI_API_KEY`;
     - `API_KEY`, se guardar uma chave do Gemini;
     - qualquer outra `VITE_*` de segredo;
     - as credenciais do passo 6.6.

     A limpeza vale para:
     - os `.env*` da raiz e de `functions/`;
     - os perfis do shell (`~/.bashrc`, `~/.zshrc`, `~/.profile`);
     - as configurações de execução do editor;
     - o histórico do shell;
     - as cópias sincronizadas ou de backup desses arquivos;
     - no GitHub Codespaces: os segredos de Codespaces (nas configurações da conta e do repositório), cada codespace
       existente, com os `.env*` dele, e o repositório de dotfiles, se houver;
     - os históricos de chat e de assistentes de IA (como o ChatGPT) em que um valor de chave ou o conteúdo de um
       `.env` tenha sido colado: apague essas mensagens.

     Se a chave ainda estiver num `.env`, rode antes o teste do passo 4, item 5.
  2. Para achar a chave no histórico sem imprimi-la, conte as ocorrências. Apague as linhas encontradas no editor:

     ```bash
     grep -c 'AIza' ~/.bash_history ~/.zsh_history 2>/dev/null
     ```

  3. Depois da limpeza, repita o passo 6.2 e o passo 1, item 4. O esperado é nenhum nome de segredo e nenhuma chave
     `AIza` numa `VITE_*`.
  4. Por fim, cada pessoa assina a declaração:

     > Eu, \<nome>, na estação \<identificador, por exemplo "notebook pessoal" ou "Codespaces do repositório">, em
     > \<data>, removi as variáveis \<lista de nomes: `GEMINI_API_KEY`, `VITE_GOOGLE_AI_KEY`, `VITE_GEMINI_API_KEY`, outras> de
     > \<locais: `.env*` da raiz e de `functions/`, perfis e histórico do shell, editor, cópias, segredos e codespaces do
     > GitHub, históricos de chat e de assistentes de IA>. Antes da limpeza, testei pelo passo 4, item 5, todo valor de
     > chave do Google achado \<local, final e resultado de cada um, ou "nenhum achado">, e não guardo o valor de
     > nenhuma chave G ou V \<finais> em outro lugar. A reconferência só de nomes (passo 6, item 2, e passo 1, item 4)
     > não encontrou segredo. Não enviei nem mostrei o conteúdo desses arquivos.

  Ninguém envia nem mostra o conteúdo dos arquivos.
- **Onde:** cada estação.
- **Responsável:** o dono de cada estação.
- **Evidência:** `EV-E00-L5-01` a `EV-E00-L5-NN`, uma declaração por estação, e a lista de estações (do passo 6.1 e de
  quem desenvolve).
- **Resultado esperado:** uma declaração para cada estação da lista. As declarações são autodeclarações, e essa
  limitação vai para o §6, R8.
- **Risco:** uma estação esquecida republica a chave num build futuro. A guarda do bundle (§1) reprova esse build, mas
  só nas árvores que têm a correção.
- **Prossiga quando:** todas as estações tiverem declaração.

**Passo 8 — Avaliar o impacto aos titulares** (linha 9).
- **Ação:** preencha a matriz do §6 com os resultados dos passos 2, 4.1 e 6, e registre a conclusão sobre risco ou dano
  relevante aos titulares. Siga a regra de conclusão do §6.
- **Onde:** um documento privado do proprietário. No repositório (§6), entram só categorias, contagens, a conclusão e o
  identificador, nunca dados pessoais.
- **Responsável:** o proprietário, como controlador (papel a confirmar: D-21, PRIV-07, E-09), com o encarregado
  (D-21). O jurídico valida na parte C. Enquanto o
  encarregado não estiver designado, o proprietário assina sozinho e registra essa ausência para o jurídico.
- **Evidência:** `EV-E00-L9-01`, a matriz preenchida e assinada.
- **Resultado esperado:** uma conclusão fundamentada, uma das três:
  - sem indício de dado pessoal afetado;
  - possível;
  - confirmado.

  A conclusão leva as limitações da evidência.
- **Risco:** tomar a falta de registro como prova de ausência de abuso. Isso não vale.
- **Prossiga quando:** a matriz estiver completa e assinada. A conclusão vai para a parte C (§7).

**Passo 9 — Registrar a evidência** (linhas 1, 2 e 5 a 9).
- **Ação:** para cada linha, preencha a matriz do §4:
  - estado;
  - responsável;
  - data;
  - fonte;
  - resultado constatado;
  - limitações;
  - identificador da evidência.

  Atualize a linha correspondente da §9.4 com o mesmo estado, data e responsável.
- **Responsável:** o proprietário. Um agente pode transcrever o que o proprietário informar, citando a origem, mas não
  decide o estado.
- **Resultado esperado:** as duas tabelas coerentes.
- **Prossiga quando:** tudo estiver registrado. Então as revisões de plataforma e de privacidade e o gate são reemitidos
  (§3).

### Parte B — credenciais novas, Secret Manager e ambientes (E-05, P6; §9.4, linhas 3 e 4)

Exigida **antes de a IA rodar em qualquer ambiente remoto** (DEV, STAGING ou PROD) e **antes da produção**. Ela depende
dos projetos separados da P6 (PR-PLAT-01, E-01) e não é condição para aprovar a P5. Não substitui a parte A: criar uma
chave nova não anula a exposta. Não é antecipada nesta rodada.

10. **Chave nova por ambiente** (linha 3; E-05 em `FIREBASE_PRODUCTION.md`): uma por ambiente, no projeto do ambiente,
    com restrição de API à **Generative Language API** e quota diária. A API só é reabilitada num projeto junto com
    essa chave restrita. Nenhuma outra chave do projeto, a chave web em especial, passa a permiti-la.
11. **Secret Manager** (linha 4; E-05): a chave nova guardada só como `GOOGLE_AI_API_KEY` das Functions, com versões
    antigas desativadas e `secretAccessor` só para quem a declara. Nunca em variável `VITE_*`, `define`, `.env` do
    frontend nem no repositório.

### Parte C — comunicação do incidente (prazo regulamentar, se houver risco relevante, e sempre antes da produção; §9.4, linha 10)

12. **Decidir, com o jurídico, se a ANPD e os titulares serão comunicados.** A decisão se baseia na avaliação do passo 8
    e segue:
    - `PRIVACY_LGPD.md` §12;
    - `INCIDENT_RESPONSE.md` §6.6;
    - o processo de incidentes PR-OBS-02, da P7;
    - o E-09, da P8.

    O resumo para o jurídico, com marcos, prazos e as perguntas a responder, está no §7. A consulta sobre o marco da
    ciência não espera o passo 8.

## 3. Critérios objetivos

**Para as revisões de plataforma (`firebase-production-readiness`) e de privacidade (`privacy-lgpd-data-lifecycle`,
pela linha 9) da P5 deixarem de ser `FAIL` pelo E-00.** Cada linha da parte A (1, 2 e 5 a 9) precisa estar em
VERIFICADO na §9.4 e na matriz do §4. Cada linha precisa de data, responsável, forma de verificação, identificador da
evidência e resultado igual ao valor esperado:

| Linha | O que precisa estar registrado |
| --- | --- |
| 1 | A lista de chaves de todos os projetos do passo 0, só com nome, uid, projeto, data de criação, restrições, final e classe (W, G, V, O; W prevalece), e as APIs de IA habilitadas por projeto |
| 2 | Para cada chave G e V, a saída do passo 4 em todo valor achado nos lugares do item 5 (o local, o final, `API_KEY_INVALID` e `http=400`), num teste feito pelo menos 30 minutos depois da exclusão; o vínculo com a chave é o final e o uid (`CreateKey` e `DeleteKey`). Também o registro `DeleteKey` no Cloud Audit Logs, sem `UndeleteKey` nem `UpdateKey` depois, conferido pelo menos 24 horas depois da exclusão e de novo na reemissão das revisões. **Prova alternativa (D-ORD-08), chave a chave, só quando o valor não existir em nenhum lugar do passo 4, item 5** (Secret Manager de cada projeto; `.env*` da raiz e de `functions/`, perfis do shell e `env` de cada estação e Codespace; `dist/` e builds antigos; bundle servido em cada site e canal; gerenciador de senhas; históricos de chat e de assistentes de IA): a chave em estado excluído, com a data; o `DeleteKey` do mesmo uid, com `status` vazio e `operation.last=true`; nenhum `UndeleteKey` ou `UpdateKey` dessa chave depois, conferido pelo menos 24 horas depois da exclusão; e a declaração do proprietário e a de cada dono de estação da linha 5, chave a chave, de que o valor não existe em nenhum desses lugares |
| 5 | A lista de estações e a declaração assinada de cada dono, cobrindo todos os locais do passo 7 e a reconferência só de nomes sem segredo |
| 6 | A revisão por credencial desde 2026-01-22, com: as métricas e o período que elas realmente cobrem (passo 2); as contagens de recursos guardados, com os não conferíveis; o faturamento dos SKUs do Gemini por projeto e, para a chave web, de todos os serviços cobrados do projeto (passo 4.1). Cada chave recebe uma das classificações: uso legítimo, uso suspeito, uso não autorizado confirmado, ou histórico indisponível ou inconclusivo. Ver as regras abaixo |
| 7 | As APIs de IA desativadas no projeto do Firebase, ou justificadas, e a AI Logic não configurada. Em todo projeto da linha 1 e no do Firebase, nenhuma chave que continua válida permite uma API de IA ou de ML (as do passo 5, item 2, como a Generative Language API, a Firebase AI Logic API, a Vertex AI API e a ML Kit API; uma chave sem restrição de API conta como se permitisse). A chave web fica sem nenhuma API de IA ou de ML na lista, ou é substituída por build verificado (passo 5, item 7), com a antiga excluída. A restrição por referenciador HTTP e a lista mínima de APIs não são exigidas para a P5: vão para o E-03 (P6), antes de qualquer usuário real (D-ORD-07). O teste do passo 5, item 4, dá `http=403` com `API_KEY_SERVICE_BLOCKED` ou `SERVICE_DISABLED`, e o app passa no teste do passo 5, item 5. O 403 prova só o caminho direto ao Gemini; o caminho pela AI Logic se prova pela lista da chave e pelo serviço não configurado |
| 8 | Os sites e canais do Hosting com a janela de publicação; a lista de nomes desde o primeiro deploy ou, se a janela não for comprovada, a compensação do passo 6, item 6; a saída válida da varredura do site (passo 6, item 3); a data da revogação ou da rotação de cada variável não pública. Rotação com carência não conta |
| 9 | A matriz do §6 preenchida e assinada, com a conclusão pela regra do §6 e as limitações |

**Regras da linha 6:**
- A linha pode ficar VERIFICADA com a conclusão "inconclusivo", desde que o período não coberto esteja registrado. O
  período não coberto é tratado como risco não excluído na linha 9: ausência de registro não prova ausência de abuso.
- Se houve uso de terceiros, a linha fica VERIFICADA com essa conclusão, e o uso é registrado como incidente. O abuso da
  chave web obriga a substituí-la (linha 7), e o resultado entra nas linhas 9 e 10.

**O que mantém o `FAIL`:**
- qualquer linha da parte A em NÃO VERIFICADO ou PARCIAL;
- linha sem data, sem responsável ou sem evidência;
- resultado diferente do esperado.

**Os casos mais comuns de `FAIL`:**
- no teste do passo 4, um `http=403`, um `http=200`, uma falha de rede ou um final diferente do inventário;
- um teste feito menos de 30 minutos depois da exclusão;
- uma chave "girada" sem exclusão;
- um `UndeleteKey` ou `UpdateKey` depois da exclusão;
- uma chave que continua válida e ainda permite uma API de IA ou de ML, como a Firebase AI Logic API na chave web;
- uma chave web substituída sem a conferência do `dist` (passo 5, item 7), ou numa estação não limpa;
- uma variável não pública sem revogação, ou girada com carência.

**Linhas 3, 4 e 10.** Não são exigidas para a P5 e ficam listadas na revisão como fora do escopo desta avaliação, com o
ID: E-05 (P6) para as linhas 3 e 4; PR-OBS-02 (P7) e E-09 (P8) para a linha 10. Não contam como `PASS` nem como `N/A`.

**Depois da parte A verificada,** as revisões de plataforma e de privacidade e o gate (`regression-release-gate`) são
reemitidos. Se só `docs/` mudar, a execução oficial do gate da árvore de código continua valendo.

**Antes de a IA rodar em qualquer ambiente remoto:** partes A e B (linhas 1 a 9).

**Liberação em produção:** partes A, B e C (linhas 1 a 10) VERIFICADAS, além dos blockers da P6 em diante. Antes de
qualquer publicação, a conferência de `UndeleteKey` do passo 4 é repetida.

**Prazo próprio da parte C:** se a linha 9 indicar risco ou dano relevante aos titulares, a decisão de comunicação segue
o prazo regulamentar (§7), independentemente da P5 e da produção.

**O que não conta como evidência:**
- declaração de agente;
- captura de tela ou texto com o valor de uma chave ou com dado pessoal;
- linha sem data ou sem responsável;
- "girar" no console sem excluir a chave anterior;
- um `403` no teste do passo 4;
- inferência a partir de outra linha.

## 4. Matriz de evidências da parte A

**Estados:**
- **NÃO VERIFICADO:** nada registrado.
- **PARCIAL:** parte do resultado registrada. Conta como não verificado.
- **VERIFICADO:** o critério do §3 foi cumprido e a evidência está identificada.

A informação recebida de terceiros e ainda não confirmada pelo proprietário fica nas colunas como "informado" e não
muda o estado. A §9.4 do `SECURITY_MODEL.md` é o registro canônico do estado; esta matriz guarda o detalhe da comprovação. Uma linha só
passa a VERIFICADO quando as duas estão preenchidas e coerentes, por quem fez a verificação. A coluna "Evidência" leva
só o identificador e a referência à pasta privada do proprietário, nunca o conteúdo nem dados pessoais.

| Linha | Item | Estado | Responsável | Data | Fonte da comprovação | Resultado constatado | Limitações | Evidência |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Chaves afetadas | NÃO VERIFICADO (informação parcial) | proprietário | — | E01, E03 (§8): Credenciais e AI Studio do projeto do app | Informado (§8), a confirmar com o original. No projeto do app: a chave do AI Studio `FênixGran` (classe G por dúvida: data de criação não informada; restrita à Gemini API; excluída) e a chave web (classe W, criada em 2025-09-09). O proprietário declara que era a única chave Gemini que conhecia | Faltam os outros projetos da conta, a lista atual do AI Studio, os uids (pelo `CreateKey`), os finais, os nomes dos segredos de cada projeto e as chaves das estações e dos Codespaces (classe V, passo 1, item 4) | `EV-E00-L1-01` (informado, parcial) |
| 2 | Revogação | NÃO VERIFICADO (informação parcial) | proprietário | — | E01, E02 (§8): credenciais excluídas; Cloud Audit Logs | Informado (§8), a confirmar com o original: chave `FênixGran` em estado excluído em 2026-11-16; um `DeleteKey` às 2026-11-16T14:50:46Z, com `status` vazio e `operation.last=true`; o uid do `DeleteKey` ainda não foi conferido com o da chave | Falta o teste `API_KEY_INVALID` de cada valor achado (passo 4, item 5, a começar pelo Secret Manager) ou, se o valor não existir em nenhum desses lugares, a prova alternativa do D-ORD-08; falta a busca de `UndeleteKey` e `UpdateKey` pelo menos 24 horas depois da exclusão | `EV-E00-L2-01`, `EV-E00-L2-03` (informados, parciais) |
| 5 | Estações | NÃO VERIFICADO | — | — | — | — | Inclui o GitHub Codespaces (E04) | — |
| 6 | Uso no período | NÃO VERIFICADO (informação parcial) | proprietário | — | E06 (§8): exportação do faturamento de 2026-01-01 a 2026-11-16 | Informado (§8), a confirmar com o original: Gemini API R$ 0,03 no período, reconhecido pelo proprietário como uso nos testes do app; os demais serviços cobrados (Secret Manager e Cloud Storage) não são de IA. Classificação provisória: uso legítimo declarado; inconclusivo para uso gratuito e por credencial | O faturamento é agregado por serviço, não por chave nem por mês, não mostra uso gratuito e cobre só o que foi exportado (projetos e contas a registrar, com o mês das cobranças do Gemini). Faltam as métricas por credencial, ainda não consultadas (passo 2), com o período coberto, e a conferência dos registros do AI Studio, que não depende da chave. A contagem de recursos guardados não é conferível com a chave `FênixGran`, já excluída; se outra credencial do mesmo projeto puder fazê-la (a confirmar, E-10), é decisão de plataforma do proprietário; senão, fica "não conferível" em R8 | `EV-E00-L6-03` (informado, parcial) |
| 7 | Restrição das chaves | NÃO VERIFICADO (informação parcial) | proprietário | — | E03 (§8): restrições da chave web | Informado (§8), a confirmar com o original: a chave web tem restrição de API (24 APIs, sem a Generative Language API), mas a lista inclui a Firebase AI Logic API e a ML Kit API, e não há restrição de aplicativo | Faltam: tirar as APIs de IA e de ML da lista, confirmar as APIs de IA desativadas e a AI Logic não configurada, o teste 403 e o teste do app (passo 5). O referenciador é da P6 (D-ORD-07) | `EV-E00-L7-00` (estado anterior, informado) |
| 8 | Outras `VITE_*` publicadas | NÃO VERIFICADO | — | — | E04 (§8): o Hosting tem os domínios `<projeto>.web.app` e `<projeto>.firebaseapp.com` | — | Faltam o histórico de versões e os canais, a varredura dos dois domínios e os nomes nas estações | — |
| 9 | Avaliação de impacto | NÃO VERIFICADO | — | — | E04 e E05 (§8) entram em R3 e R7 do §6 | — | Falta a matriz assinada pelo controlador, com a contagem das contas do Authentication de produção (R7) | — |

O que cada coluna recebe, por linha:

| Linha | Fonte da comprovação | Resultado esperado | Evidência |
| --- | --- | --- | --- |
| 1 | AI Studio; Credenciais, APIs ativadas e nomes dos segredos de cada projeto; Logs (`CreateKey`, e `UpdateKey` da chave W); estações e Codespaces | Lista completa com as classes e as APIs de IA por projeto | `EV-E00-L1-00`, `-01` |
| 2 | Teste do passo 4 em cada valor achado (Secret Manager, estações e Codespaces, builds e bundle); Logs (`DeleteKey`, sem `UndeleteKey` nem `UpdateKey`); ou a prova alternativa do D-ORD-08 | Final conferido, `API_KEY_INVALID`, `http=400` e `DeleteKey` por chave G e V, ou a prova alternativa | `EV-E00-L2-01` a `-04` |
| 5 | Declarações e reconferência só de nomes | Uma declaração por estação | `EV-E00-L5-01` a `-NN` |
| 6 | Métricas por credencial; contagens; AI Studio; faturamento | Período coberto e classificação por chave e por projeto | `EV-E00-L6-01` a `-03` |
| 7 | APIs ativadas; página da AI Logic; restrições das chaves, antes e depois; teste da chave W; teste do app | Nenhuma chave válida com IA ou ML; chave web sem IA nem ML na lista; `http=403`; app funcionando | `EV-E00-L7-00` a `-04` |
| 8 | Hosting (sites, versões e canais); nomes por estação; varredura do site; console dos provedores | Nomes desde o primeiro deploy, ou a compensação, e o destino de cada segredo | `EV-E00-L8-01` a `-04` |
| 9 | Matriz do §6 | Conclusão fundamentada e assinada | `EV-E00-L9-01` |

## 5. Lista de conferência dos consoles

Marque cada item ao concluir, com o identificador da evidência.

**Google AI Studio** (<https://aistudio.google.com>):
- [ ] Chaves e projeto de cada uma (passo 1).
- [ ] Registro de solicitações (logs) ativo ou não, e se há registros (passo 2).
- [ ] Chaves G e V excluídas (passo 3).

**Google Cloud Console, em cada projeto do passo 0:**
- [ ] IAM: o seu papel; quem tem `apikeys.keys.undelete` (Owner, Editor, administrador de chaves de API); papéis
  desnecessários retirados (passo 0).
- [ ] APIs e serviços → APIs e serviços ativados: quais APIs de IA estão habilitadas (passo 1).
- [ ] Credenciais → Chaves de API: nome, uid, criação, restrições, final e classe de cada chave (passo 1).
- [ ] Secret Manager: nomes dos segredos (passo 1) e teste de cada versão que guarda chave do Google (passo 4, item 5).
- [ ] Generative Language API → Métricas, por credencial, com o período coberto (passo 2).
- [ ] Credenciais: exclusão das chaves G e V (passo 3).
- [ ] Projeto do Firebase: APIs de IA desativadas, ou justificadas (passo 3).
- [ ] Logging → Logs Explorer: `CreateKey`, os `UpdateKey` da chave W, `DeleteKey` e nenhum `UndeleteKey` nem
  `UpdateKey` posterior, pelo menos 24 horas depois da exclusão (passos 1 e 4). Repetir na reemissão das revisões e
  antes de qualquer publicação.
- [ ] Faturamento → Relatórios desde 2026-01-22: SKUs do Gemini por projeto; para o projeto do Firebase, todos os
  serviços (passo 4.1).
- [ ] Chave web sem nenhuma API de IA ou de ML na lista; outras chaves restritas ou excluídas (passo 5). O
  referenciador é da P6 (D-ORD-07).

**Firebase Console** (projeto do app):
- [ ] Configurações do projeto → apps da Web: qual chave é a do app (passos 1 e 5).
- [ ] AI Logic: serviço não configurado (passo 5).
- [ ] Authentication: só a contagem de contas, todas da equipe (§6, R7), na assinatura do §6 e em cada reemissão até a
  P6.
- [ ] Hosting, em cada site: histórico de versões, versão ativa, quem publicou e canais de visualização; canais sem uso
  excluídos (passo 6).

**Terminal do proprietário:**
- [ ] Contagem de recursos guardados com cada chave G, V e, se couber, W, antes da exclusão (passo 2).
- [ ] Teste `API_KEY_INVALID`, pelo menos 30 minutos depois da exclusão, em cada valor achado: Secret Manager,
  estações e Codespaces, builds e bundle (passo 4).
- [ ] Teste da chave W contra o Gemini: `http=403` (passo 5).
- [ ] Varredura do JavaScript de cada site e canal publicado (passo 6).

**Navegador, no site publicado:**
- [ ] Login com e-mail e senha, login com Google, painel e uma callable, no Codespaces e nos dois domínios, depois da
  mudança da lista, e a recarga depois de cerca de uma hora (passo 5).

**Estações:**
- [ ] Chaves `AIza` em `VITE_*`, só pelo final (passo 1).
- [ ] Nomes das `VITE_*` na estação que publicou (passo 6).
- [ ] Limpeza, inclusive dos históricos de chat e de assistentes de IA, reconferência só de nomes e declaração de cada
  estação (passo 7).

**Provedores de cada segredo achado no passo 6** (por exemplo, o Stripe):
- [ ] Revogação ou rotação com invalidação imediata, com data (passo 6).

## 6. Matriz de risco e de impacto aos titulares (linha 9)

Esta matriz subsidia a decisão jurídica (§7) e não a substitui. A exposição de uma chave não significa, por si só,
vazamento de dados pessoais. O risco também não pode ser descartado sem análise. Nenhum dado pessoal entra nesta tabela,
só categorias, contagens e conclusões. O detalhe fica no documento privado do passo 8.

| # | Dimensão | Pergunta | Fonte | Se a resposta for "sim" ou "não se sabe" | Resultado | Estado |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | Uso por terceiros | A chave foi usada por quem não é o app? | Linha 6 (passos 2 e 4.1) | O custo e a quota são dano ao controlador. Para os titulares, o efeito depende de R2: o uso de terceiros com os dados deles não expõe dados do app | Entrada (E06, informado pelo proprietário ao ChatGPT em 2026-11-16 (transcrição sanitizada; originais na pasta privada do proprietário, não inspecionados pelo Claude)): R$ 0,03 de Gemini API de 2026-01-01 a 2026-11-16, reconhecido pelo proprietário como uso de teste. Não exclui uso gratuito nem uso de terceiros sem cobrança, e não informa os projetos, as contas de faturamento nem os meses das cobranças | NÃO VERIFICADO |
| R2 | Conteúdo guardado no provedor | Havia arquivos, caches, lotes, repositórios de busca, modelos ajustados ou registros de solicitações acessíveis com a chave? | Linha 6 (contagens do passo 2; logs no AI Studio) | O conteúdo pode ter sido lido por terceiros. Os envios do app (R3) podem conter dado pessoal, e isso **eleva o risco**. Um recurso "não conferível" conta como "não se sabe". Uma contagem zero e a falta de registros hoje valem só para hoje: "não" para o período da exposição exige evidência que cubra o período, por exemplo o registro de solicitações comprovadamente desativado durante todo ele | — | NÃO VERIFICADO |
| R3 | Envio do app ao provedor | O que o app enviava, e por onde? | Código | O tratamento legítimo pelo provedor é outro risco (PR-AI-01, E-10). Ele só se soma a este incidente se houver R2 | Evidência do código, levantada por agente e a validar pelo responsável. De `d6a9047` a `360aeaf` (2026-08-24), **o navegador** chamava o Gemini com a chave exposta e enviava comprovantes inline, transcrições de voz, o retrato financeiro e a pergunta livre (`d6a9047:src/components/TransactionModal.tsx:622-628,697-700`; `d6a9047:src/modules/reports/api.ts:96,112-153`). Depois disso, só o backend, com `generateContent`, sem Files API nem cache (`functions/src/ai/callables.ts:291-298`). Antes de `d6a9047`, não verificável. Entrada (E05, informado pelo proprietário ao ChatGPT em 2026-11-16 (transcrição sanitizada; originais na pasta privada do proprietário, não inspecionados pelo Claude)): o proprietário declara que todos os dados usados nos testes eram fictícios, e que nenhum dado pessoal ou financeiro real, comprovante, extrato ou áudio real foi enviado ao Gemini pelo app. É declaração: não prova o próprio conteúdo até a evidência do R7, nem que terceiros não acessaram nada | NÃO VERIFICADO |
| R4 | Outros segredos publicados | Alguma `VITE_*` publicada dava acesso a dado pessoal? | Linha 8 | Por tipo: uma chave secreta de pagamento expõe dados de clientes e de pagamentos. Uma conta de serviço do Google dá acesso ao Firestore inteiro (dados pessoais de todos os workspaces), ao Authentication (e-mails, dados de login) e ao Storage. O risco é **alto** até a revogação | — | NÃO VERIFICADO |
| R5 | Chave web do Firebase | O abuso da chave web expôs dados? | Linhas 6 e 7; Rules publicadas | Sozinha, ela não dá acesso a dados: eles dependem do Auth e das Rules **publicadas**, que são anteriores à P1 e não são as testadas (D-ORD-04). As mais antigas disponíveis no repositório permitiam a qualquer usuário autenticado ler e escrever `recurring_expenses` e `recurring_occurrences` de qualquer workspace (`d6a9047:firestore.rules:280-286`), e a chave pública permite criar conta e autenticar. Sem dado real em produção, o impacto aos titulares é nulo. Se houve dado real no período, as Rules publicadas e os acessos entram na avaliação, com conferência só de leitura pelo proprietário. As Rules testadas são publicadas na P6 (PR-PLAT-01), antes de usuários reais. O efeito esperado é custo e abuso de quota. Se uma API de IA estava habilitada e a chave a permitia, valem R1 e R2 | Entrada (E03, informado): a chave web tem restrição de API sem a Generative Language API, mas permite a Firebase AI Logic API, que serve o Gemini pelo proxy se a AI Logic estiver configurada e o App Check não estiver aplicado. Falta saber se ela está configurada (linha 7). O E03 mostra só o estado atual: o estado das restrições no período, desde 2025-09-09, vem dos `CreateKey` e `UpdateKey` dessa chave no registro de atividade do administrador (passo 1, item 6; retenção a confirmar); sem eles, "não se sabe" em R8 | NÃO VERIFICADO |
| R6 | Período e extensão | Por quanto tempo e com que volume? | Linhas 6 e 8; Hosting | De 2026-01-22 até a revogação, ou até a data mais antiga provada. O período não coberto pelo histórico é risco não excluído | — | NÃO VERIFICADO |
| R7 | Titulares e categorias | Quem pode ter sido afetado, quantos, e em quais workspaces? | Inventário de dados (`PRIVACY_LGPD.md`); `INCIDENT_RESPONSE.md` §6.6, passo 2 | Categorias possíveis: usuários e membros; clientes e devedores; terceiros citados em comprovantes (inclusive dados de terceiros de workspaces PJ); dados financeiros; nos comprovantes, possivelmente CPF ou CNPJ. Registre a estimativa de titulares e de workspaces e quais dados reais existiam no período, com evidência. Não presuma a premissa "sem dados reais" do plano §1 para o período da exposição: confira | Entrada (E04 e E05): o proprietário declara que o app não tem usuários reais (E04) e que os dados dos testes eram fictícios (E05). Para valer como evidência, ele confirma ao assinar e sustenta a declaração com a contagem das contas do Authentication de produção e dos workspaces, todas da equipe (só a contagem), registrada na assinatura e em cada reemissão até a P6. Uma conta de fora da equipe reabre o D-ORD-07 e esta linha e antecipa o item 1.13.1 do `LAUNCH_CHECKLIST.md` | NÃO VERIFICADO |
| R8 | Limitações | O que não dá para provar? | Todas | Ver a lista abaixo | — | NÃO VERIFICADO |

**Limitações a registrar em R8:**
- o clone raso, desde 2026-05-24;
- o histórico de métricas limitado;
- arquivos que expiram;
- recursos não conferíveis;
- bundles de versões antigas indisponíveis;
- a profundidade do histórico do Hosting e do registro de solicitações do AI Studio;
- o estado passado das restrições da chave web, se os `UpdateKey` não cobrirem o período;
- as informações do §8, que são transcrições sem o original conferido;
- declarações das estações, que são autodeclarações.

**Regra de conclusão** (preenchida pelo proprietário e pelo encarregado, ou só pelo proprietário enquanto o D-21 estiver
aberto, com data e assinatura):
- **"Sem indício de dado pessoal afetado"** só vale com R2 e R4 respondidos "não", com evidência que cubra o período da exposição. Se algum dos dois for
  "não se sabe", a conclusão é **"possível"**, com a lista do que não se sabe. **"Confirmado"** vale quando há evidência
  de acesso.
- A conclusão diz se há risco ou dano relevante aos titulares, e por quê, e leva as limitações de R8.
- Ela é entregue ao jurídico (§7).

**Proposta de conclusão** (P5-E00-A-02, para a avaliação e a assinatura do controlador e do encarregado e para o
jurídico; não é a conclusão registrada):
- **Conclusão: "possível".** Pela regra acima, R2 e R4 ainda não têm resposta comprovada. R2 não é conferível com a
  chave `FênixGran`, excluída antes da contagem; os registros do AI Studio (passo 2) não dependem da chave e seguem
  pendentes; outra credencial do mesmo projeto poderia fazer a contagem (a confirmar, E-10; decisão de plataforma),
  senão fica "não conferível" em R8. R4 depende da linha 8.
- **Custo indevido no Google Cloud (dano ao controlador):** baixo pelo que se sabe (R$ 0,03, reconhecido como uso de
  teste). É inconclusivo para uso gratuito e para uso de terceiros sem cobrança.
- **Risco aos titulares:** baixo, **se** as declarações E04 e E05 forem confirmadas, assinadas e sustentadas pela
  contagem do R7, e a linha 8 não achar outro segredo publicado. Nesse caso, um conteúdo guardado no provedor não teria
  dado pessoal real, e restaria só o custo. Sem a contagem do R7, o risco aos titulares fica indeterminado. Se a linha
  8 achar um segredo com acesso a dados (R4), a avaliação é refeita.
- **Limitações (R8):**
  - a contagem de recursos não é conferível com a chave excluída;
  - as métricas por credencial ainda não foram consultadas;
  - o faturamento é agregado;
  - as informações do §8 são transcrições sem o original conferido;
  - o clone é raso;
  - as declarações são autodeclarações.

## 7. Parte C — resumo para a decisão jurídica (linha 10)

**Fatos:**
- Uma chave da Gemini API foi publicada no JavaScript público do app de 2026-01-22 (`39806fb`, pelo registro da
  auditoria da P0) até, no mínimo, 2026-08-24. Pode
  ainda estar sendo servida, e continua válida até a revogação.
- De pelo menos 2026-05-24 até 2026-08-24, o próprio navegador usava a chave do bundle (a do `define`, ou a de
  `VITE_GOOGLE_AI_KEY`, se houvesse) para enviar ao Gemini comprovantes, transcrições de voz, o retrato financeiro e a
  pergunta do usuário (§6, R3).
- Desde pelo menos 2026-05-24, todo `VITE_*` do ambiente de quem publicou também ia para o bundle. A correção nunca foi
  publicada, então o bundle servido hoje pode ainda conter essas variáveis (§2).
- Segundo o proprietário (§8; transcrição, originais não inspecionados), em 2026-11-16 ele excluiu a chave Gemini que
  conhecia (E01), e o Cloud Audit Logs registra um `DeleteKey` às 14:50:46 UTC (E02; o uid ainda não foi conferido).
  O teste de invalidação e a busca de restauração ainda faltam.
- O proprietário declara que o app não tem usuários reais (E04) e que só dados fictícios foram usados e enviados ao
  Gemini (E05). Segundo ele, o faturamento de 2026 mostra R$ 0,03 de Gemini API, reconhecido como uso de teste (E06).
- Não há evidência de acesso a dados pessoais. Também não há prova de que ele não ocorreu: a matriz do §6 está em
  aberto, com a proposta de conclusão "possível".

**Marcos documentados.** Não são, automaticamente, a data jurídica de ciência:

| Data | Marco |
| --- | --- |
| 2026-08-24 | A remoção da chave do bundle (`92473c8`), cujo comentário reconhece a exposição |
| 2026-09-27 | O registro na auditoria da P0 (PR-AI-02) |

**Prazo.** A LGPD (art. 48) e a Resolução CD/ANPD nº 15/2024 tratam do assunto. Pela leitura do texto, a comunicação à
ANPD e aos titulares cabe quando o incidente pode acarretar risco ou dano relevante aos titulares, no prazo de 3 dias
úteis contado do conhecimento de que o incidente afetou dados pessoais. Isso deve ser confirmado pelo jurídico, assim
como o marco.

Como referência nominal, sem feriados e sem prejulgar o marco:
- a partir de 2026-08-24, o 3º dia útil foi 2026-08-27;
- a partir de 2026-09-27, foi 2026-09-30.

**Se o jurídico adotar um desses marcos e houver obrigação, ela já está vencida.** Nesse caso, a deliberação é imediata,
e a comunicação, se cabível, informa os motivos da demora (LGPD art. 48 §1º, inciso V, a confirmar).

**Perguntas para o jurídico.** A pergunta 3 não depende da avaliação do §6 e pode ser respondida já.
1. O incidente afetou dados pessoais? A resposta vem da conclusão do §6.
2. Há risco ou dano relevante aos titulares?
3. Qual é a data de ciência aplicável?
4. É preciso comunicar a ANPD? E os titulares? Com que conteúdo (art. 48 §1º; `INCIDENT_RESPONSE.md` §6.6, passos 4 e
   5)? E com que prazo para complementar a comunicação?
5. O controlador se enquadra como agente de tratamento de pequeno porte? Isso altera algum prazo?
6. É preciso avisar clientes controladores ou subprocessadores (`INCIDENT_RESPONSE.md` §6.6, passo 6)?
7. Como fica o registro do incidente, que é exigido mesmo sem comunicação (`INCIDENT_RESPONSE.md` §6.6, passo 7)?

**Quem decide:** o controlador, com o encarregado e o jurídico. Há uma ressalva: o papel de controlador e o encarregado
ainda estão em aberto (D-21, PRIV-07, E-09). Nenhum agente decide pela comunicação nem pela dispensa.

**Registro:** a decisão, a fundamentação, a data e o responsável vão para a linha 10 da §9.4 e para o `PRIVACY_LGPD.md`
§12 ("Caso conhecido").

**Prazo interno:** sem obrigação de comunicar, a decisão registrada é exigida antes da produção. Com obrigação, vale o
prazo regulamentar, sem esperar a P5 nem a produção.

## 8. Informações do proprietário (P5-E00-A-02) e o que cada uma prova

Fonte comum: o proprietário, em 2026-11-16, ao ChatGPT. Esta tabela é a transcrição sanitizada. As capturas e o CSV
originais ficam na pasta privada do proprietário e **não foram inspecionados pelo Claude**. A declaração do proprietário
não equivale a telemetria auditada. Nenhum e-mail, IP, valor de chave ou identificador pessoal foi transcrito. Os
próximos passos lidam com segredos e dados pessoais: a um assistente de IA externo, como o ChatGPT, vão só contagens e
categorias (regras do §2).

| ID | Informação | Força probatória | Serve para | Não prova |
| --- | --- | --- | --- | --- |
| E01 | A chave `FênixGran`, a única chave Gemini que o proprietário conhecia, foi excluída no AI Studio. Na página de credenciais excluídas do projeto do app, ela aparece excluída em 2026-11-16 e antes restrita à Gemini API | Captura do console (original privado), transcrita | Linha 1 (uma chave G identificada); linha 2 (exclusão administrativa) | Que não haja outras chaves; que o valor exposto seja o dessa chave; que ela não autentique mais; o final, o uid e a data de criação (a classe G é por dúvida) |
| E02 | Cloud Audit Logs: `apikeys.googleapis.com`, `google.api.apikeys.v2.ApiKeys.DeleteKey`, 2026-11-16T14:50:46Z, `authorizationInfo.granted=true`, `status` vazio, `operation.last=true`, no projeto do app | Registro do provedor (original privado), transcrito | Linha 2: a operação de exclusão foi concluída | O teste `API_KEY_INVALID`; a ausência de `UndeleteKey` e `UpdateKey` depois; que o uid seja o da `FênixGran` (o uid não foi transcrito) |
| E03 | No projeto do app resta uma chave, a "Browser key (auto created by Firebase)", criada em 2025-09-09. Ela é restrita a 24 APIs, sem a Generative Language API, mas com a Firebase AI Logic API e a ML Kit API, e não tem restrição de aplicativo | Captura do console (original privado), transcrita | Linha 1 (chave W); linha 7 (estado de partida) | Que a AI Logic esteja desconfigurada ou as APIs de IA desativadas; que outros projetos não tenham chaves; o estado das restrições no período, desde 2025-09-09 |
| E04 | O Hosting tem os domínios `<projeto>.web.app` e `<projeto>.firebaseapp.com`. O proprietário não tem usuários reais e desenvolve no GitHub Codespaces com `npm run dev`, em URL dinâmica. Ele pede para adiar a restrição por referenciador para a homologação | Declaração e captura (original privado) | Linha 8 (os domínios a varrer); linha 5 (o Codespaces é estação); linha 9 (R7: sem usuários reais, declarado); D-ORD-07 (o pedido) | O que os domínios servem hoje; os canais de visualização; os nomes de `VITE_*` publicados |
| E05 | Todos os dados dos testes eram fictícios. Nenhum dado pessoal ou financeiro real, comprovante, extrato ou áudio real foi enviado ao Gemini pelo app | Declaração do proprietário | Linha 9 (R3 e R7 do §6) | O próprio conteúdo, até a evidência do R7 (só a contagem das contas do Authentication e dos workspaces de produção, todas de teste); que terceiros não tenham usado a chave; que não houvesse segredo acessível (R2, R4) |
| E06 | O CSV do faturamento de 2026-01-01 a 2026-11-16 mostra Gemini API R$ 0,03 (subtotal R$ 0,030469), Secret Manager R$ 1,42, Cloud Storage R$ 0,04, total R$ 1,49. O proprietário reconhece o uso da Gemini API em testes do app | Exportação do faturamento (original privado), transcrita; o reconhecimento é declaração | Linha 6 (faturamento); R1 do §6 | Uso gratuito; uso por credencial; ausência de uso de terceiros sem cobrança; outros projetos e outras contas de faturamento; o mês das cobranças do Gemini |
| E07 | Ainda não apresentados: o teste `API_KEY_INVALID` (a começar pelo Secret Manager), a busca de `UndeleteKey` e `UpdateKey`, o inventário de outros projetos e chaves, a varredura dos bundles e das `VITE_*`, as declarações das estações, a classificação dos recursos guardados e as decisões de privacidade e jurídica | — | Mostra o que falta | — |
