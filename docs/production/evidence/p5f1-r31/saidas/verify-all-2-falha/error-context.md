# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workspace-membership.spec.ts >> convite, aceite, troca de papel, remoção e perda de acesso entre duas contas
- Location: e2e/workspace-membership.spec.ts:169:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "removed"
Received: "active"

Call Log:
- Timeout 12000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - complementary "Menu principal" [ref=e4]:
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
          - link "Clientes & Recebíveis" [ref=e20] [cursor=pointer]:
            - /url: "#"
            - img [ref=e22]
            - generic [ref=e25]: Clientes & Recebíveis
        - listitem [ref=e26]:
          - link "Empréstimos Corp." [ref=e27] [cursor=pointer]:
            - /url: "#"
            - img [ref=e29]
            - generic [ref=e32]: Empréstimos Corp.
        - listitem [ref=e33]:
          - link "Cartões Corporativos" [ref=e34] [cursor=pointer]:
            - /url: "#"
            - img [ref=e36]
            - generic [ref=e38]: Cartões Corporativos
        - listitem [ref=e39]:
          - link "Metas Empresariais" [ref=e40] [cursor=pointer]:
            - /url: "#"
            - img [ref=e42]
            - generic [ref=e45]: Metas Empresariais
        - listitem [ref=e46]:
          - link "Rateios & Reembolsos" [ref=e47] [cursor=pointer]:
            - /url: "#"
            - img [ref=e49]
            - generic [ref=e54]: Rateios & Reembolsos
        - listitem [ref=e55]:
          - link "Contratos & Recorrências" [ref=e56] [cursor=pointer]:
            - /url: "#"
            - img [ref=e58]
            - generic [ref=e61]: Contratos & Recorrências
        - listitem [ref=e62]:
          - link "Relatórios Empresariais" [ref=e63] [cursor=pointer]:
            - /url: "#"
            - img [ref=e65]
            - generic [ref=e67]: Relatórios Empresariais
        - listitem [ref=e68]:
          - link "Meu Plano" [ref=e69] [cursor=pointer]:
            - /url: "#"
            - img [ref=e71]
            - generic [ref=e74]: Meu Plano
        - listitem [ref=e75]:
          - link "Configurações" [ref=e76] [cursor=pointer]:
            - /url: "#"
            - img [ref=e78]
            - generic [ref=e81]: Configurações
    - button "Sair" [ref=e83] [cursor=pointer]:
      - img
      - generic [ref=e86]: Sair
  - main [ref=e87]:
    - generic [ref=e89]:
      - generic [ref=e91]:
        - heading "Finanças da Empresa" [level=1] [ref=e92]
        - generic [ref=e93]:
          - img [ref=e94]
          - text: Empresa Convite E2E
      - generic [ref=e97]:
        - button "Mês anterior" [ref=e98] [cursor=pointer]:
          - img [ref=e99]
        - generic [ref=e102]:
          - button "Selecionar Mês e Ano" [ref=e103] [cursor=pointer]:
            - generic [ref=e104]: Novembro de 2026
            - img [ref=e105]
          - button "Hoje" [ref=e108] [cursor=pointer]
        - button "Próximo mês" [ref=e109] [cursor=pointer]:
          - img [ref=e110]
      - generic [ref=e112]:
        - button "Notificações, nenhuma não lida" [ref=e114] [cursor=pointer]:
          - img [ref=e115]
        - button "Ativar modo escuro" [ref=e119] [cursor=pointer]:
          - img [ref=e120]
        - generic [ref=e122]:
          - generic [ref=e123] [cursor=pointer]:
            - generic [ref=e124]: Olá, Usuário
            - generic [ref=e126]: EMPRESA
          - button "Abrir menu da conta" [ref=e127] [cursor=pointer]: PJ
    - generic [ref=e128]:
      - heading "Configurações" [level=2] [ref=e129]
      - paragraph [ref=e130]: Gerencie as preferências e módulos administrativos do sistema.
      - generic [ref=e131]:
        - button "Dados da Empresa CNPJ, branding, alertas de negócio e cores do perfil. Acessar →" [ref=e132] [cursor=pointer]:
          - img [ref=e134]
          - heading "Dados da Empresa" [level=3] [ref=e137]
          - paragraph [ref=e138]: CNPJ, branding, alertas de negócio e cores do perfil.
          - generic [ref=e139]:
            - text: Acessar
            - generic [ref=e140]: →
        - button "Membros da Equipe Convide pessoas, gerencie permissões e acessos. Gerenciar →" [ref=e141] [cursor=pointer]:
          - img [ref=e143]
          - heading "Membros da Equipe" [level=3] [ref=e148]
          - paragraph [ref=e149]: Convide pessoas, gerencie permissões e acessos.
          - generic [ref=e150]:
            - text: Gerenciar
            - generic [ref=e151]: →
        - button "Cadastros Catálogo administrativo real do workspace, com busca, filtros e gestão centralizada. Acessar →" [ref=e152] [cursor=pointer]:
          - img [ref=e154]
          - heading "Cadastros" [level=3] [ref=e158]
          - paragraph [ref=e159]: Catálogo administrativo real do workspace, com busca, filtros e gestão centralizada.
          - generic [ref=e160]:
            - text: Acessar
            - generic [ref=e161]: →
        - button "Contas e carteiras Saldos por conta, extrato e transferências entre contas. Acessar →" [ref=e162] [cursor=pointer]:
          - img [ref=e164]
          - heading "Contas e carteiras" [level=3] [ref=e167]
          - paragraph [ref=e168]: Saldos por conta, extrato e transferências entre contas.
          - generic [ref=e169]:
            - text: Acessar
            - generic [ref=e170]: →
        - button "Personalização Ajuste temas, sons, animações e layout global. Acessar →" [ref=e171] [cursor=pointer]:
          - img [ref=e173]
          - heading "Personalização" [level=3] [ref=e179]
          - paragraph [ref=e180]: Ajuste temas, sons, animações e layout global.
          - generic [ref=e181]:
            - text: Acessar
            - generic [ref=e182]: →
        - button "Tempo de trabalho equivalente Veja valores também em horas de trabalho, a partir de uma renda que só você vê. Acessar →" [ref=e183] [cursor=pointer]:
          - img [ref=e185]
          - heading "Tempo de trabalho equivalente" [level=3] [ref=e188]
          - paragraph [ref=e189]: Veja valores também em horas de trabalho, a partir de uma renda que só você vê.
          - generic [ref=e190]:
            - text: Acessar
            - generic [ref=e191]: →
      - generic [ref=e193]:
        - generic [ref=e194]:
          - generic [ref=e195]:
            - heading "Membros e Permissões" [level=2] [ref=e196]:
              - img [ref=e197]
              - text: Membros e Permissões
            - paragraph [ref=e202]:
              - text: Gerencie quem tem acesso ao workspace
              - strong [ref=e203]: Empresa Convite E2E
              - text: .
          - button [ref=e204] [cursor=pointer]:
            - img [ref=e205]
        - generic [ref=e208]:
          - generic [ref=e209]:
            - heading "Convidar Novo Membro" [level=3] [ref=e210]:
              - img [ref=e211]
              - text: Convidar Novo Membro
            - generic [ref=e214]:
              - textbox "email@exemplo.com" [ref=e215]
              - button "Convidar" [ref=e216] [cursor=pointer]
            - paragraph [ref=e217]: "* Novos membros entram como \"Visualizador\" por padrão. Você pode alterar o papel abaixo."
          - generic [ref=e218]:
            - heading "Membros Atuais (2)" [level=3] [ref=e219]
            - generic [ref=e220]:
              - generic [ref=e221]:
                - generic [ref=e222]:
                  - generic [ref=e223]: E
                  - generic [ref=e224]:
                    - paragraph [ref=e225]: Usuário
                    - paragraph [ref=e226]: e2e-p1-owner@minhas-financas.local
                  - generic [ref=e227]: DONO
                - combobox [disabled] [ref=e229] [cursor=pointer]:
                  - option "Dono (Acesso Total)" [selected]
                  - option "Administrador"
                  - option "Membro (Editor)"
                  - option "Visualizador"
              - generic [ref=e230]:
                - generic [ref=e231]:
                  - generic [ref=e232]: E
                  - generic [ref=e233]:
                    - paragraph [ref=e234]: Usuário
                    - paragraph [ref=e235]: e2e-p1-invitee@minhas-financas.local
                - generic [ref=e236]:
                  - combobox [ref=e237] [cursor=pointer]:
                    - option "Dono (Acesso Total)"
                    - option "Administrador" [selected]
                    - option "Membro (Editor)"
                    - option "Visualizador"
                  - button "Remover acesso" [active] [ref=e238] [cursor=pointer]:
                    - img [ref=e239]
        - paragraph [ref=e243]:
          - img [ref=e244]
          - text: Ambiente Seguro com controle de acesso baseado em funções (RBAC).
