# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: work-time-b03.spec.ts >> B03-f (R3.1): leitura nova sem prova: o saldo novo fica em reais e nunca é convertido pela estimativa anterior; a reconstrução traz a conversão certa
- Location: e2e/work-time-b03.spec.ts:632:1

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('[data-work-time]')
Expected: 0
Received: 9
Timeout:  12000ms

Call log:
  - Expect "toHaveCount" with timeout 12000ms
  - waiting for locator('[data-work-time]')
    28 × locator resolved to 9 elements
       - unexpected value "9"

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
    - generic [ref=e85]:
      - generic [ref=e86]:
        - heading "Minhas Finanças" [level=1] [ref=e89]
        - generic [ref=e90]:
          - button "Mês anterior" [active] [ref=e91] [cursor=pointer]:
            - img [ref=e92]
          - generic [ref=e95]:
            - button "Selecionar Mês e Ano" [ref=e96] [cursor=pointer]:
              - generic [ref=e97]: Outubro de 2026
              - img [ref=e98]
            - button "Hoje" [ref=e101] [cursor=pointer]
          - button "Próximo mês" [ref=e102] [cursor=pointer]:
            - img [ref=e103]
        - generic [ref=e105]:
          - button "Notificações, nenhuma não lida" [ref=e107] [cursor=pointer]:
            - img [ref=e108]
          - button "Mostrar valores em tempo de trabalho" [pressed] [ref=e112] [cursor=pointer]:
            - img [ref=e113]
          - button "Ativar modo escuro" [ref=e116] [cursor=pointer]:
            - img [ref=e117]
          - generic [ref=e119]:
            - generic [ref=e120] [cursor=pointer]:
              - generic [ref=e121]: Olá, Usuário
              - generic [ref=e122]: PESSOAL
            - button "Abrir menu da conta" [ref=e123] [cursor=pointer]: U
      - paragraph [ref=e124]:
        - img [ref=e125]
        - generic [ref=e128]: "Valores em tempo de trabalho equivalente: uma estimativa aproximada, não o valor exato."
        - button "Mostrar em R$" [ref=e129] [cursor=pointer]
    - generic [ref=e130]:
      - generic [ref=e131]:
        - figure [ref=e132]:
          - generic [ref=e133]:
            - heading "Saldo Atual" [level=2] [ref=e134]
            - img [ref=e136]
          - paragraph [ref=e140]:
            - generic "R$ 20.200,00 · tempo de trabalho estimado" [ref=e141]:
              - text: ≈ 808 h
              - generic [ref=e142]: aproximadamente 808 horas de trabalho, equivalente a R$ 20.200,00
          - generic [ref=e143]: Em contas
        - button "Receitas aproximadamente 280 horas de trabalho, equivalente a R$ 7.000,00 Mensal" [ref=e144] [cursor=pointer]:
          - generic [ref=e145]:
            - heading "Receitas" [level=2] [ref=e146]
            - img [ref=e148]
          - paragraph [ref=e150]:
            - generic "R$ 7.000,00 · tempo de trabalho estimado" [ref=e151]:
              - text: ≈ 280 h
              - generic [ref=e152]: aproximadamente 280 horas de trabalho, equivalente a R$ 7.000,00
          - generic [ref=e153]: Mensal
        - button "Despesas 0 minutos de trabalho, equivalente a R$ 0,00 Mensal" [ref=e154] [cursor=pointer]:
          - generic [ref=e155]:
            - heading "Despesas" [level=2] [ref=e156]
            - img [ref=e158]
          - paragraph [ref=e160]:
            - generic "R$ 0,00 · tempo de trabalho estimado" [ref=e161]:
              - text: 0 min
              - generic [ref=e162]: 0 minutos de trabalho, equivalente a R$ 0,00
          - generic [ref=e163]: Mensal
        - button "Investimentos 0 minutos de trabalho, equivalente a R$ 0,00 Mensal" [ref=e164] [cursor=pointer]:
          - generic [ref=e165]:
            - heading "Investimentos" [level=2] [ref=e166]
            - img [ref=e168]
          - paragraph [ref=e170]:
            - generic "R$ 0,00 · tempo de trabalho estimado" [ref=e171]:
              - text: 0 min
              - generic [ref=e172]: 0 minutos de trabalho, equivalente a R$ 0,00
          - generic [ref=e173]: Mensal
      - generic [ref=e174]:
        - generic [ref=e175]:
          - generic [ref=e176]:
            - generic [ref=e177]:
              - heading "Distribuição de Despesas" [level=2] [ref=e178]
              - generic [ref=e179]:
                - button "Gráfico de Pizza" [ref=e180] [cursor=pointer]:
                  - img [ref=e181]
                - button "Gráfico de Barras" [ref=e184] [cursor=pointer]:
                  - img [ref=e185]
                - button "Gráfico de Linha" [ref=e187] [cursor=pointer]:
                  - img [ref=e188]
                - button "Gráfico de Rosca" [ref=e191] [cursor=pointer]:
                  - img [ref=e192]
            - img [ref=e198]:
              - generic [ref=e199]:
                - img [ref=e201]
                - generic [ref=e202]:
                  - generic [ref=e204]: 100%
                  - generic [ref=e206]: 0%
                  - generic [ref=e208]: 0%
                  - generic [ref=e210]: 0%
            - generic [ref=e211]:
              - generic [ref=e214]: Receitas
              - generic [ref=e217]: Despesas
              - generic [ref=e220]: Investimentos
              - generic [ref=e223]: Faturas de cartão
          - generic [ref=e225] [cursor=pointer]:
            - generic [ref=e226]:
              - generic [ref=e227]:
                - img [ref=e229]
                - generic [ref=e232]:
                  - heading "Diagnóstico" [level=3] [ref=e233]
                  - paragraph [ref=e234]: Últimos 30 dias
              - img [ref=e236]
            - generic [ref=e238]:
              - generic [ref=e239]:
                - generic [ref=e240]: Resultado
                - generic "R$ 800,00 · tempo de trabalho estimado" [ref=e242]:
                  - text: ≈ 32 h
                  - generic [ref=e243]: aproximadamente 32 horas de trabalho, equivalente a R$ 800,00
              - generic [ref=e244]:
                - generic [ref=e245]: Aportes líq.
                - generic [ref=e246]: 0,00%
            - generic [ref=e247]:
              - img [ref=e248]
              - generic [ref=e250]: Saúde financeira estável.
        - generic [ref=e251]:
          - generic [ref=e252]:
            - heading "Transações Recentes" [level=2] [ref=e253]
            - generic [ref=e254]:
              - button "Nova Transação" [ref=e256] [cursor=pointer]:
                - img [ref=e257]
                - text: Nova Transação
              - combobox [ref=e258]:
                - option "Todas" [selected]
                - option "Receitas"
                - option "Despesas"
                - option "Investimentos"
          - table [ref=e260]:
            - rowgroup [ref=e261]:
              - row "Descrição Categoria Data Valor" [ref=e262]:
                - columnheader "Descrição" [ref=e263]:
                  - button "Descrição" [ref=e264] [cursor=pointer]
                - columnheader "Categoria" [ref=e265]:
                  - button "Categoria" [ref=e266] [cursor=pointer]
                - columnheader "Data" [ref=e267]:
                  - button "Data" [ref=e268] [cursor=pointer]:
                    - text: Data
                    - img [ref=e269]
                - columnheader "Valor" [ref=e271]:
                  - button "Valor" [ref=e272] [cursor=pointer]
            - rowgroup [ref=e273]:
              - row "Comissão B03 R3.1 Renda B03 15/10/2026 + aproximadamente 20 horas de trabalho, equivalente a R$ 500,00" [ref=e274]:
                - cell "Comissão B03 R3.1" [ref=e275]:
                  - generic [ref=e277]: Comissão B03 R3.1
                - cell "Renda B03" [ref=e278]:
                  - generic [ref=e281]: Renda B03
                - cell "15/10/2026" [ref=e282]
                - cell "+ aproximadamente 20 horas de trabalho, equivalente a R$ 500,00" [ref=e283]:
                  - text: +
                  - generic "R$ 500,00 · tempo de trabalho estimado" [ref=e284]:
                    - text: ≈ 20 h
                    - generic [ref=e285]: aproximadamente 20 horas de trabalho, equivalente a R$ 500,00
              - row "Salário 2026-10 Renda B03 05/10/2026 + aproximadamente 248 horas de trabalho, equivalente a R$ 6.200,00" [ref=e286]:
                - cell "Salário 2026-10" [ref=e287]:
                  - generic [ref=e289]: Salário 2026-10
                - cell "Renda B03" [ref=e290]:
                  - generic [ref=e293]: Renda B03
                - cell "05/10/2026" [ref=e294]
                - cell "+ aproximadamente 248 horas de trabalho, equivalente a R$ 6.200,00" [ref=e295]:
                  - text: +
                  - generic "R$ 6.200,00 · tempo de trabalho estimado" [ref=e296]:
                    - text: ≈ 248 h
                    - generic [ref=e297]: aproximadamente 248 horas de trabalho, equivalente a R$ 6.200,00
              - row "Salário 2026-09 Renda B03 05/09/2026 + aproximadamente 240 horas de trabalho, equivalente a R$ 6.000,00" [ref=e298]:
                - cell "Salário 2026-09" [ref=e299]:
                  - generic [ref=e301]: Salário 2026-09
                - cell "Renda B03" [ref=e302]:
                  - generic [ref=e305]: Renda B03
                - cell "05/09/2026" [ref=e306]
                - cell "+ aproximadamente 240 horas de trabalho, equivalente a R$ 6.000,00" [ref=e307]:
                  - text: +
                  - generic "R$ 6.000,00 · tempo de trabalho estimado" [ref=e308]:
                    - text: ≈ 240 h
                    - generic [ref=e309]: aproximadamente 240 horas de trabalho, equivalente a R$ 6.000,00
              - row "Salário 2026-08 Renda B03 05/08/2026 + aproximadamente 248 horas de trabalho, equivalente a R$ 6.200,00" [ref=e310]:
                - cell "Salário 2026-08" [ref=e311]:
                  - generic [ref=e313]: Salário 2026-08
                - cell "Renda B03" [ref=e314]:
                  - generic [ref=e317]: Renda B03
                - cell "05/08/2026" [ref=e318]
                - cell "+ aproximadamente 248 horas de trabalho, equivalente a R$ 6.200,00" [ref=e319]:
                  - text: +
                  - generic "R$ 6.200,00 · tempo de trabalho estimado" [ref=e320]:
                    - text: ≈ 248 h
                    - generic [ref=e321]: aproximadamente 248 horas de trabalho, equivalente a R$ 6.200,00
