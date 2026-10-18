# P5-E2 — a guarda estática não é vazia

A guarda `tests/unit/messages-removal-guard.test.ts` está ligada a `npm run test:unit:ui`, que roda no `verify:fast` e no CI (`.github/workflows/quality-gate.yml`, passo `test:unit:ui`). Ela tem 4 testes:

1. os arquivos do módulo não existem, depois de confirmar que a raiz aponta para o repositório;
2. nenhum arquivo em `src/` cita componentes, hooks, tipos, chaves locais, estado do painel ou o vínculo `onOpenSplitGroup`, nem em comentário;
3. o Header não tem rótulo, contador nem badge numérico de Mensagens, e mantém sino, tema e menu da conta;
4. a navegação real da Divisão de contas continua no App.

As regras citam identificadores do módulo removido. "mensagem", "message", "chat" e "conversa" continuam livres para notificações, erros e o assistente de IA.

A guarda varre só `src/`, que é o código de produção. Os testes citam o rótulo e as chaves em asserções negativas legítimas:
- o E2E `ux-navigation-a11y` exige zero botões "Mensagens", inclusive ocultos;
- o E2E `workspace-membership` exige que nenhuma chave `app_chat_` sobre depois do logout;
- `session-cleanup.test.ts` usa os valores-isca `app_chat` e `APP_CHAT_THREADS` como chaves mantidas.

## Resultado na árvore final

Prova em cópias fora do worktree: o `src` final mais a guarda, ou o `src` da base `92e5a9c`. Cada mutante reintroduz uma única coisa. A guarda reprova a base nos 4 testes e mata cada mutante no teste correspondente.

```
== FINAL (worktree) ==
    ok 1 - os arquivos do módulo simulado de Mensagens não existem
    ok 2 - nenhum código de produção usa o módulo removido
    ok 3 - o Header não oferece botão, contador nem painel de Mensagens
    ok 4 - a navegação real da Divisão de contas continua no App
== BASE 92e5a9c ==
    not ok 1 - os arquivos do módulo simulado de Mensagens não existem
    not ok 2 - nenhum código de produção usa o módulo removido
    not ok 3 - o Header não oferece botão, contador nem painel de Mensagens
    not ok 4 - a navegação real da Divisão de contas continua no App
== M1: chave app_chat_messages de volta na limpeza de sessão ==
    ok 1 - os arquivos do módulo simulado de Mensagens não existem
    not ok 2 - nenhum código de produção usa o módulo removido
    ok 3 - o Header não oferece botão, contador nem painel de Mensagens
    ok 4 - a navegação real da Divisão de contas continua no App
== M2: import do MessagesPanel de volta no Header ==
    ok 1 - os arquivos do módulo simulado de Mensagens não existem
    not ok 2 - nenhum código de produção usa o módulo removido
    ok 3 - o Header não oferece botão, contador nem painel de Mensagens
    ok 4 - a navegação real da Divisão de contas continua no App
== M3: botão rotulado Mensagens de volta no Header ==
    ok 1 - os arquivos do módulo simulado de Mensagens não existem
    ok 2 - nenhum código de produção usa o módulo removido
    not ok 3 - o Header não oferece botão, contador nem painel de Mensagens
    ok 4 - a navegação real da Divisão de contas continua no App
== M4: navegação real da Divisão de contas quebrada no App ==
    ok 1 - os arquivos do módulo simulado de Mensagens não existem
    ok 2 - nenhum código de produção usa o módulo removido
    ok 3 - o Header não oferece botão, contador nem painel de Mensagens
    not ok 4 - a navegação real da Divisão de contas continua no App
== M5: src/modules/messages/types.ts recriado ==
    not ok 1 - os arquivos do módulo simulado de Mensagens não existem
    ok 2 - nenhum código de produção usa o módulo removido
    ok 3 - o Header não oferece botão, contador nem painel de Mensagens
    ok 4 - a navegação real da Divisão de contas continua no App
== M6: comentário citando o MessagesPanel (a varredura não remove comentários) ==
    ok 1 - os arquivos do módulo simulado de Mensagens não existem
    not ok 2 - nenhum código de produção usa o módulo removido
    ok 3 - o Header não oferece botão, contador nem painel de Mensagens
    ok 4 - a navegação real da Divisão de contas continua no App
```

