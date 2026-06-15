# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: credit-card-flow.spec.ts >> Fluxos E2E do domínio de cartão >> owner executa compra, pagamento, estorno, cancelamento e valida relatórios sem saída imediata
- Location: e2e/credit-card-flow.spec.ts:363:3

# Error details

```
Error: Compra Compra cancelável E2E não foi persistida no domínio de cartão.
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - complementary [ref=e4]:
    - generic [ref=e5]:
      - generic [ref=e6]: F
      - generic [ref=e7]: Finanças
    - navigation [ref=e8]:
      - list [ref=e9]:
        - listitem [ref=e10]:
          - link "Dashboard" [ref=e11] [cursor=pointer]:
            - /url: "#"
            - img [ref=e13]
            - generic [ref=e18]: Dashboard
        - listitem [ref=e19]:
          - link "Empréstimos" [ref=e20] [cursor=pointer]:
            - /url: "#"
            - img [ref=e22]
            - generic [ref=e25]: Empréstimos
        - listitem [ref=e26]:
          - link "Cartões de Crédito" [ref=e27] [cursor=pointer]:
            - /url: "#"
            - img [ref=e29]
            - generic [ref=e31]: Cartões de Crédito
        - listitem [ref=e32]:
          - link "Metas" [ref=e33] [cursor=pointer]:
            - /url: "#"
            - img [ref=e35]
            - generic [ref=e39]: Metas
        - listitem [ref=e40]:
          - link "Dividir Gastos" [ref=e41] [cursor=pointer]:
            - /url: "#"
            - img [ref=e43]
            - generic [ref=e48]: Dividir Gastos
        - listitem [ref=e49]:
          - link "Assinaturas" [ref=e50] [cursor=pointer]:
            - /url: "#"
            - img [ref=e52]
            - generic [ref=e57]: Assinaturas
        - listitem [ref=e58]:
          - link "Relatórios" [ref=e59] [cursor=pointer]:
            - /url: "#"
            - img [ref=e61]
            - generic [ref=e64]: Relatórios
        - listitem [ref=e65]:
          - link "Meu Plano" [ref=e66] [cursor=pointer]:
            - /url: "#"
            - img [ref=e68]
            - generic [ref=e71]: Meu Plano
        - listitem [ref=e72]:
          - link "Configurações" [ref=e73] [cursor=pointer]:
            - /url: "#"
            - img [ref=e75]
            - generic [ref=e78]: Configurações
    - button "Sair" [ref=e80] [cursor=pointer]:
      - img
      - generic [ref=e83]: Sair
  - main [ref=e84]:
    - generic [ref=e86]:
      - heading "Minhas Finanças" [level=1] [ref=e89]
      - generic [ref=e90]:
        - button "Mês anterior" [ref=e91] [cursor=pointer]:
          - img [ref=e92]
        - generic [ref=e95]:
          - button "Selecionar Mês e Ano" [ref=e96] [cursor=pointer]:
            - generic [ref=e97]: Junho de 2026
            - img [ref=e98]
          - button "Hoje" [ref=e101] [cursor=pointer]
        - button "Próximo mês" [ref=e102] [cursor=pointer]:
          - img [ref=e103]
      - generic [ref=e105]:
        - button [ref=e107] [cursor=pointer]:
          - img [ref=e108]
        - button [ref=e112] [cursor=pointer]:
          - img [ref=e113]
        - button [ref=e117] [cursor=pointer]:
          - img [ref=e118]
        - generic [ref=e120]:
          - generic [ref=e121] [cursor=pointer]:
            - generic [ref=e122]: Olá, Usuário
            - generic [ref=e123]: PESSOAL
          - generic [ref=e124] [cursor=pointer]: U
    - generic [ref=e125]:
      - generic [ref=e126]:
        - figure [ref=e127]:
          - generic [ref=e128]:
            - heading "Saldo Atual" [level=2] [ref=e129]
            - img [ref=e131]
          - paragraph [ref=e135]: R$ 0,00
          - generic [ref=e136]: Mensal
        - button "Receitas R$ 0,00 Mensal" [ref=e137] [cursor=pointer]:
          - generic [ref=e138]:
            - heading "Receitas" [level=2] [ref=e139]
            - img [ref=e141]
          - paragraph [ref=e143]: R$ 0,00
          - generic [ref=e144]: Mensal
        - button "Despesas R$ 0,00 Mensal" [ref=e145] [cursor=pointer]:
          - generic [ref=e146]:
            - heading "Despesas" [level=2] [ref=e147]
            - img [ref=e149]
          - paragraph [ref=e151]: R$ 0,00
          - generic [ref=e152]: Mensal
        - button "Investimentos R$ 0,00 Mensal" [ref=e153] [cursor=pointer]:
          - generic [ref=e154]:
            - heading "Investimentos" [level=2] [ref=e155]
            - img [ref=e157]
          - paragraph [ref=e159]: R$ 0,00
          - generic [ref=e160]: Mensal
      - generic [ref=e161]:
        - generic [ref=e162]:
          - generic [ref=e163]:
            - generic [ref=e164]:
              - heading "Distribuição de Despesas" [level=2] [ref=e165]
              - generic [ref=e166]:
                - button "Gráfico de Pizza" [ref=e167] [cursor=pointer]:
                  - img [ref=e168]
                - button "Gráfico de Barras" [ref=e171] [cursor=pointer]:
                  - img [ref=e172]
                - button "Gráfico de Linha" [ref=e174] [cursor=pointer]:
                  - img [ref=e175]
                - button "Gráfico de Rosca" [ref=e178] [cursor=pointer]:
                  - img [ref=e179]
            - img [ref=e185]
            - generic [ref=e186]:
              - generic [ref=e189]: Receitas
              - generic [ref=e192]: Despesas
              - generic [ref=e195]: Investimentos
              - generic [ref=e198]: Parceladas
          - generic [ref=e200] [cursor=pointer]:
            - generic [ref=e201]:
              - generic [ref=e202]:
                - img [ref=e204]
                - generic [ref=e207]:
                  - heading "Diagnóstico" [level=3] [ref=e208]
                  - paragraph [ref=e209]: Últimos 30 dias
              - img [ref=e211]
            - generic [ref=e213]:
              - generic [ref=e214]:
                - generic [ref=e215]: Saldo
                - generic [ref=e216]: R$ 0,00
              - generic [ref=e217]:
                - generic [ref=e218]: Poupança
                - generic [ref=e219]: 0.0%
            - generic [ref=e220]:
              - img [ref=e221]
              - generic [ref=e223]: Saúde financeira estável.
        - generic [ref=e224]:
          - generic [ref=e225]:
            - heading "Transações Recentes" [level=2] [ref=e226]
            - generic [ref=e227]:
              - button "Nova Transação" [ref=e229] [cursor=pointer]:
                - img [ref=e230]
                - text: Nova Transação
              - combobox [ref=e231]:
                - option "Todas" [selected]
                - option "Receitas"
                - option "Despesas"
                - option "Investimentos"
                - option "Parceladas"
          - table [ref=e233]:
            - rowgroup [ref=e234]:
              - row "Descrição Categoria Data Valor" [ref=e235]:
                - columnheader "Descrição" [ref=e236]:
                  - button "Descrição" [ref=e237] [cursor=pointer]
                - columnheader "Categoria" [ref=e238]:
                  - button "Categoria" [ref=e239] [cursor=pointer]
                - columnheader "Data" [ref=e240]:
                  - button "Data" [ref=e241] [cursor=pointer]:
                    - text: Data
                    - img [ref=e242]
                - columnheader "Valor" [ref=e244]:
                  - button "Valor" [ref=e245] [cursor=pointer]
            - rowgroup
  - generic [ref=e247]:
    - generic [ref=e248]:
      - heading "Nova Transação" [level=3] [ref=e249]
      - button [ref=e250] [cursor=pointer]:
        - img [ref=e251]
    - generic [ref=e254]:
      - generic [ref=e256]:
        - img [ref=e257]
        - generic [ref=e259]: Assistente de Preenchimento IA
      - generic [ref=e260]:
        - button "Escanear Comprovante" [ref=e261] [cursor=pointer]:
          - img [ref=e262]
          - text: Escanear Comprovante
        - button "Falar Transação" [ref=e265] [cursor=pointer]:
          - img [ref=e266]
          - text: Falar Transação
    - generic [ref=e270]:
      - button "Receita" [ref=e271] [cursor=pointer]
      - button "Despesa" [ref=e272] [cursor=pointer]
      - button "Investimento" [ref=e273] [cursor=pointer]
      - button "Cartão" [ref=e274] [cursor=pointer]
    - generic [ref=e276]:
      - generic [ref=e277]:
        - generic [ref=e278]:
          - generic [ref=e279]: Cartão de Crédito *
          - combobox [ref=e280]:
            - option "Selecione o cartão..."
            - option "Cartão Fluxo E2E (Fecha dia 1)" [selected]
        - generic [ref=e281]:
          - generic [ref=e282]: Produto / Serviço *
          - generic [ref=e283]:
            - generic:
              - img
            - combobox "Busque, selecione ou digite um novo item..." [ref=e284]
            - button "▼" [ref=e285] [cursor=pointer]
          - paragraph [ref=e286]: Use o mesmo campo para buscar, selecionar ou criar.
        - generic [ref=e287]:
          - generic [ref=e288]: Categoria *
          - combobox [active] [ref=e289]:
            - option "Selecione..." [selected]
        - generic [ref=e290]:
          - generic [ref=e291]: Data da Compra *
          - textbox [ref=e292]
        - generic [ref=e293]:
          - generic [ref=e294]: Tipo de Valor *
          - generic [ref=e295]:
            - generic [ref=e296] [cursor=pointer]:
              - radio "Valor Total da Compra" [checked] [ref=e297]
              - generic [ref=e298]: Valor Total da Compra
            - generic [ref=e299] [cursor=pointer]:
              - radio "Valor da Parcela" [ref=e300]
              - generic [ref=e301]: Valor da Parcela
          - generic [ref=e302]:
            - generic [ref=e303]: Valor Total (R$)
            - spinbutton [ref=e304]: "50"
          - generic [ref=e305]:
            - generic [ref=e306]: Quantidade de Parcelas
            - paragraph [ref=e307]: Use 1 para compra à vista no cartão.
            - spinbutton [ref=e308]: "1"
      - button "Revisar e Adicionar Parcelado" [ref=e310] [cursor=pointer]
```

