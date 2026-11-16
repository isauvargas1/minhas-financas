const ts = require(process.argv[2]);
const fs = require('fs');
const print = (file) => {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  return ts.createPrinter({ removeComments: true }).printFile(sf);
};
const a = print(process.argv[3]), b = print(process.argv[4]);
console.log(a === b ? `AST SEM COMENTÁRIOS IGUAL (${a.length} chars)` : `AST DIFERENTE (${a.length} vs ${b.length})`);
