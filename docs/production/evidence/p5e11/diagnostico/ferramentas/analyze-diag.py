import sys, re, glob, os
for f in sorted(glob.glob(sys.argv[1] + '/*.log')):
    lines = open(f).read().splitlines()
    name = os.path.basename(f)[:40]
    t0 = None; out = []
    for l in lines:
        m = re.match(r'^(\d+) ([NP]) (.*)$', l)
        if not m: continue
        t, kind, rest = int(m.group(1)), m.group(2), m.group(3)
        if 'reabrir painel' in rest: t0 = t
        if t0 is None: continue
        if re.match(r'(MARK|ROUTE|MUT (start|ok|err|applied)|ANIM (start|done) f_0[0-5] \{"opacity":0|ANIM exitComplete|LIST|SHARE)', rest) or (rest.startswith('EV click') ):
            r = rest
            r = re.sub(r'cache=.*', '', r); r = re.sub(r'SHARE prev=.*\| kept=', 'SHARE kept=', r)
            r = re.sub(r'\{"opacity":0,"height":0,"overflow":"hidden"\}', 'EXIT', r)
            out.append(f'{t - t0:6d} {r[:150]}')
    print('==', name, len(out))
    print('\n'.join(out))
