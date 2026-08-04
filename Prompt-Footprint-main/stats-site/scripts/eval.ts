// `npm run eval` — measure the Token Cutter against its built-in dataset.
//
// Exits non-zero when a case fails, so it can gate a change the same way the
// unit tests do.

import { formatReport, runEvaluation } from '../src/lib/tokenCutter/evaluate.ts'

const report = runEvaluation()
console.log(formatReport(report))

if (report.failed > 0) process.exitCode = 1
