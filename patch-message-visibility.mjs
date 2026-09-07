#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// A narrow structural match tolerates names/hashes, not changed logic.
// Vendored Acorn verifies candidates are executable syntax, never examples in strings/comments.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from './vendor/acorn/acorn.mjs';

export const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const identifiers = new Set();
function shape(specification) {
  return specification.match(/\$[a-z]+|"[^"]+"|[A-Za-z]\w*|!==|===|!=|&&|\|\||\S/g).map(token => {
    if (token.startsWith('$')) {
      const name = token.slice(1);
      if (identifiers.has(name)) return `\\k<${name}>`;
      identifiers.add(name);
      return `(?<${name}>[A-Za-z_$][\\w$]*)`;
    }
    if (token.startsWith('"')) return `(?:"${escape(token.slice(1, -1))}"|'${escape(token.slice(1, -1))}'|\x60${escape(token.slice(1, -1))}\x60)`;
    return escape(token);
  }).join('\\s*');
}
const prefix = shape('function $fn ( { unit : $unit , keepMcpAppEntriesPersistent : $keep , mcpServerStatuses : $statuses , renderMcpApps : $render } ) { if ( $unit . kind !== "standalone" ) return ! 1 ; let $item = $unit . item . item ; return $item . type === "dynamic-tool-call" && $dynamic ( $item ) || $keep && $render && $item . type === "mcp-tool-call" && $mcp ( { item : $item , mcpServerStatuses : $statuses } ) ? ! 0 :');
const originalPredicate = shape('$item . type === "user-message" && ( $item . steeringStatus != null || $item . hookFeedback === ! 0 )');
const persistentPredicate = shape('$item . type === "assistant-message" || $item . type === "user-message"');
const classifierPattern = new RegExp(`\\b${prefix}\\s*(?<predicate>${originalPredicate}|${persistentPredicate})\\s*;?\\s*}`, 'g');

export function inspectBundle(source) {
  const text = source.toString('utf8');
  if (!Buffer.from(text).equals(source)) throw new Error('Renderer is not valid UTF-8.');
  const matches = [...text.matchAll(classifierPattern)];
  if (!matches.length) return [];
  let ast;
  try { ast = parse(text, { ecmaVersion: 'latest', sourceType: 'module' }); }
  catch { throw new Error('Cannot parse candidate renderer; no changes.'); }
  const declarations = new Map();
  const pending = [ast];
  while (pending.length) {
    const node = pending.pop();
    if (node.type === 'FunctionDeclaration') declarations.set(node.start, node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof child.type === 'string') pending.push(child);
      } else if (value && typeof value.type === 'string') pending.push(value);
    }
  }
  return matches.filter(match => {
    const declaration = declarations.get(match.index);
    const returned = declaration?.body.body.at(-1);
    return declaration?.end === match.index + match[0].length &&
      returned?.type === 'ReturnStatement' && returned.argument?.type === 'ConditionalExpression' &&
      returned.argument.alternate?.type === 'LogicalExpression' &&
      returned.argument.alternate.start === match.index + match[0].lastIndexOf(match.groups.predicate);
  }).map(match => {
    const { item, predicate } = match.groups;
    // A full, fixed classifier shape is required, including its existing tool exceptions.
    const status = predicate.includes('assistant-message') ? 'patched' : 'unpatched';
    const within = match[0].lastIndexOf(predicate);
    return { status, item, predicate, offset: Buffer.byteLength(text.slice(0, match.index + within)) };
  });
}

export function patchBundle(source) {
  const matches = inspectBundle(source);
  if (matches.length !== 1) throw new Error(`Unsupported or ambiguous classifier (${matches.length} matches); no changes.`);
  const match = matches[0];
  if (match.status === 'patched') throw new Error('Classifier already keeps authored messages persistent.');
  // The original visibility expression below is also offered under CC0-1.0;
  // recipients may choose MIT OR CC0-1.0 for that contribution (see LICENSE-CC0).
  const expression = `${match.item}.type===\x60assistant-message\x60||${match.item}.type===\x60user-message\x60`;
  const length = Buffer.byteLength(match.predicate);
  if (Buffer.byteLength(expression) > length) throw new Error('Replacement does not fit the original predicate.');
  const patched = Buffer.from(source);
  Buffer.from(expression.padEnd(length, ' ')).copy(patched, match.offset);
  return patched;
}

