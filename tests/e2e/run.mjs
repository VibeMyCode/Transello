// npm run test:chrome [-- uc01,uc02,...]  — real Chrome E2E against dist-e2e (built by the npm script).
import path from 'node:path';
import { launch, results, root, serveFixtures, swLogs, writeResults } from './lib.mjs';
import { uc01 } from './uc01.mjs';
import { uc02, uc03 } from './uc0203.mjs';
import { uc04 } from './uc04.mjs';
import { uc05 } from './uc05.mjs';

const suites = { uc01, uc02, uc03, uc04, uc05 };
const only = (process.argv[2] || Object.keys(suites).join(',')).split(',');
const server = await serveFixtures();
const env = await launch();
console.log('Chrome', await env.browser.version(), 'extension', env.extId);
try {
  for (const name of only) await suites[name]?.(env);
} finally {
  await env.browser.close();
  server.close();
  const out = path.join(root, 'test-results/e2e.json');
  writeResults(out);
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const skip = results.filter((r) => r.status === 'SKIP').length;
  if (swLogs.length) console.log('\nSW log:\n' + swLogs.join('\n'));
  console.log(`\n${results.length - fail - skip} passed, ${fail} failed${skip ? `, ${skip} slow skipped` : ''} → ${path.relative(root, out)}`);
  process.exitCode = fail ? 1 : 0;
}