```

# Test source

```ts
  568 |   await openDashboard(page);
  569 |   await expect(balanceCard(page)).toContainText(timeRegex(minutesIncluded), { timeout: 60_000 });
  570 | 
  571 |   const seen = await recorded(page);
  572 |   await attachRecorded('b03-d', seen);
  573 |   expectOnlyConsistent(seen, { minutes: [minutesIncluded, minutesExcluded], balances: [balance], hourly: [2_500, hourlyIncluded] });
  574 |   expect(seen.balance.filter((entry) => entry.startsWith('tempo|')).length, 'o saldo foi convertido nos dois estados').toBeGreaterThanOrEqual(2);
  575 | });
  576 | 
  577 | test('B03-e: a receita desconsiderada sai da janela da estimativa e volta: o mês antigo só deixa de descontar quando projeção e marca mudam juntas', async ({ page, request }) => {
  578 |   test.setTimeout(360_000);
  579 |   const tenant = await seedTenant(request);
  580 |   const lastMonth = habitualMonths()[2];
  581 |   const description = 'Comissão B03 muda de mês';
  582 |   const extra = 300_000;
  583 |   const extraId = await createIncome(request, tenant.pf, `${lastMonth}-15`, extra, description);
  584 |   await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: tenant.baseCents + extra });
  585 |   await waitForMark(tenant.pf.workspaceId, extraId);
  586 |   await seedPreference(A.uid, tenant.pf.workspaceId, { displayMode: 'time', excludedIncomeIds: extraId });
  587 |   await startOn(page, A.uid, tenant.pf.workspaceId);
  588 |   await login(page, A.email);
  589 |   await selectLastMonth(page);
  590 | 
  591 |   // Em qualquer estado consistente a renda da estimativa é a de três meses de salário (R$ 25,00/h): dentro da
  592 |   // janela, a projeção tem a receita e o desconto a tira; fora dela, a projeção não a tem e não há o que tirar.
  593 |   // Desconto duplo daria uma renda menor; falta de desconto, uma maior. Nenhum dos dois pode aparecer.
  594 |   const balance = OPENING_CENTS + tenant.incomeCents + extra;
  595 |   const minutes = roundedMinutes(balance, tenant.workMinutes, tenant.incomeCents);
  596 |   const doubled = roundedMinutes(balance, tenant.workMinutes, tenant.incomeCents - extra);
  597 |   const missing = roundedMinutes(balance, tenant.workMinutes, tenant.incomeCents + extra);
  598 |   expect(new Set([minutes, doubled, missing]).size, 'os estados errados são distinguíveis').toBe(3);
  599 |   await expect(balanceCard(page)).toContainText(timeRegex(minutes), { timeout: 60_000 });
  600 |   await startRecording(page);
  601 | 
  602 |   // Sai da janela: a data passa para hoje (mês corrente, fora dos três meses completos).
  603 |   await editIncome(request, tenant.pf, extraId, description, extra, saoPauloToday());
  604 |   await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: tenant.baseCents, [currentMonth()]: extra });
  605 |   await expect(balanceCard(page)).toContainText(timeRegex(minutes), { timeout: 60_000 });
  606 |   // Dá tempo de a escuta e a prova refeita (marca e meses) acontecerem e confere o estado em reais/tempo.
  607 |   await openWorkTimeSettings(page);
  608 |   await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 60_000 });
  609 | 
  610 |   // Volta para a janela.
  611 |   await editIncome(request, tenant.pf, extraId, description, extra, `${lastMonth}-15`);
  612 |   await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: tenant.baseCents + extra, [currentMonth()]: 0 });
  613 |   await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 60_000 });
  614 |   await openDashboard(page);
  615 |   await expect(balanceCard(page)).toContainText(timeRegex(minutes), { timeout: 60_000 });
  616 | 
  617 |   const seen = await recorded(page);
  618 |   await attachRecorded('b03-e', seen);
  619 |   expectOnlyConsistent(seen, { minutes: [minutes], balances: [balance], hourly: [2_500] });
  620 |   expect(seen.balance.filter((entry) => entry.startsWith('tempo|')).length, 'o saldo foi convertido').toBeGreaterThanOrEqual(1);
  621 |   expect((await storedPreference(A.uid))?.excludedIncomeIds, 'a exclusão continua a mesma').toBe(extraId);
  622 | });
  623 | 
  624 | /**
  625 |  * P5-F.1-R3.1 (R3-AUD-01): a última estimativa provada nunca aparece como a atual. Com a estimativa provada na tela, a
  626 |  * cadeia da marca da desconsiderada fica quebrada e outra sessão lança uma receita no mês escolhido: a leitura nova
  627 |  * (outro saldo, outra renda) não tem prova, na mesma identidade da estimativa (conta, espaço, preferência) e sem falha
  628 |  * de leitura. O saldo novo aparece em reais, nunca convertido pela renda anterior (o que a R3 mostrava até o tempo de
  629 |  * interface); o tempo de interface só troca o texto. A reconstrução do owner traz a prova e a conversão volta com a
  630 |  * renda nova.
  631 |  */
  632 | test('B03-f (R3.1): leitura nova sem prova: o saldo novo fica em reais e nunca é convertido pela estimativa anterior; a reconstrução traz a conversão certa', async ({ page, request }) => {
  633 |   test.setTimeout(360_000);
  634 |   const tenant = await seedTenant(request);
  635 |   const lastMonth = habitualMonths()[2];
  636 |   const extraId = await createIncome(request, tenant.pf, `${lastMonth}-15`, 50_000, 'Comissão B03 R3.1');
  637 |   await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: tenant.baseCents + 50_000 });
  638 |   await waitForMark(tenant.pf.workspaceId, extraId);
  639 |   await seedPreference(A.uid, tenant.pf.workspaceId, { displayMode: 'time', excludedIncomeIds: extraId });
  640 |   await startOn(page, A.uid, tenant.pf.workspaceId);
  641 |   await login(page, A.email);
  642 |   await selectLastMonth(page);
  643 | 
  644 |   // Estados consistentes: antes, o saldo pela renda sem a desconsiderada (R$ 25,00/h); depois, o saldo novo pela renda
  645 |   // com a receita nova. O estado inseguro da R3: o saldo novo convertido pela renda anterior.
  646 |   const late = 30_000;
  647 |   const before = OPENING_CENTS + tenant.incomeCents + 50_000;
  648 |   const after = before + late;
  649 |   const minutesBefore = roundedMinutes(before, tenant.workMinutes, tenant.incomeCents);
  650 |   const minutesAfter = roundedMinutes(after, tenant.workMinutes, tenant.incomeCents + late);
  651 |   const minutesUnsafe = roundedMinutes(after, tenant.workMinutes, tenant.incomeCents);
  652 |   expect(new Set([minutesBefore, minutesAfter, minutesUnsafe]).size, 'os três estados são distinguíveis').toBe(3);
  653 |   const hourlyAfter = hourlyCents(tenant.incomeCents + late, tenant.workMinutes);
  654 |   expect(hourlyAfter).not.toBe(2_500);
  655 |   const unsafe = `tempo|${norm(workTimeText(minutesUnsafe))}`;
  656 |   const normalized = (seen: Recorded) => seen.balance.map((entry) => `${entry.slice(0, entry.indexOf('|'))}|${norm(entry.slice(entry.indexOf('|') + 1))}`);
  657 |   await expect(balanceCard(page)).toContainText(timeRegex(minutesBefore), { timeout: 60_000 });
  658 |   await startRecording(page);
  659 | 
  660 |   // A cadeia da geração vigente da marca fica quebrada; outra sessão lança uma receita no mês escolhido.
  661 |   const current = await currentMarkSlot(tenant.pf.workspaceId, extraId, lastMonth);
  662 |   await db().doc(markPath(tenant.pf.workspaceId, extraId)).update({ [`chains.${current.slot}.broken`]: 'pending_overflow' });
  663 |   await createIncome(request, tenant.pf, `${lastMonth}-16`, late, 'Receita B03 R3.1 sem prova');
  664 |   await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: tenant.baseCents + 50_000 + late });
  665 | 
  666 |   // O saldo novo aparece em reais, sem nenhum valor convertido; o topo diz que os valores ficam em reais.
  667 |   await expect(balanceCard(page)).toContainText(brl(after), { timeout: 60_000 });