export function readArchive(buffer) {
  if (buffer.length < 16 || buffer.readUInt32LE(0) !== 4) throw new Error('Invalid ASAR preamble.');
  const headerLength = buffer.readUInt32LE(12);
  const dataStart = 8 + buffer.readUInt32LE(4);
  if (headerLength <= 0 || 16 + headerLength > dataStart || dataStart > buffer.length) throw new Error('Invalid ASAR header.');
  const headerText = buffer.subarray(16, 16 + headerLength).toString('utf8');
  const header = JSON.parse(headerText);
  const files = [];
  function visit(node, parents = []) {
    if (!node.files || typeof node.files !== 'object') throw new Error('Invalid ASAR directory.');
    for (const [name, entry] of Object.entries(node.files)) {
      const parts = [...parents, name];
      if (entry.files) visit(entry, parts);
      else if (!entry.unpacked && !entry.link) {
        const relative = Number(entry.offset);
        const start = dataStart + relative;
        if (!Number.isSafeInteger(relative) || relative < 0 || !Number.isSafeInteger(entry.size) || entry.size < 0 || start + entry.size > buffer.length) throw new Error('Invalid ASAR file offset.');
        files.push({ asset: parts.join('/'), entry, start, source: buffer.subarray(start, start + entry.size) });
      }
    }
  }
  visit(header);
  return { header, headerText, headerLength, dataStart, files };
}

function verifyIntegrity(file) {
  const integrity = file.entry.integrity;
  if (integrity?.algorithm !== 'SHA256' || !Number.isSafeInteger(integrity.blockSize) || integrity.blockSize <= 0 || !Array.isArray(integrity.blocks)) throw new Error('Unsupported renderer integrity metadata.');
  if (sha256(file.source) !== integrity.hash) throw new Error('Existing renderer integrity mismatch.');
  const blocks = [];
  for (let at = 0; at < file.source.length; at += integrity.blockSize) blocks.push(sha256(file.source.subarray(at, at + integrity.blockSize)));
  if (JSON.stringify(blocks) !== JSON.stringify(integrity.blocks)) throw new Error('Existing renderer block integrity mismatch.');
}

export function inspectArchive(buffer) {
  const parsed = readArchive(buffer);
  const candidates = [];
  for (const file of parsed.files) {
    if (!/^webview\/assets\/[^/]+\.(?:m?js)$/.test(file.asset)) continue;
    for (const match of inspectBundle(file.source)) candidates.push({ ...file, ...match });
  }
  if (candidates.length !== 1) throw new Error(`Unsupported or ambiguous renderer (${candidates.length} classifiers); no changes.`);
  const target = candidates[0];
  if (parsed.files.some(file => file.asset !== target.asset && file.entry.size > 0 &&
      file.start < target.start + target.entry.size && target.start < file.start + file.entry.size)) {
    throw new Error('Renderer overlaps another packed ASAR file; no changes.');
  }
  verifyIntegrity(target);
  return { ...parsed, ...target };
}

export function patchArchive(buffer) {
  const parsed = inspectArchive(buffer);
  const patched = patchBundle(parsed.source);
  const integrity = parsed.entry.integrity;
  integrity.hash = sha256(patched);
  integrity.blocks = [];
  for (let offset = 0; offset < patched.length; offset += integrity.blockSize) integrity.blocks.push(sha256(patched.subarray(offset, offset + integrity.blockSize)));
  const header = Buffer.from(JSON.stringify(parsed.header));
  if (header.length !== parsed.headerLength) throw new Error('Unexpected ASAR header size change.');
  const result = Buffer.from(buffer);
  header.copy(result, 16);
  patched.copy(result, parsed.start);
  inspectArchive(result);
  return result;
}

