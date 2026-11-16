import subprocess, sys, shutil, os
W3 = sys.argv[1]
lib = os.path.join(W3, 'functions/lib/cash/projectionMarks.js')
orig = open(lib).read()
muts = {
 'M1 sempre avança (sem pendência)': ('if (!(0, exports.markMatches)(view.node, event.before))\n        return withPending(view, event);', ''),
 'M2 raiz event sem âncora aceita': ('return { kind: "broken", code: "base_without_anchor" };', 'return rooted("absent", null, chain.node, chain.pending);'),
 'M3 ignora a âncora': ('const anchor = (anchorRaw === null || anchorRaw === void 0 ? void 0 : anchorRaw.g) === generation.id ? anchorRaw : null;', 'const anchor = null;'),
 'M4 criação casa com qualquer nó': ('isNonexistent(node) :', 'true :'),
 'M5 absorção ignora conteúdo': ('const index = remaining.findIndex((item) => (0, exports.markMatches)(current, item.b));', 'const index = remaining.length > 0 ? 0 : -1;'),
 'M6 âncora com raiz absent aceita': ('return { kind: "broken", code: "anchor_after_absent" };', 'return rooted("absent", null, chain.node ?? { k: "absent" }, chain.pending);'),
 'M7 cadeia de outra geração vale': ('const chain = (chainRaw === null || chainRaw === void 0 ? void 0 : chainRaw.g) === generation.id ? chainRaw : null;', 'const chain = chainRaw ?? null;'),
}
res = {}
try:
  for name, (a, b) in muts.items():
    if orig.count(a) != 1:
      res[name] = f'NAO_APLICOU({orig.count(a)})'; continue
    open(lib, 'w').write(orig.replace(a, b))
    p = subprocess.run(['node', '--test', 'lib/cash/__tests__/projectionMarks.test.js'], cwd=os.path.join(W3, 'functions'), capture_output=True, text=True, timeout=600)
    fails = [l for l in p.stdout.splitlines() if l.startswith('not ok')]
    res[name] = 'MORTO' if p.returncode != 0 else 'SOBREVIVEU'
    res[name] += f' ({len(fails)} falha(s))'
finally:
  open(lib, 'w').write(orig)
for k, v in res.items(): print(f'{v:28s} {k}')
