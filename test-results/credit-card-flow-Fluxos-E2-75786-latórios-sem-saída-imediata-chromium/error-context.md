# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: credit-card-flow.spec.ts >> Fluxos E2E do domínio de cartão >> owner executa compra, pagamento, estorno, cancelamento e valida relatórios sem saída imediata
- Location: e2e/credit-card-flow.spec.ts:570:3

# Error details

```
Error: Nenhum botão de detalhe de fatura foi renderizado para o cartão.
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
        - button "3" [ref=e107] [cursor=pointer]:
          - img [ref=e108]
          - generic [ref=e111]: "3"
        - button [ref=e113] [cursor=pointer]:
          - img [ref=e114]
        - button [ref=e118] [cursor=pointer]:
          - img [ref=e119]
        - generic [ref=e121]:
          - generic [ref=e122] [cursor=pointer]:
            - generic [ref=e123]: Olá, Usuário
            - generic [ref=e124]: PESSOAL
          - generic [ref=e125] [cursor=pointer]: U
    - generic [ref=e126]:
      - generic [ref=e127]:
        - generic [ref=e128]:
          - heading "Meus Cartões" [level=2] [ref=e129]
          - paragraph [ref=e130]: Gerencie seus limites e faturas
        - generic [ref=e131]:
          - generic [ref=e132]:
            - textbox "Buscar..." [ref=e133]
            - img [ref=e135]
          - generic [ref=e138]:
            - button [ref=e139] [cursor=pointer]:
              - img [ref=e140]
            - button [ref=e145] [cursor=pointer]:
              - img [ref=e146]
          - button "Novo Cartão" [ref=e147] [cursor=pointer]:
            - img [ref=e148]
            - text: Novo Cartão
      - generic [ref=e152] [cursor=pointer]:
        - generic [ref=e153]:
          - generic [ref=e154]:
            - generic [ref=e155]: Cartão Fluxo E2E
            - img [ref=e157]
          - generic [ref=e161]:
            - img [ref=e165]
            - generic [ref=e169]: "**** **** **** 1234"
            - generic [ref=e170]:
              - generic [ref=e171]: Usuario
              - generic [ref=e172]: Visa
        - generic [ref=e175]:
          - generic [ref=e176]:
            - generic [ref=e177]:
              - generic [ref=e178]: Limite Total
              - generic [ref=e179]: R$ 5.000,00
            - generic [ref=e180]:
              - generic [ref=e181]: Utilizado
              - generic [ref=e182]: R$ 400,00
            - generic [ref=e183]:
              - generic [ref=e184]: Disponível
              - generic [ref=e185]: R$ 4.600,00
          - generic [ref=e188]:
            - generic [ref=e189]:
              - generic [ref=e190]: Fechamento
              - generic [ref=e191]: Dia 1
            - generic [ref=e192]:
              - generic [ref=e193]: Melhor Dia
              - generic [ref=e194]: Dia 2
      - generic [ref=e196]:
        - generic [ref=e197]:
          - heading "Detalhes do Cartão" [level=3] [ref=e198]
          - button "Fechar detalhes do cartão" [ref=e199] [cursor=pointer]:
            - img [ref=e200]
        - generic [ref=e205] [cursor=pointer]:
          - generic [ref=e206]:
            - generic [ref=e207]:
              - generic [ref=e208]: Cartão Fluxo E2E
              - img [ref=e210]
            - generic [ref=e214]:
              - img [ref=e218]
              - generic [ref=e222]: "**** **** **** 1234"
              - generic [ref=e223]:
                - generic [ref=e224]: Usuario
                - generic [ref=e225]: Visa
          - generic [ref=e228]:
            - generic [ref=e229]:
              - generic [ref=e230]:
                - generic [ref=e231]: Limite Total
                - generic [ref=e232]: R$ 5.000,00
              - generic [ref=e233]:
                - generic [ref=e234]: Utilizado
                - generic [ref=e235]: R$ 400,00
              - generic [ref=e236]:
                - generic [ref=e237]: Disponível
                - generic [ref=e238]: R$ 4.600,00
            - generic [ref=e241]:
              - generic [ref=e242]:
                - generic [ref=e243]: Fechamento
                - generic [ref=e244]: Dia 1
              - generic [ref=e245]:
                - generic [ref=e246]: Melhor Dia
                - generic [ref=e247]: Dia 2
        - generic [ref=e248]:
          - generic [ref=e249]:
            - generic [ref=e251]: Ativo
            - generic [ref=e252]:
              - paragraph [ref=e253]: Fechamento
              - paragraph [ref=e254]: Dia 1
            - generic [ref=e255]:
              - paragraph [ref=e256]: Vencimento
              - paragraph [ref=e257]: Dia 10
          - generic [ref=e258]:
            - heading "Faturas" [level=4] [ref=e259]:
              - img [ref=e260]
              - text: Faturas
            - generic [ref=e262]: Nenhuma fatura encontrada para este cartão.
          - generic [ref=e263]:
            - heading "Administração" [level=4] [ref=e264]
            - generic [ref=e265]:
              - button "Recalcular limite" [ref=e266] [cursor=pointer]
              - button "Rebuild de faturas" [ref=e267] [cursor=pointer]
            - group [ref=e268]:
              - generic "Audit logs recentes" [ref=e269] [cursor=pointer]
            - group [ref=e270]:
              - generic "Métricas operacionais" [ref=e271] [cursor=pointer]
          - generic [ref=e272]:
            - button "Editar" [ref=e273] [cursor=pointer]:
              - img [ref=e274]
              - text: Editar
            - button "Excluir" [ref=e277] [cursor=pointer]:
              - img [ref=e278]
              - text: Excluir
```

