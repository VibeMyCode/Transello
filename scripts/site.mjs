// Build the public site (GitHub Pages): privacy policy from docs/PRIVACY_POLICY.md + support page. No deps.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'site-dist');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'site'), out, { recursive: true });
fs.copyFileSync(path.join(root, 'public/icons/icon-128.png'), path.join(out, 'icon.png'));

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/(^|[\s(])(https:\/\/[^\s)<]+)/g, '$1<a href="$2">$2</a>')
    .replace(/([\w.+-]+@[\w-]+\.[\w.]+)/g, '<a href="mailto:$1">$1</a>');

function md(src) {
  const html = [];
  let list = null;
  const close = () => {
    if (list) html.push(`</${list}>`);
    list = null;
  };
  const item = (kind, text) => {
    if (list !== kind) {
      close();
      html.push(`<${kind}>`);
      list = kind;
    }
    html.push(`<li>${inline(text)}</li>`);
  };
  for (const line of src.split('\n')) {
    let m;
    if ((m = /^(#{1,3}) (.*)/.exec(line))) {
      close();
      html.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
    } else if (/^---\s*$/.test(line)) {
      close();
      html.push('<hr>');
    } else if ((m = /^\d+\. (.*)/.exec(line))) item('ol', m[1]);
    else if ((m = /^\s*- (.*)/.exec(line))) item('ul', m[1]);
    else if (!line.trim()) close();
    else {
      close();
      html.push(`<p>${inline(line)}</p>`);
    }
  }
  close();
  return html.join('\n');
}

const tpl = fs.readFileSync(path.join(out, '_page.html'), 'utf8');
fs.rmSync(path.join(out, '_page.html'));
const page = (title, body) => tpl.replace('{{TITLE}}', title).replace('{{BODY}}', body);
fs.writeFileSync(path.join(out, 'privacy.html'), page('Privacy Policy', md(fs.readFileSync(path.join(root, 'docs/PRIVACY_POLICY.md'), 'utf8'))));
for (const f of ['index.html', 'support.html']) fs.writeFileSync(path.join(out, f), page(f === 'index.html' ? 'Transello' : 'Support Transello', fs.readFileSync(path.join(out, f), 'utf8')));
console.log('site built →', path.relative(root, out), fs.readdirSync(out).join(', '));
