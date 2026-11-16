# P5-F — Cache em memória do SDK do Firestore na troca de conta

**Pergunta.** Depois que a conta A sai e a conta B entra na mesma aba, sem recarregar a página, o SDK do Firestore ainda tem em memória o documento privado de A?

**Método.** Sonda executada no Emulator (`minhas-financas-local`), só com dados sintéticos e os mesmos passos da interface:

1. A conta A (`probe-a`) abre um listener no próprio `users/probe-a/private_preferences/work_time_equivalent`, recebe o documento e cancela o listener.
2. A conta A sai (`signOut`), e a conta B (`probe-b`) entra no mesmo cliente.
3. A cada passo, a sonda chama `getDocFromCache` no caminho de A. No fim, chama `getDoc` no servidor como B.

**Resultado** (SDK web `firebase` 12.8.0):

| Momento | `getDocFromCache` no caminho de A | Servidor |
| --- | --- | --- |
| Logo depois de cancelar o listener (conta A) | devolve o documento | — |
| 500 ms depois (conta A) | devolve o documento | — |
| Depois do `signOut` | devolve o documento | — |
| Conta B logo depois de entrar | devolve o documento | — |
| Conta B 1,5 s depois | devolve o documento | — |
| Conta B, `getDoc` | — | `permission-denied` |

**Causa.** Sem `localCache` explícito, o SDK 12 usa `LruGcMemoryOfflineComponentProvider`: cache em memória com coleta LRU a partir de 40 MB (`node_modules/@firebase/firestore/dist/common-341bda9b.esm.js`, `__PRIVATE_ensureOfflineComponents`, "Using default OfflineComponentProvider"). Documento sem listener continua em memória até recarregar a página. Isso vale para **todos** os dados que o app lê, não só para a preferência: lançamentos, saldos e relatórios da sessão anterior também ficam. O logout da P1 (AUTH-11) limpa o React Query e o `localStorage`, mas não esse cache.

**O que a P5-F garante:**
- **Servidor.** As Rules negam à conta B a leitura e o listener do documento de A (`tests/firestore/work-time-p5f.rules.integration.test.mjs`, teste de troca de usuário).
- **Interface.** O estado da preferência é marcado com o uid: com uid diferente, fica "carregando" e os valores aparecem em reais. O caminho lido é montado só com o uid atual.
- **Código.** Nenhum código do app lê do cache local. A guarda `tests/unit/work-time-guard.test.ts` proíbe `getDocFromCache` e `getDocsFromCache` em `src/`.
- **Cópias.** A renda não vai para o `localStorage` nem para o React Query.

**Risco residual.** Numa máquina compartilhada, sem recarregar a página depois do logout, quem abrir as ferramentas de desenvolvedor pode inspecionar a memória do SDK e achar dados da sessão anterior, inclusive a renda. A interface do app não alcança esses dados. O risco é preexistente para todos os dados.

**Correção possível (fora do escopo da P5-F; decisão pendente).** É mudança global de plataforma, então fica registrada para a P6, ou como complemento do AUTH-11 na P8:
- (a) `initializeFirestore` com `memoryLocalCache({ garbageCollector: memoryEagerGarbageCollector() })`, que descarta documentos sem listener;
- (b) encerrar a instância do Firestore (`terminate`) no logout e na troca de conta, recriando-a para a próxima sessão;
- (c) recarregar a página depois do logout.

Qualquer uma das três afeta todos os módulos e precisa de validação própria.