# Test source

```ts
  162 |       transactionSubtype: category.transactionSubtype,
  163 |       icon: category.icon,
  164 |       color: category.color,
  165 |       stroke: category.stroke,
  166 |       sortOrder: category.sortOrder,
  167 |       status: category.status,
  168 |       createdBy: OWNER_UID,
  169 |       updatedBy: OWNER_UID,
  170 |       createdAt: now,
  171 |       updatedAt: now,
  172 |     }),
  173 |     db.doc(`workspaces/${WORKSPACE_ID}/settings_catalog_uniques/${dedupeKey}`).set({
  174 |       dedupeKey,
  175 |       catalogItemId: category.id,
  176 |       workspaceId: WORKSPACE_ID,
  177 |       group: category.group,
  178 |       normalizedName,
  179 |       createdBy: OWNER_UID,
  180 |       updatedBy: OWNER_UID,
  181 |       createdAt: now,
  182 |       updatedAt: now,
  183 |     }),
  184 |   ]);
  185 | };
  186 | 
  187 | const seedWorkspace = async (): Promise<void> => {
  188 |   const db = getDb();
  189 |   const now = admin.firestore.FieldValue.serverTimestamp();
  190 | 
  191 |   await db.doc(`workspaces/${WORKSPACE_ID}`).set({
  192 |     name: 'Workspace E2E Cartão',
  193 |     type: 'PF',
  194 |     userId: OWNER_UID,
  195 |     ownerId: OWNER_UID,
  196 |     themeColor: '#4f46e5',
  197 |     currency: 'BRL',
  198 |     createdAt: now,
  199 |     updatedAt: now,
  200 |   });
  201 | 
  202 |   await Promise.all([
  203 |     createAuthUser({ uid: OWNER_UID, email: OWNER_EMAIL }),
  204 |     createAuthUser({ uid: ADMIN_UID, email: ADMIN_EMAIL }),
  205 |     createAuthUser({ uid: MEMBER_UID, email: MEMBER_EMAIL }),
  206 |   ]);
  207 | 
  208 |   await Promise.all([
  209 |     seedWorkspaceMembership({ uid: OWNER_UID, email: OWNER_EMAIL, role: 'owner' }),
  210 |     seedWorkspaceMembership({ uid: ADMIN_UID, email: ADMIN_EMAIL, role: 'admin' }),
  211 |     seedWorkspaceMembership({ uid: MEMBER_UID, email: MEMBER_EMAIL, role: 'member' }),
  212 |   ]);
  213 | 
  214 |   await seedSettingsCatalog();
  215 | };
  216 | 
  217 | const seedPermissionCard = async (): Promise<void> => {
  218 |   const db = getDb();
  219 |   const now = admin.firestore.FieldValue.serverTimestamp();
  220 | 
  221 |   await db.doc(`workspaces/${WORKSPACE_ID}/credit_cards/${CARD_PERMISSION_ID}`).set({
  222 |     workspaceId: WORKSPACE_ID,
  223 |     name: CARD_PERMISSION_NAME,
  224 |     brand: 'Visa',
  225 |     status: 'active',
  226 |     limitTotal: 5000,
  227 |     closingDay: 1,
  228 |     dueDay: 10,
  229 |     visual: {
  230 |       bgType: 'color',
  231 |       bgColor: '#1e293b',
  232 |       bgGradientColor: '#3b82f6',
  233 |       bgImage: '',
  234 |       textColor: 'white',
  235 |       showName: true,
  236 |       showBrand: true,
  237 |       showLogo: true,
  238 |     },
  239 |     createdAt: now,
  240 |     updatedAt: now,
  241 |   });
  242 | };
  243 | 
  244 | const waitUntil = async <T>(
  245 |   callback: () => Promise<T | undefined>,
  246 |   message: string,
  247 |   timeoutMs = 30_000
  248 | ): Promise<T> => {
  249 |   const startedAt = Date.now();
  250 |   let lastResult: T | undefined;
  251 | 
  252 |   while (Date.now() - startedAt < timeoutMs) {
  253 |     lastResult = await callback();
  254 | 
  255 |     if (lastResult) {
  256 |       return lastResult;
  257 |     }
  258 | 
  259 |     await new Promise((resolve) => setTimeout(resolve, 350));
  260 |   }
  261 | 
> 262 |   throw new Error(message);
      |         ^ Error: Nenhum botão de detalhe de fatura foi renderizado para o cartão.
  263 | };
  264 | 
  265 | const findWorkspaceCollectionDoc = async <T extends FirebaseFirestore.DocumentData>(
  266 |   collectionName: string,
  267 |   predicate: (data: T, id: string) => boolean
  268 | ): Promise<{ id: string; data: T } | undefined> => {
  269 |   const snapshot = await getDb()
  270 |     .collection(`workspaces/${WORKSPACE_ID}/${collectionName}`)
  271 |     .get();
  272 | 
  273 |   const found = snapshot.docs.find((documentSnapshot) =>
  274 |     predicate(documentSnapshot.data() as T, documentSnapshot.id)
  275 |   );
  276 | 
  277 |   if (!found) {
  278 |     return undefined;
  279 |   }
  280 | 
  281 |   return {
  282 |     id: found.id,
  283 |     data: found.data() as T,
  284 |   };
  285 | };
  286 | 
  287 | const loginAs = async (page: Page, email: string): Promise<void> => {
  288 |   await page.goto(`/?e2eEmail=${encodeURIComponent(email)}&e2ePassword=${encodeURIComponent(E2E_PASSWORD)}`);
  289 | 
  290 |   await page.getByTestId('e2e-login-button').click();
  291 | 
  292 |   await expect(page.getByText(/Transações Recentes|Saldo Atual|Dashboard/i).first()).toBeVisible({
  293 |     timeout: 30_000,
  294 |   });
  295 | };
  296 | 
  297 | 
  298 | 
  299 | const navigateBySidebar = async (page: Page, name: RegExp): Promise<void> => {
  300 |   await expect(page.getByText('Detalhe da fatura')).toHaveCount(0, {
  301 |     timeout: 20_000,
  302 |   });
  303 | 
  304 |   await page.getByRole('link', { name }).click();
  305 | };
  306 | const createCardThroughUi = async (page: Page, cardName: string): Promise<CreatedCardReference> => {
  307 |   await navigateBySidebar(page, /Cartões de Crédito|Cartões Corporativos/i);
  308 | 
  309 |   await page.getByRole('button', { name: /Novo Cartão/i }).click();
  310 | 
  311 |   const cardForm = page.locator('form#cardForm');
  312 | 
  313 |   await cardForm.getByPlaceholder('Ex: Nubank Empresarial').fill(cardName);
  314 |   await cardForm.locator('input[type="number"]').nth(0).fill('5000');
  315 |   await cardForm.locator('input[type="number"]').nth(1).fill('1');
  316 |   await cardForm.locator('input[type="number"]').nth(2).fill('10');
  317 | 
  318 |   await page.getByRole('button', { name: 'Salvar Cartão' }).click();
  319 | 
  320 |   await expect(page.getByText(cardName).first()).toBeVisible({
  321 |     timeout: 20_000,
  322 |   });
  323 | 
  324 |   const cardDoc = await waitUntil(
  325 |     () =>
  326 |       findWorkspaceCollectionDoc<{ name?: string }>(
  327 |         'credit_cards',
  328 |         (data) => data.name === cardName
  329 |       ),
  330 |     `Cartão ${cardName} não foi persistido no Firestore Emulator.`
  331 |   );
  332 | 
  333 |   return {
  334 |     id: cardDoc.id,
  335 |     name: cardName,
  336 |   };
  337 | };
  338 | 
  339 | const createCreditCardPurchaseThroughUi = async (
  340 |   page: Page,
  341 |   input: PurchaseInput
  342 | ): Promise<void> => {
  343 |   await navigateBySidebar(page, /Dashboard/i);
  344 | 
  345 |   await page.getByRole('button', { name: /Nova Transação/i }).click();
  346 |   await page.getByRole('button', { name: /^Cartão$/i }).click();
  347 | 
  348 |   const transactionForm = page.locator('form').last();
  349 |   const categorySelect = transactionForm.locator('select').nth(1);
  350 | 
  351 |   const purchaseDate = (() => {
  352 |     const now = new Date();
  353 | 
  354 |     return [
  355 |       now.getFullYear(),
  356 |       String(now.getMonth() + 1).padStart(2, '0'),
  357 |       String(now.getDate()).padStart(2, '0'),
  358 |     ].join('-');
  359 |   })();
  360 | 
  361 |   await transactionForm.locator('select').nth(0).selectOption(input.cardId);
  362 |   await transactionForm
```