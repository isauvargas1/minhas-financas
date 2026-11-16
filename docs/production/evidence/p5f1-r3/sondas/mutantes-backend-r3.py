#!/usr/bin/env python3
"""P5-F.1-R3: mutantes do backend das marcas (gatilho em periods.ts, varredura e publicação em rebuild.ts).

Roda numa cópia da árvore (functions com node_modules por link, firebase.json com portas próprias): aplica um
mutante por vez (a troca tem de casar uma vez só), compila (tsc), roda a integração das marcas no Emulator
(minhas-financas-local), restaura o arquivo e confere que voltou byte a byte. Uso: <dir da cópia> <porta firestore>
<porta auth> <porta do proxy>.
"""
import hashlib, os, subprocess, sys

D, FS_PORT, AUTH_PORT, PROXY_PORT = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
# Diretório de trabalho com with-proxy-safe.sh e p5f1r3/logs (na sessão, o scratchpad); defina S para reproduzir.
S = os.environ.get('S', '<scratchpad>')
FN = os.path.join(D, 'functions')
TESTS = ['lib/cash/__tests__/projectionMarks.integration.test.js']
PE = 'src/cash/periods.ts'
RB = 'src/cash/rebuild.ts'
TR = 'src/triggers/transactions.ts'
PM = 'src/cash/projectionMarks.ts'
M = [
 # B01 compila (as referências continuam usadas): a marca é montada, mas não gravada.
 ('B01 marca não gravada no gatilho', PE,
  "  transaction.set(markRef, markDocumentData(workspaceId, context.transactionId,\n    pruneMarkDoc(markDoc, liveGenerations)));\n",
  "  void (markRef && markDocumentData(workspaceId, context.transactionId,\n    pruneMarkDoc(markDoc, liveGenerations)));\n"),
 ('B02 só a geração publicada recebe o evento', PE,
  "    generations.push({\n      id: staging.generation,", "    void ({\n      id: staging.generation,"),
 ('B03 quebra não registra a recuperação', PE,
  "  if (markBroken !== undefined) {\n    transaction.set(stateRef, markIssuePatch(", "  if (markBroken === \"nunca\") {\n    transaction.set(stateRef, markIssuePatch("),
 ('B04 meses do gatilho sem a etiqueta da geração', PE,
  "  writeCashPlan(transaction, workspaceId, plan, categoryGenerations,\n    projectionGenerationOf(state));",
  "  writeCashPlan(transaction, workspaceId, plan, categoryGenerations,\n    INITIAL_PROJECTION_GENERATION);"),
 ('B05 sem a hora do estado anterior (raiz por evento)', PE,
  "markEventOf(before, after, context.beforeUpdateTime ?? null)", "markEventOf(before, after, null)"),
 ('B06 gatilho não repassa a hora do estado anterior', TR,
  "beforeUpdateTime: event.beforeUpdateTime", "beforeUpdateTime: undefined"),
 ('B07 varredura sem âncoras', RB,
  "        for (const anchor of work.anchors) {\n          transaction.set(", "        for (const anchor of work.anchors.slice(0, 0)) {\n          transaction.set("),
 ('B08 publicação não troca a posição das marcas', RB,
  "      markSlot: current.markSlot,\n      markRecoveryNeeded:", "      markSlot: state.markSlot,\n      markRecoveryNeeded:"),
 ('B09 publicação desliga a recuperação sem conferir o corte', RB,
  "      markRecoveryNeeded: state.markIssueMaxEventTime !== null &&\n        compareCommitTimes(state.markIssueMaxEventTime, cutoff) > 0,",
  "      markRecoveryNeeded: false,"),
 ('B10 meses publicados sem a etiqueta da geração nova', RB,
  "    const projectionGeneration = {id: current.rebuildId, cutoff};", "    const projectionGeneration = {id: \"g0\", cutoff: null};"),
 ('B12 publicação sem conferir que as entregas alimentaram a preparada', RB,
  "    if (stagingGeneration !== null && !fed.includes(stagingGeneration)) {",
  "    if (stagingGeneration !== null && !fed.includes(stagingGeneration) && fed.length < 0) {"),
 # B11: a página não tem o estado da projeção em escopo; a âncora sai com a geração inicial em vez da preparada.
 ('B11 âncora com a geração inicial, não a preparada', RB,
  "              g: current.rebuildId,\n              cut: current.cutoff,", "              g: \"g0\",\n              cut: current.cutoff,"),
 # B13–B16: poda do gatilho (L-PRI-02).
 ('B13 gatilho sem poda (componentes superadas ficam)', PE,
  "  const liveGenerations = state.categoryStaging ?\n    [state.categoryGeneration, state.categoryStaging.generation] :\n    [state.categoryGeneration];",
  "  const liveGenerations = [state.categoryGeneration,\n    ...Object.values(markDoc.anchors).map((x) => x?.g ?? \"\"),\n    ...Object.values(markDoc.chains).map((x) => x?.g ?? \"\"),\n    ...(state.categoryStaging ? [state.categoryStaging.generation] : [])];"),
 ('B14 poda apaga a geração preparada', PE,
  "  const liveGenerations = state.categoryStaging ?\n    [state.categoryGeneration, state.categoryStaging.generation] :\n    [state.categoryGeneration];",
  "  const liveGenerations = [state.categoryGeneration];"),
 ('B15 poda não tira âncoras superadas', PM,
  "    if (anchor && keep.has(anchor.g)) pruned.anchors[slot] = anchor;", "    if (anchor) pruned.anchors[slot] = anchor;"),
 ('B16 poda não tira cadeias superadas', PM,
  "    if (chain && keep.has(chain.g)) pruned.chains[slot] = chain;", "    if (chain) pruned.chains[slot] = chain;"),
]


