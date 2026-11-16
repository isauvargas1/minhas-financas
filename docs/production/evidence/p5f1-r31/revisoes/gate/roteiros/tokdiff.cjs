const ts = require(process.argv[2]);
const fs = require('fs');
const toks = (file) => {
  const text = fs.readFileSync(file, 'utf8');
  const sc = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const out = [];
  for (let k = sc.scan(); k !== ts.SyntaxKind.EndOfFileToken; k = sc.scan()) out.push(ts.SyntaxKind[k] + ' ' + JSON.stringify(sc.getTokenText()).slice(0, 160));
  return out;
};
const a = toks(process.argv[3]), b = toks(process.argv[4]);
for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) console.log(i, '\n  R3  :', a[i], '\n  R3.1:', b[i]);
