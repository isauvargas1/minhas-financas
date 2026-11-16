import hashlib, subprocess, sys, json, pathlib
copia = pathlib.Path(sys.argv[1]); alvo = copia / sys.argv[2]; muts = json.loads(pathlib.Path(sys.argv[3]).read_text())
testes = ['tests/unit/work-time-consistency.test.ts', 'tests/unit/work-time-income-estimate.test.ts', 'tests/unit/work-time-guard.test.ts']
cmd = ['node', '--experimental-strip-types', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--test', *testes]
orig = alvo.read_bytes(); h0 = hashlib.sha256(orig).hexdigest()
def rodar(rotulo):
    p = subprocess.run(cmd, cwd=copia, capture_output=True, text=True, timeout=900)
    out = p.stdout
    tot = {k: next((int(l.split()[-1]) for l in out.splitlines() if l.startswith(f'# {k} ')), None) for k in ('tests', 'pass', 'fail', 'skipped', 'todo')}
    falhas = [l[7:].strip()[:150] for l in out.splitlines() if l.startswith('not ok ')]
    print(f'{rotulo}: exit={p.returncode} {tot}'); [print('   falha:', f) for f in falhas[:4]]
    return tot
for m in [None] + muts:
    if m is None: rodar('BASE'); continue
    texto = orig.decode()
    n = texto.count(m['old'])
    if n != 1: print(m['id'], 'NÃO APLICADO: casou', n, 'vezes'); continue
    alvo.write_text(texto.replace(m['old'], m['new']))
    t = rodar(f"{m['id']} ({m['desc']})")
    print('   ->', 'MORTO' if (t['fail'] or 0) > 0 else 'VIVO')
    alvo.write_bytes(orig)
    assert hashlib.sha256(alvo.read_bytes()).hexdigest() == h0, 'restauração falhou'
print('restaurado e conferido:', h0[:16])
