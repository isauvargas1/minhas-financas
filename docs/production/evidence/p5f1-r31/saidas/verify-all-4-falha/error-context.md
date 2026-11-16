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