Contagem: 4 reprovações na base e 6 mutantes mortos, nenhum sobrevivente. A árvore final passa nos 4 testes.

A primeira versão da guarda removia os comentários antes de varrer. A revisão independente apontou o risco de falso negativo com `/*` dentro de string e de raiz vazia com caractere codificado no caminho. Esta versão usa `fileURLToPath`, confere a raiz e varre o texto bruto. O M6 prova a varredura de comentários.

## Roteiro

`<scratchpad>` é o diretório temporário da sessão.

```bash
#!/usr/bin/env bash
# P5-E2: a guarda estática reprova a base 92e5a9c e cada mutante que reintroduz o módulo removido.
# Roda em cópias fora do worktree (src final + a guarda); nada no worktree é alterado.
set -u
S=<scratchpad>
M=$S/p5e2/mutantes; WT=$S/wt-p5e2
mkdir -p "$M"; cd "$WT"
run_guard() { node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "$1/tests/unit/messages-removal-guard.test.ts" 2>&1 | grep -E "^(not )?ok " | sed 's/^/    /'; }
prep() { local d=$M/$1; mkdir -p "$d/tests/unit"; cp -r src "$d/"; cp tests/unit/messages-removal-guard.test.ts "$d/tests/unit/"; echo "$d"; }
echo "== FINAL (worktree) =="; run_guard "$WT"
echo "== BASE 92e5a9c =="; B=$M/base-r; mkdir -p "$B/tests/unit"; git archive 92e5a9c231d2c9a52f38146dd9b3c8f7fbffe081 src | tar -x -C "$B"; cp tests/unit/messages-removal-guard.test.ts "$B/tests/unit/"; run_guard "$B"
echo "== M1: chave app_chat_messages de volta na limpeza de sessão =="; d=$(prep m1-r); sed -i "s/  'finance_ai_chat_history_',/  'finance_ai_chat_history_',\n  'app_chat_messages',/" "$d/src/lib/sessionCleanup.ts"; run_guard "$d"
echo "== M2: import do MessagesPanel de volta no Header =="; d=$(prep m2-r); sed -i "s#^import NotificationsPanel from './NotificationsPanel.tsx';#&\nimport MessagesPanel from './MessagesPanel.tsx';#" "$d/src/components/Header.tsx"; run_guard "$d"
echo "== M3: botão rotulado Mensagens de volta no Header =="; d=$(prep m3-r); sed -i 's#                    <div className="h-6 w-px bg-border mx-1"></div>#                    <button type="button" aria-label="Mensagens" />\n&#' "$d/src/components/Header.tsx"; run_guard "$d"
echo "== M4: navegação real da Divisão de contas quebrada no App =="; d=$(prep m4-r); sed -i "s#<SplitGroupsView onSelectGroup={id => { setSelectedGroupId(id); setView('split_group_details'); }}#<SplitGroupsView onSelectGroup={() => {}}#" "$d/src/App.tsx"; run_guard "$d"
echo "== M5: src/modules/messages/types.ts recriado =="; d=$(prep m5-r); mkdir -p "$d/src/modules/messages"; echo "export interface Placeholder { id: string }" > "$d/src/modules/messages/types.ts"; run_guard "$d"
echo "== M6: comentário citando o MessagesPanel (a varredura não remove comentários) =="; d=$(prep m6-r); sed -i '1s#^#// o antigo MessagesPanel ficava aqui\n#' "$d/src/App.tsx"; run_guard "$d"
```