```

# Test source

```ts
  165 |   expect(await db.doc(`workspaces/${workspaceA}/members/${b.uid}`).get().then((s) => s.exists))
  166 |     .toBe(false);
  167 | });
  168 | 
  169 | test('convite, aceite, troca de papel, remoção e perda de acesso entre duas contas', async ({ page, request }) => {
  170 |   const owner = { uid: 'e2e-p1-owner', email: 'e2e-p1-owner@minhas-financas.local' };
  171 |   const invitee = { uid: 'e2e-p1-invitee', email: 'e2e-p1-invitee@minhas-financas.local' };
  172 |   await createUser(owner.uid, owner.email);
  173 |   await createUser(invitee.uid, invitee.email);
  174 |   const db = adminSdk().firestore();
  175 | 
  176 |   // Conta do owner e uma empresa, pelas callables reais.
  177 |   const ownerToken = await tokenFor(request, owner.email);
  178 |   expect((await callCallable(request, ownerToken, 'bootstrapAccount', {})).status).toBe(200);
  179 |   // Pessoal + empresa excede o Free (1 workspace próprio, D-08): owner Pro.
  180 |   await seedPaidPlan(owner.uid, 'pro');
  181 |   const created = await callCallable(request, ownerToken, 'createWorkspace', {
  182 |     type: 'PJ', name: 'Empresa Convite E2E', idempotencyKey: 'e2e-p1-create-company',
  183 |   });
  184 |   expect(created.status, created.errorMessage).toBe(200);
  185 |   const workspaceId = String(created.result?.workspaceId);
  186 | 
  187 |   // O workspace sai do backend já provisionado, antes de qualquer tela abri-lo:
  188 |   // catálogo geral (com centros de custo, por ser PJ) e as carteiras de
  189 |   // investimento padrão (D-15: nenhuma conta ou ativo técnico).
  190 |   const catalog = await db.collection(`workspaces/${workspaceId}/settings_catalog`).get();
  191 |   expect(catalog.docs.filter((doc) => doc.get('group') === 'cost_center')).toHaveLength(3);
  192 |   // P3-J (D-30): a carteira de caixa não é catálogo; é a conta autoritativa.
  193 |   expect(catalog.docs.some((doc) => doc.get('group') === 'wallet')).toBe(false);
  194 |   const accounts = await db.collection(`workspaces/${workspaceId}/cash_accounts`).get();
  195 |   expect(accounts.docs.map((doc) => [doc.get('name'), doc.get('balanceCents'), doc.get('status')]))
  196 |     .toEqual([['Carteira principal', 0, 'active']]);
  197 |   expect(catalog.docs.filter((doc) => doc.get('group') === 'investment_class')
  198 |     .map((doc) => doc.get('name')).sort())
  199 |     .toEqual(['Caixa e liquidez', 'Expansão', 'Reserva operacional']);
  200 |   expect((await db.collection(`workspaces/${workspaceId}/investment_accounts`).get()).size).toBe(0);
  201 |   expect((await db.collection(`workspaces/${workspaceId}/investment_assets`).get()).size).toBe(0);
  202 | 
  203 |   // O owner abre a empresa e convida pela tela.
  204 |   await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
  205 |     `lastWorkspaceId_${owner.uid}`, workspaceId,
  206 |   ]);
  207 |   await login(page, owner.email);
  208 |   await expect(page.getByText('Empresa Convite E2E').first()).toBeVisible();
  209 |   await page.getByText('Configurações', { exact: true }).first().click();
  210 |   await page.getByText('Membros da Equipe', { exact: true }).click();
  211 |   await expect(page.getByText('Membros e Permissões')).toBeVisible();
  212 |   await page.getByPlaceholder('email@exemplo.com').fill(invitee.email);
  213 |   await page.getByRole('button', { name: 'Convidar' }).click();
  214 |   await expect(page.getByText(`Convite registrado para ${invitee.email}.`)).toBeVisible();
  215 |   // Sem e-mail transacional (E-11), nenhuma tela afirma que houve envio.
  216 |   await expect(page.getByText(/e-mail enviado|enviamos/i)).toHaveCount(0);
  217 | 
  218 |   const invites = await db.collection(`workspaces/${workspaceId}/invites`)
  219 |     .where('emailNormalized', '==', invitee.email).get();
  220 |   expect(invites.size).toBe(1);
  221 |   expect(invites.docs[0].get('status')).toBe('pending');
  222 |   expect(invites.docs[0].get('role')).toBe('viewer');
  223 |   expect(await db.doc(`workspaces/${workspaceId}/members/${invitee.uid}`).get().then((s) => s.exists))
  224 |     .toBe(false);
  225 | 
  226 |   // O convidado aceita com a própria conta.
  227 |   const inviteToken = await issueInviteTokenForE2E(workspaceId, invites.docs[0].id);
  228 |   const inviteeToken = await tokenFor(request, invitee.email);
  229 |   expect((await callCallable(request, inviteeToken, 'bootstrapAccount', {})).status).toBe(200);
  230 |   const accepted = await callCallable(request, inviteeToken, 'acceptWorkspaceInvite', {
  231 |     token: inviteToken,
  232 |   });
  233 |   expect(accepted.status, accepted.errorMessage).toBe(200);
  234 |   expect(accepted.result?.role).toBe('viewer');
  235 | 
  236 |   // Viewer é somente leitura no servidor.
  237 |   const viewerEdit = await callCallable(request, inviteeToken, 'updateWorkspaceSettings', {
  238 |     workspaceId, name: 'Tentativa do viewer',
  239 |   });
  240 |   expect(viewerEdit.errorStatus).toBe('PERMISSION_DENIED');
  241 | 
  242 |   // O owner promove pela tela (a lista é relida ao reabrir).
  243 |   await page.reload();
  244 |   await page.getByText('Configurações', { exact: true }).first().click();
  245 |   await page.getByText('Membros da Equipe', { exact: true }).click();
  246 |   const inviteeRow = page.locator('div', { hasText: invitee.email }).filter({
  247 |     has: page.locator('select'),
  248 |   }).last();
  249 |   await expect(inviteeRow.locator('select')).toHaveValue('viewer');
  250 |   await inviteeRow.locator('select').selectOption('admin');
  251 |   await expect.poll(async () =>
  252 |     (await db.doc(`workspaces/${workspaceId}/members/${invitee.uid}`).get()).get('role'))
  253 |     .toBe('admin');
  254 | 
  255 |   const adminEdit = await callCallable(request, inviteeToken, 'updateWorkspaceSettings', {
  256 |     workspaceId, name: 'Empresa Convite E2E',
  257 |   });
  258 |   expect(adminEdit.status, adminEdit.errorMessage).toBe(200);
  259 | 
  260 |   // O owner remove pela tela: remoção lógica.
  261 |   page.once('dialog', (dialog) => void dialog.accept());
  262 |   await inviteeRow.getByTitle('Remover acesso').click();
  263 |   await expect.poll(async () =>
  264 |     (await db.doc(`workspaces/${workspaceId}/members/${invitee.uid}`).get()).get('status'))
