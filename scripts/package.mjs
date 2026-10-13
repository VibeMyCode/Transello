// Release ZIP + static audit (spec §9 "статическая проверка release ZIP", §13.1 package audit).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : [path.join(dir, d.name)]));
const all = files(dist).map((f) => path.relative(dist, f));

const problems = [];
const ALLOWED_EXT = /\.(js|css|html|json|png|txt)$/;
const ALLOWED_PERMS = ['storage', 'contextMenus', 'activeTab', 'scripting', 'identity'];
for (const f of all) {
  if (!ALLOWED_EXT.test(f)) problems.push(`unexpected file type: ${f}`);
  if (/(^|\/)\.|\.map$|node_modules|\.env/.test(f)) problems.push(`forbidden file: ${f}`);
  if (!/\.(js|html|css|json|txt)$/.test(f)) continue;
  const src = fs.readFileSync(path.join(dist, f), 'utf8');
  const rules = [
    [/\beval\s*\(|new\s+Function\s*\(/, 'eval/new Function'],
    [/<script[^>]+src=["']https?:/i, 'remote <script>'],
    [/import\s*\(\s*["']https?:/, 'remote dynamic import'],
    [/\bimportScripts\s*\(\s*["']https?:/, 'remote importScripts'],
    [/\b(sk-(proj|ant|or)?-?[A-Za-z0-9_-]{16,})/, 'API-key-like string'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
    [/sourceMappingURL/, 'source map reference'],
    [/__transelloTest|localhost/, 'E2E-only hook or localhost reference'],
  ];
  for (const [re, what] of rules) if (re.test(src)) problems.push(`${what} in ${f}`);
}
for (const p of manifest.permissions ?? []) if (!ALLOWED_PERMS.includes(p)) problems.push(`unexpected permission: ${p}`);
if (manifest.host_permissions?.length) problems.push(`host_permissions must be empty (use optional): ${manifest.host_permissions}`);
if (manifest.externally_connectable) problems.push('externally_connectable must not be declared');
if (manifest.content_security_policy) problems.push('custom CSP must not be declared (MV3 default is strict)');

if (problems.length) {
  console.error('Package audit FAILED:\n - ' + problems.join('\n - '));
  process.exit(1);
}
const zip = path.join(dist, '..', 'release', `transello-v${manifest.version}.zip`);
fs.mkdirSync(path.dirname(zip), { recursive: true });
fs.rmSync(zip, { force: true });
execFileSync('zip', ['-qrX', zip, '.'], { cwd: dist });
const sha = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
const kb = (fs.statSync(zip).size / 1024).toFixed(1);
console.log(`Package audit OK (${all.length} files, permissions: ${manifest.permissions.join(', ')})`);
console.log(`${path.relative(root, zip)}  ${kb} KB  sha256 ${sha}`);