> 668 |   await expect(page.locator('[data-work-time]')).toHaveCount(0);
      |                                                  ^ Error: expect(locator).toHaveCount(expected) failed
  669 |   await expect(notice(page)).toContainText(
  670 |     /Calculando a estimativa de tempo de trabalho: enquanto isso, os valores ficam em reais\.|Estimativa de tempo de trabalho indisponível agora: os valores continuam em reais\./,
  671 |   );
  672 |   const midway = await recorded(page);
  673 |   await attachRecorded('b03-f-sem-prova', midway);
  674 |   expect(normalized(midway), 'o saldo novo nunca convertido pela renda anterior').not.toContain(unsafe);
  675 | 
  676 |   // Em Configurações: sem hora estimada; depois do tempo de interface, "estimativa em atualização" (só o texto muda).
  677 |   await openWorkTimeSettings(page);
  678 |   await expect(previewHourly(page)).toHaveCount(0);
  679 |   const failure = previewError(page);
  680 |   await expect(failure).toContainText(UPDATING_TEXT, { timeout: 60_000 });
  681 |   await expect(failure.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
  682 |   await expect(failure).not.toContainText(/permission|insufficient|firestore|firebase|pending_overflow|broken/i);
  683 |   await expect(previewHourly(page)).toHaveCount(0);
  684 | 
  685 |   // O owner reconstrói a projeção (até concluir): a prova volta e a conversão também, com a renda nova.
  686 |   const rebuilt = await runPagedCallable(request, tenant.pf.token, 'rebuildCashPeriods', {
  687 |     workspaceId: tenant.pf.workspaceId, pageSize: 300, reason: 'Reconstrução da projeção (E2E B03-f)', dryRun: false,
  688 |   }, 'e2e-b03f-rebuild');
  689 |   expect(rebuilt.result?.completed, JSON.stringify(rebuilt)).toBe(true);
  690 |   const month = (await db().doc(`workspaces/${tenant.pf.workspaceId}/cash_report_periods/${lastMonth}`).get()).data();
  691 |   expect(month?.projectionGeneration?.id, 'geração nova publicada').not.toBe(current.generationId);
  692 |   expect(month?.incomeCents, 'a reconstrução não muda o total').toBe(tenant.baseCents + 50_000 + late);
  693 |   let retries = 0;
  694 |   await expect(async () => {
  695 |     if (await failure.isVisible()) {
  696 |       retries += 1;
  697 |       await failure.getByRole('button', { name: 'Tentar de novo' }).click();
  698 |     }
  699 |     await expect(previewHourly(page)).toHaveText(brl(hourlyAfter), { timeout: 10_000 });
  700 |   }).toPass({ timeout: 60_000 });
  701 |   await test.info().attach('b03-f-tentativas', { body: `Cliques em "Tentar de novo": ${retries}`, contentType: 'text/plain' });
  702 |   await expect(failure).toHaveCount(0);
  703 | 
  704 |   await openDashboard(page);
  705 |   await expect(balanceCard(page)).toContainText(timeRegex(minutesAfter), { timeout: 60_000 });
  706 |   const seen = await recorded(page);
  707 |   await attachRecorded('b03-f', seen);
  708 |   expect(normalized(seen), 'o saldo novo nunca convertido pela renda anterior').not.toContain(unsafe);
  709 |   expectOnlyConsistent(seen, { minutes: [minutesBefore, minutesAfter], balances: [before, after], hourly: [hourlyAfter] });
  710 |   expect(norm(lastBalance(seen).slice(6))).toBe(norm(workTimeText(minutesAfter)));
  711 |   expect(await storedPreference(A.uid), 'a estimativa não grava nada').toMatchObject({ excludedIncomeIds: extraId, displayMode: 'time' });
  712 | });
  713 | 
```