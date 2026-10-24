'use strict';
/**
 * Package-install guard. Before `npm install x` / `pip install x` runs, check
 * the registry: a package that does not exist is a hallucinated name (an
 * attacker can register it later: "slopsquatting"); one first published days
 * ago is the shape such an attack takes. Both are refused with the reason.
 *
 * Network failures never block: no answer means no opinion.
 */

const fs = require('node:fs');
const path = require('node:path');

const NEW_DAYS = 14;
const TTL_MS = 24 * 3600 * 1000;

/** Parse install commands. Returns [{ eco: 'npm'|'pypi', name }]. */
function installTargets(cmd) {
  const out = [];
  for (const seg of String(cmd || '').split(/&&|\|\||;|\|/)) {
    const toks = seg.trim().split(/\s+/).filter(Boolean);
    if (!toks.length) continue;
    let i = 0;
    while (i < toks.length && /^[A-Z_][A-Z0-9_]*=/.test(toks[i])) i++;
    const verb = toks[i];
    const sub = toks[i + 1];
    let eco = null;
    let args = [];
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(verb) && ['install', 'i', 'add', 'in', 'isntall'].includes(sub)) { eco = 'npm'; args = toks.slice(i + 2); }
    else if ((verb === 'pip' || verb === 'pip3' || verb === 'uv' && sub === 'pip') && toks.includes('install')) { eco = 'pypi'; args = toks.slice(toks.indexOf('install') + 1); }
    else if (/^python3?$|^py$/.test(verb) && toks[i + 1] === '-m' && /^pip3?$/.test(toks[i + 2]) && toks[i + 3] === 'install') { eco = 'pypi'; args = toks.slice(i + 4); }
    else if ((verb === 'poetry' || verb === 'uv') && sub === 'add') { eco = 'pypi'; args = toks.slice(i + 2); }
    if (!eco) continue;
    for (let j = 0; j < args.length; j++) {
      const a = args[j].replace(/^['"]|['"]$/g, '');
      if (a.startsWith('-')) {
        if (/^(?:-r|--requirement|-c|--constraint|-e|--editable|-i|--index-url|--extra-index-url|--prefix|--target|-t|--registry|--tag)$/.test(a)) j++;
        continue;
      }
      if (/^(?:\.|\/|~|[A-Za-z]:\\)|^(?:git\+|https?:|file:|github:)|\.(?:tgz|whl|tar\.gz|zip)$/.test(a) || a.includes('/') && !a.startsWith('@')) continue;
      let name;
      if (eco === 'npm') name = a.startsWith('@') ? `@${a.slice(1).split('@')[0]}` : a.split('@')[0];
      else name = a.split(/[<>=!~;\[ ]/)[0];
      if (name && /^[@A-Za-z0-9._/-]+$/.test(name)) out.push({ eco, name: eco === 'pypi' ? name.toLowerCase() : name });
    }
  }
  return out;
}

async function lookup(eco, name, fetcher) {
  const url = eco === 'npm'
    ? `https://registry.npmjs.org/${name.replace('/', '%2F')}`
    : `https://pypi.org/pypi/${encodeURIComponent(name)}/json`;
  const res = await fetcher(url);
  if (res.status === 404) return { exists: false };
  if (res.status !== 200) return null;
  const j = await res.json();
  let created = null;
  if (eco === 'npm') created = j.time && j.time.created;
  else {
    const times = [];
    for (const files of Object.values(j.releases || {})) for (const f of files || []) if (f.upload_time_iso_8601 || f.upload_time) times.push(f.upload_time_iso_8601 || f.upload_time);
    created = times.sort()[0] || null;
  }
  return { exists: true, created };
}

function defaultFetcher(url) {
  return fetch(url, { signal: AbortSignal.timeout(4000), headers: { accept: 'application/json' } });
}

/**
 * Check every package an install command names.
 * @returns {Promise<{ decision: 'deny'|'none', rule?, reason? }>}
 */
async function checkInstall(cmd, { cacheDir = null, fetcher = defaultFetcher, now = Date.now(), allow = [] } = {}) {
  const targets = installTargets(cmd).filter((t) => !allow.includes(t.name));
  if (!targets.length) return { decision: 'none' };
  const cacheFile = cacheDir ? path.join(cacheDir, 'registry-cache.json') : null;
  let cache = {};
  if (cacheFile) { try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { cache = {}; } }
  const missing = [];
  const fresh = [];
  await Promise.all(targets.map(async (t) => {
    const key = `${t.eco}:${t.name}`;
    let info = cache[key] && now - cache[key].at < TTL_MS ? cache[key] : null;
    if (!info) {
      try { info = await lookup(t.eco, t.name, fetcher); } catch { info = null; }
      if (info) cache[key] = Object.assign({ at: now }, info);
    }
    if (!info) return;
    if (!info.exists) missing.push(t);
    else if (info.created && now - Date.parse(info.created) < NEW_DAYS * 86400000) fresh.push(Object.assign({ days: Math.max(0, Math.floor((now - Date.parse(info.created)) / 86400000)) }, t));
  }));
  if (cacheFile) { try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(cache)); } catch { /* ignore */ } }
  const where = (t) => (t.eco === 'npm' ? 'npm' : 'PyPI');
  if (missing.length) {
    return {
      decision: 'deny',
      rule: 'package-missing',
      reason: `Tandem blocked this install: ${missing.map((t) => `"${t.name}" does not exist on ${where(t)}`).join('; ')}. The name is probably wrong (or invented); installing a non-existent name lets anyone who registers it later run code here. Check the correct package name, or use what the project already has.`,
    };
  }
  if (fresh.length) {
    return {
      decision: 'deny',
      rule: 'package-new',
      reason: `Tandem blocked this install: ${fresh.map((t) => `"${t.name}" was first published on ${where(t)} ${t.days} day(s) ago`).join('; ')}. Brand-new packages are how typo- and slopsquatting attacks arrive. Ask the user to confirm this exact package, or add it to "allowPackages" in .claude/tandem.json.`,
    };
  }
  return { decision: 'none' };
}

module.exports = { installTargets, checkInstall, NEW_DAYS };