function dpkg(args) {
  const result = spawnSync('/usr/bin/dpkg-query', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('Cannot discover an installed chatgpt package through dpkg-query.');
  return result.stdout;
}

export function discoverPackage(packageName = 'chatgpt') {
  if (!/^[a-z0-9][a-z0-9+.-]*(?::[a-z0-9-]+)?$/.test(packageName)) throw new Error('Invalid Debian package name.');
  const [status, version] = dpkg(['-W', '-f=${db:Status-Status}\t${Version}', packageName]).trim().split('\t');
  if (status !== 'installed' || !version) throw new Error('ChatGPT package is not fully installed.');
  const paths = dpkg(['-L', packageName]).split('\n');
  const archives = paths.filter(p => p.startsWith('/') && /\/resources\/app\.asar$/.test(p));
  if (archives.length !== 1) throw new Error(`Expected one package-owned resources/app.asar, found ${archives.length}.`);
  return { archive: archives[0], version, packageName };
}

export function backupPath(archive, version, original) {
  return `${archive}.message-visibility-${version.replace(/[^A-Za-z0-9.+_-]/g, '_')}-${sha256(original)}.bak`;
}

function writeNew(target, contents, stat, onCreated = () => {}) {
  const fd = fs.openSync(target, 'wx', stat.mode & 0o7777);
  onCreated();
  try {
    fs.fchownSync(fd, stat.uid, stat.gid);
    fs.fchmodSync(fd, stat.mode & 0o7777);
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
}

function syncDirectory(directory) {
  const fd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function atomicWrite(target, contents, stat, expectedHash) {
  const temp = `${target}.message-visibility-${process.pid}.tmp`;
  let created = false;
  try {
    writeNew(temp, contents, stat, () => { created = true; });
    if (sha256(fs.readFileSync(target)) !== expectedHash) throw new Error('Archive changed during patching; no replacement made.');
    fs.renameSync(temp, target);
    syncDirectory(path.dirname(target));
  } finally { if (created && fs.existsSync(temp)) fs.unlinkSync(temp); }
}

function matchingBackup(archive, buffer) {
  const prefix = `${path.basename(archive)}.message-visibility-`;
  const matches = [];
  for (const name of fs.readdirSync(path.dirname(archive))) {
    if (!name.startsWith(prefix) || !name.endsWith('.bak')) continue;
    const candidate = path.join(path.dirname(archive), name);
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.size !== buffer.length) continue;
    try {
      const original = fs.readFileSync(candidate);
      if (sha256(patchArchive(original)) === sha256(buffer)) matches.push({ backup: candidate, original });
    } catch { /* Old or unrelated versions cannot authorize restore. */ }
  }
  if (!matches.length) throw new Error('No exact original backup matches this patched archive; restore refused.');
  return matches[0];
}

export function operate(mode, archive, version = 'manual') {
  const stat = fs.lstatSync(archive);
  if (!stat.isFile()) throw new Error('Expected a regular archive file, not a symlink.');
  const buffer = fs.readFileSync(archive);
  const parsed = inspectArchive(buffer);
  const currentHash = sha256(buffer);
  const report = { status: parsed.status, archive, version, asset: parsed.asset, archiveSha256: currentHash, rendererSha256: sha256(parsed.source) };
  if (mode === '--check') return report;
  if (mode === '--apply') {
    if (parsed.status === 'patched') return { ...report, result: 'Already persistent; no changes.' };
    const result = patchArchive(buffer);
    // The classifier may move or get renamed, but the resulting renderer must still parse.
    const syntax = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: inspectArchive(result).source, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    if (syntax.error || syntax.status !== 0) throw new Error('Patched renderer failed JavaScript syntax validation.');
    const backup = backupPath(archive, version, buffer);
    if (fs.existsSync(backup)) {
      if (!fs.lstatSync(backup).isFile() || sha256(fs.readFileSync(backup)) !== currentHash) throw new Error('Backup conflict; no changes.');
    } else {
      writeNew(backup, buffer, stat);
      syncDirectory(path.dirname(backup));
    }
    atomicWrite(archive, result, stat, currentHash);
    return { ...report, status: 'patched', backup, archiveSha256: sha256(result), rendererSha256: sha256(inspectArchive(result).source), result: 'Applied. Reload or restart ChatGPT to activate.' };
  }
  if (mode !== '--restore') throw new Error('Unknown operation.');
  if (parsed.status === 'unpatched') return { ...report, result: 'Original classifier present; no changes.' };
  const { backup, original } = matchingBackup(archive, buffer);
  atomicWrite(archive, original, stat, currentHash);
  return { ...report, status: 'unpatched', backup, archiveSha256: sha256(original), rendererSha256: sha256(inspectArchive(original).source), result: 'Restored. Reload or restart ChatGPT to activate.' };
}

function main() {
  const [mode = '--check', explicitArchive, ...extra] = process.argv.slice(2);
  if (!['--check', '--apply', '--restore'].includes(mode) || extra.length) throw new Error('Usage: node patch-message-visibility.mjs --check|--apply|--restore [app.asar]');
  let target;
  if (explicitArchive) target = { archive: path.resolve(explicitArchive), version: 'manual' };
  else target = discoverPackage();
  console.log(JSON.stringify(operate(mode, target.archive, target.version), null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`chatgpt-message-visibility: ${error.message}`); process.exitCode = 1; }
}