def sh(cmd, cwd, timeout):
    return subprocess.run(cmd, cwd=cwd, shell=True, capture_output=True, text=True, timeout=timeout)


def build():
    p = sh('rm -rf lib && npx tsc -p .', FN, 900)
    return p.returncode, (p.stdout + p.stderr)[-2000:]


def run(label):
    log = os.path.join(S, 'p5f1r3', 'logs', f'mut-backend-{label}.log')
    cmd = (f'timeout 2400 bash {S}/with-proxy-safe.sh {PROXY_PORT} firebase emulators:exec --only auth,firestore '
           f'--project minhas-financas-local "cd functions && FIRESTORE_EMULATOR_HOST=127.0.0.1:{FS_PORT} '
           f'FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:{AUTH_PORT} GCLOUD_PROJECT=minhas-financas-local node --test '
           f'--test-concurrency=1 {" ".join(TESTS)}" > {log} 2>&1')
    p = sh(cmd, D, 2600)
    text = open(log, encoding='utf-8', errors='replace').read()
    fails = [line for line in text.splitlines() if line.startswith('not ok') or line.startswith('    not ok')]
    passed = [line for line in text.splitlines() if line.startswith('# pass ')]
    return p.returncode, fails, passed


code, out = build()
if code != 0:
    print('base: falha de compilação\n' + out); sys.exit(2)
code, fails, passed = run('base')
print(f'base: saída {code}, {len(fails)} falha(s), {passed}', flush=True)
if code != 0 or fails:
    print('\n'.join(fails[:10])); sys.exit(2)
dead = 0
applied = 0
ONLY = [item for item in os.environ.get('ONLY', '').split(',') if item]
for name, path, a, b in M:
    if ONLY and name.split(' ')[0] not in ONLY:
        continue
    full = os.path.join(FN, path); orig = open(full).read(); h = hashlib.sha256(orig.encode()).hexdigest()
    if orig.count(a) != 1:
        print(f'NÃO APLICOU ({orig.count(a)}) {name}', flush=True); continue
    applied += 1
    open(full, 'w').write(orig.replace(a, b))
    try:
        code, out = build()
        if code != 0:
            dead += 1
            print(f'MORTO (compilação) {name}', flush=True)
            continue
        label = name.split(' ')[0]
        code, fails, passed = run(label)
        if code != 0 or fails:
            dead += 1
            print(f'MORTO {name}: {len(fails)} falha(s): ' + ' | '.join(f[:110] for f in fails[:3]), flush=True)
        else:
            print(f'VIVO {name} {passed}', flush=True)
    finally:
        open(full, 'w').write(orig)
        assert hashlib.sha256(open(full).read().encode()).hexdigest() == h, f'restauração falhou: {path}'
code, out = build()
print(f'mortos {dead}/{applied} (lista {len(M)}); recompilação final: {code}', flush=True)
