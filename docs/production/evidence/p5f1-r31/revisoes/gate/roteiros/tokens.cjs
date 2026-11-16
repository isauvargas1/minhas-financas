// Uso: node tokens.cjs <caminho-do-typescript> <arquivo-a> <arquivo-b> — compara os tokens sem comentários.
const ts = require(process.argv[2]);
const fs = require('fs');
const toks = (file) => {
  const text = fs.readFileSync(file, 'utf8');
  const sc = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.JSX, text);
  const out = [];
  for (let k = sc.scan(); k !== ts.SyntaxKind.EndOfFileToken; k = sc.scan()) out.push(k + ':' + sc.getTokenText());
  return out;
};
const a = toks(process.argv[3]), b = toks(process.argv[4]);
const same = a.length === b.length && a.every((t, i) => t === b[i]);
console.log((same ? 'TOKENS IGUAIS' : 'TOKENS DIFERENTES') + ` (${a.length} vs ${b.length})`);