# Test source

```ts
  85  |     password: E2E_PASSWORD,
  86  |     emailVerified: true,
  87  |   });
  88  | };
  89  | 
  90  | const seedWorkspaceMembership = async ({ uid, email, role }: SeedUserInput): Promise<void> => {
  91  |   const db = getDb();
  92  |   const now = admin.firestore.FieldValue.serverTimestamp();
  93  | 
  94  |   await Promise.all([
  95  |     db.doc(`workspaces/${WORKSPACE_ID}/members/${uid}`).set({
  96  |       uid,
  97  |       email,
  98  |       displayName: email,
  99  |       role,
  100 |       status: 'active',
  101 |       joinedAt: now,
  102 |     }),
  103 |     db.doc(`users/${uid}/workspaces/${WORKSPACE_ID}`).set({
  104 |       workspaceId: WORKSPACE_ID,
  105 |       role,
  106 |       createdAt: now,
  107 |       updatedAt: now,
  108 |     }),
  109 |   ]);
  110 | };
  111 | 
  112 | const seedWorkspace = async (): Promise<void> => {
  113 |   const db = getDb();
  114 |   const now = admin.firestore.FieldValue.serverTimestamp();
  115 | 
  116 |   await db.doc(`workspaces/${WORKSPACE_ID}`).set({
  117 |     name: 'Workspace E2E Cartão',
  118 |     type: 'PF',
  119 |     userId: OWNER_UID,
  120 |     ownerId: OWNER_UID,
  121 |     themeColor: '#4f46e5',
  122 |     currency: 'BRL',
  123 |     createdAt: now,
  124 |     updatedAt: now,
  125 |   });
  126 | 
  127 |   await Promise.all([
  128 |     createAuthUser({ uid: OWNER_UID, email: OWNER_EMAIL }),
  129 |     createAuthUser({ uid: ADMIN_UID, email: ADMIN_EMAIL }),
  130 |     createAuthUser({ uid: MEMBER_UID, email: MEMBER_EMAIL }),
  131 |   ]);
  132 | 
  133 |   await Promise.all([
  134 |     seedWorkspaceMembership({ uid: OWNER_UID, email: OWNER_EMAIL, role: 'owner' }),
  135 |     seedWorkspaceMembership({ uid: ADMIN_UID, email: ADMIN_EMAIL, role: 'admin' }),
  136 |     seedWorkspaceMembership({ uid: MEMBER_UID, email: MEMBER_EMAIL, role: 'member' }),
  137 |   ]);
  138 | };
  139 | 
  140 | const seedPermissionCard = async (): Promise<void> => {
  141 |   const db = getDb();
  142 |   const now = admin.firestore.FieldValue.serverTimestamp();
  143 | 
  144 |   await db.doc(`workspaces/${WORKSPACE_ID}/credit_cards/${CARD_PERMISSION_ID}`).set({
  145 |     workspaceId: WORKSPACE_ID,
  146 |     name: CARD_PERMISSION_NAME,
  147 |     brand: 'Visa',
  148 |     status: 'active',
  149 |     limitTotal: 5000,
  150 |     closingDay: 1,
  151 |     dueDay: 10,
  152 |     visual: {
  153 |       bgType: 'color',
  154 |       bgColor: '#1e293b',
  155 |       bgGradientColor: '#3b82f6',
  156 |       bgImage: '',
  157 |       textColor: 'white',
  158 |       showName: true,
  159 |       showBrand: true,
  160 |       showLogo: true,
  161 |     },
  162 |     createdAt: now,
  163 |     updatedAt: now,
  164 |   });
  165 | };
  166 | 
  167 | const waitUntil = async <T>(
  168 |   callback: () => Promise<T | undefined>,
  169 |   message: string,
  170 |   timeoutMs = 30_000
  171 | ): Promise<T> => {
  172 |   const startedAt = Date.now();
  173 |   let lastResult: T | undefined;
  174 | 
  175 |   while (Date.now() - startedAt < timeoutMs) {
  176 |     lastResult = await callback();
  177 | 
  178 |     if (lastResult) {
  179 |       return lastResult;
  180 |     }
  181 | 
  182 |     await new Promise((resolve) => setTimeout(resolve, 350));
  183 |   }
  184 | 
> 185 |   throw new Error(message);
      |         ^ Error: Compra Compra cancelável E2E não foi persistida no domínio de cartão.
  186 | };
  187 | 
  188 | const findWorkspaceCollectionDoc = async <T extends FirebaseFirestore.DocumentData>(
  189 |   collectionName: string,
  190 |   predicate: (data: T, id: string) => boolean
  191 | ): Promise<{ id: string; data: T } | undefined> => {
  192 |   const snapshot = await getDb()
  193 |     .collection(`workspaces/${WORKSPACE_ID}/${collectionName}`)
  194 |     .get();
  195 | 
  196 |   const found = snapshot.docs.find((documentSnapshot) =>
  197 |     predicate(documentSnapshot.data() as T, documentSnapshot.id)
  198 |   );
  199 | 
  200 |   if (!found) {
  201 |     return undefined;
  202 |   }
  203 | 
  204 |   return {
  205 |     id: found.id,
  206 |     data: found.data() as T,
  207 |   };
  208 | };
  209 | 
  210 | const loginAs = async (page: Page, email: string): Promise<void> => {
  211 |   await page.goto(`/?e2eEmail=${encodeURIComponent(email)}&e2ePassword=${encodeURIComponent(E2E_PASSWORD)}`);
  212 | 
  213 |   await page.getByTestId('e2e-login-button').click();
  214 | 
  215 |   await expect(page.getByText(/Transações Recentes|Saldo Atual|Dashboard/i).first()).toBeVisible({
  216 |     timeout: 30_000,
  217 |   });
  218 | };
  219 | 
  220 | const navigateBySidebar = async (page: Page, name: RegExp): Promise<void> => {
  221 |   await page.getByRole('link', { name }).click();
  222 | };
  223 | 
  224 | const createCardThroughUi = async (page: Page, cardName: string): Promise<CreatedCardReference> => {
  225 |   await navigateBySidebar(page, /Cartões de Crédito|Cartões Corporativos/i);
  226 | 
  227 |   await page.getByRole('button', { name: /Novo Cartão/i }).click();
  228 | 
  229 |   const cardForm = page.locator('form#cardForm');
  230 | 
  231 |   await cardForm.getByPlaceholder('Ex: Nubank Empresarial').fill(cardName);
  232 |   await cardForm.locator('input[type="number"]').nth(0).fill('5000');
  233 |   await cardForm.locator('input[type="number"]').nth(1).fill('1');
  234 |   await cardForm.locator('input[type="number"]').nth(2).fill('10');
  235 | 
  236 |   await page.getByRole('button', { name: 'Salvar Cartão' }).click();
  237 | 
  238 |   await expect(page.getByText(cardName).first()).toBeVisible({
  239 |     timeout: 20_000,
  240 |   });
  241 | 
  242 |   const cardDoc = await waitUntil(
  243 |     () =>
  244 |       findWorkspaceCollectionDoc<{ name?: string }>(
  245 |         'credit_cards',
  246 |         (data) => data.name === cardName
  247 |       ),
  248 |     `Cartão ${cardName} não foi persistido no Firestore Emulator.`
  249 |   );
  250 | 
  251 |   return {
  252 |     id: cardDoc.id,
  253 |     name: cardName,
  254 |   };
  255 | };
  256 | 
  257 | const createCreditCardPurchaseThroughUi = async (
  258 |   page: Page,
  259 |   input: PurchaseInput
  260 | ): Promise<void> => {
  261 |   await navigateBySidebar(page, /Dashboard/i);
  262 | 
  263 |   await page.getByRole('button', { name: /Nova Transação/i }).click();
  264 |   await page.getByRole('button', { name: /^Cartão$/i }).click();
  265 | 
  266 |   const transactionForm = page.locator('form').last();
  267 | 
  268 |   await transactionForm.locator('select').nth(0).selectOption(input.cardId);
  269 |   await transactionForm.locator('input[type="number"]').nth(0).fill(input.amount);
  270 |   await transactionForm.locator('input[type="number"]').nth(1).fill(input.installments);
  271 | 
  272 |   await page.getByRole('button', { name: /Revisar e Adicionar Parcelado/i }).click();
  273 | 
  274 |     const purchaseDoc = await waitUntil(
  275 |     async () => {
  276 |       const purchaseErrorVisible = await page
  277 |         .getByText(/Erro ao criar compra no cartão|Limite disponível insuficiente|Informe um valor válido|Informe uma quantidade válida|Selecione um cartão válido/i)
  278 |         .first()
  279 |         .isVisible()
  280 |         .catch(() => false);
  281 | 
  282 |       if (purchaseErrorVisible) {
  283 |         throw new Error(`A UI rejeitou a compra ${input.description} antes da persistência no domínio.`);
  284 |       }
  285 | 
```