> 265 |     .toBe('removed');
      |      ^ Error: expect(received).toBe(expected) // Object.is equality
  266 |   expect((await db.doc(`users/${invitee.uid}/workspaces/${workspaceId}`).get()).get('status'))
  267 |     .toBe('removed');
  268 | 
  269 |   // Perda de acesso: o servidor recusa e a empresa some da lista do convidado.
  270 |   const afterRemoval = await callCallable(request, inviteeToken, 'updateWorkspaceSettings', {
  271 |     workspaceId, name: 'Depois da remoção',
  272 |   });
  273 |   expect(afterRemoval.errorStatus).toBe('PERMISSION_DENIED');
  274 | 
  275 |   // Fecha a janela de membros (o botão de fechar fica no cabeçalho dela) antes
  276 |   // de sair pela barra lateral, que ela cobre.
  277 |   await page.getByRole('heading', { name: 'Membros e Permissões' })
  278 |     .locator('xpath=../..').getByRole('button').click();
  279 |   await expect(page.getByText('Membros e Permissões')).toHaveCount(0);
  280 |   await page.getByText('Sair', { exact: true }).first().click();
  281 |   await expect(page.getByTestId('e2e-login-button')).toBeVisible();
  282 |   await login(page, invitee.email);
  283 |   // A lista de workspaces fica no menu da conta: abre-se a lista para que a
  284 |   // ausência da empresa seja verificada nela, e não numa tela sem a lista.
  285 |   await page.getByText('Olá, Usuário').click();
  286 |   await expect(page.getByText('Perfis Financeiros')).toBeVisible();
  287 |   await expect(page.getByRole('button', { name: 'Pessoal', exact: true })).toBeVisible();
  288 |   await expect(page.getByText('Empresa Convite E2E')).toHaveCount(0);
  289 | 
  290 |   const events = await db.collection(`workspaces/${workspaceId}/membership_events`).get();
  291 |   const operations = events.docs.map((event) => event.get('operation')).sort();
  292 |   expect(operations).toEqual([
  293 |     'invite.accepted',
  294 |     'invite.created',
  295 |     'member.removed',
  296 |     'member.role_changed',
  297 |     'workspace.created',
  298 |   ]);
  299 | });
  300 | 
```