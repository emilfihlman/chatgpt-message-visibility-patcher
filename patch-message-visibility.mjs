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

// All-mode rendering preserves collapse intent as a visual cue.
const MODE_MARKERS = ['chatgpt-message-visibility:all:turn', 'chatgpt-message-visibility:all:group'];

export function normalizedFunction(node) {
  const names = new Map();
  function visit(value, parent, key) {
    if (Array.isArray(value)) return value.map(entry => visit(entry, parent, key));
    if (value == null || typeof value !== 'object') return value;
    if (value.type === 'TemplateLiteral' && !value.expressions.length) return { type: 'Literal', value: value.quasis[0].value.cooked };
    if (value.type === 'Literal') return { type: 'Literal', value: value.value, ...(value.regex ? { regex: value.regex } : {}) };
    if (value.type === 'Identifier') {
      const property = (key === 'key' && ['Property', 'MethodDefinition', 'PropertyDefinition'].includes(parent?.type) && !parent.computed) ||
        (key === 'property' && parent?.type === 'MemberExpression' && !parent.computed);
      if (property) return { type: 'Identifier', property: value.name };
      if (!names.has(value.name)) names.set(value.name, names.size);
      return { type: 'Identifier', binding: names.get(value.name) };
    }
    const result = {};
    for (const [childKey, child] of Object.entries(value)) {
      if (!['start', 'end', 'loc', 'range', 'raw'].includes(childKey)) result[childKey] = visit(child, value, childKey);
    }
    return result;
  }
  const canonical = JSON.stringify(visit(node));
  return { fingerprint: crypto.createHash('sha256').update(canonical).digest('hex'), names: [...names.keys()] };
}

function functionsFrom(text) {
  const ast = parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
  const result = [], pending = [ast];
  while (pending.length) {
    const node = pending.pop();
    if (node.type === 'FunctionDeclaration') result.push(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) { for (const child of value) if (child && typeof child.type === 'string') pending.push(child); }
      else if (value && typeof value.type === 'string') pending.push(value);
    }
  }
  return result;
}

function turnReplacement(d) {
  return `function ${d.name}(mvProps){"${MODE_MARKERS[0]}";
const mvBase=mvProps.agentActivityProps,mvVisible=mvProps.visibleAgentActivityProps??{},mvUnits=${d.units}(mvProps.items,{includeGeneratedImages:mvProps.includeGeneratedImages??false,mcpServerStatuses:mvBase.mcpServerStatuses});
const mvState=${d.state}({forceExpanded:mvProps.forceExpanded??false,hasFinalAssistantStarted:mvProps.hasFinalAssistantStarted,isTurnCancelled:mvProps.isTurnCancelled,hasRenderableAgentItems:mvUnits.length>0||mvProps.hasInlineSubagentActivity,preventAutoCollapse:mvProps.preventAutoCollapse??false,persistedCollapsed:mvProps.persistedCollapsed});
const mvParts=!mvProps.forceExpanded&&mvState.shouldAllowCollapse?${d.partition}(mvUnits,{keepMcpAppEntriesPersistent:mvProps.keepMcpAppEntriesPersistent??false,mcpServerStatuses:mvBase.mcpServerStatuses,renderMcpApps:mvBase.renderMcpApps}):null,mvExpanded=mvParts?.expandedUnits??mvUnits,mvHidden=mvParts?.collapsibleUnits??[],mvPre=mvParts?.preToggleUnits??[],mvInline=mvProps.inlineSubagentActivityContent??null,mvWorked=mvProps.workedForItem??mvParts?.workedForItem??null;
const mvCount=mvHidden.reduce((count,unit)=>count+(unit.kind==="group"?unit.items.length:1),0)+(mvInline==null?0:1),mvOnlyCompaction=mvHidden.length===1&&mvInline==null&&mvHidden[0]?.kind==="standalone"&&mvHidden[0].item.item.type==="context-compaction",mvDim=!mvProps.disableCollapse&&mvState.shouldAllowCollapse&&(mvExpanded.length>0||mvProps.hasInlineSubagentActivity)&&mvCount>0&&!mvOnlyCompaction&&mvState.isCollapsed;
const mvHiddenItems=new Set();for(const unit of mvHidden){if(unit?.kind==="standalone"&&unit.item?.item)mvHiddenItems.add(unit.item.item);else if(Array.isArray(unit?.items))for(const item of unit.items)if(item?.item)mvHiddenItems.add(item.item);}
const mvDimContent=content=>${d.jsx}("div",{"data-message-visibility":"normally-collapsed",title:"Normally collapsed; kept visible by the message visibility patch.",style:{opacity:.9},children:content}),mvOriginalProps={...mvBase,...mvVisible},mvWrap=mvOriginalProps.wrapSearchableContent,mvPropsAll={...mvOriginalProps,wrapSearchableContent:entry=>{const content=mvDim&&mvHiddenItems.has(entry.item)?mvDimContent(entry.content):entry.content;return typeof mvWrap==="function"?mvWrap({...entry,content}):content;}};
if(mvDim&&mvOriginalProps.subagentActivityContentByItemId instanceof Map){const mvMap=new Map(mvOriginalProps.subagentActivityContentByItemId);for(const item of mvHiddenItems)if(item?.type==="subagent-activity"&&mvMap.get(item.id)!=null)mvMap.set(item.id,mvDimContent(mvMap.get(item.id)));mvPropsAll.subagentActivityContentByItemId=mvMap;}
const mvDuration=mvProps.workedDurationMs,mvSummary=mvWorked&&mvParts?${d.jsx}(${d.entries},{...mvBase,units:[{kind:"standalone",key:"message-visibility-worked-for",item:{item:mvWorked}}]}):mvDuration!=null&&mvParts?${d.jsx}("div",{className:"text-sm text-token-text-secondary",children:"Worked for "+(mvDuration<60000?Math.round(mvDuration/1000)+"s":Math.floor(mvDuration/60000)+"m "+Math.round(mvDuration%60000/1000)+"s")}):null;
return ${d.jsx}(${d.fragment},{children:[mvPre.length?${d.jsx}(${d.entries},{...mvBase,units:mvPre}):null,mvSummary,mvExpanded.length?${d.jsx}(${d.entries},{...mvPropsAll,units:mvExpanded}):null,mvInline==null?null:mvDim?mvDimContent(mvInline):mvInline]});}`;
}

function groupReplacement(d) {
  return `function ${d.name}(mvProps){"${MODE_MARKERS[1]}";
const mvCanExpand=mvProps.canExpand!==false,mvDim=!mvCanExpand||mvProps.defaultExpanded!==true,mvSummary=${d.jsx}(${d.summary},{summary:mvProps.summary,summaryKey:mvProps.summaryKey,summaryTransition:mvProps.summaryTransition??"static",className:mvCanExpand?"shrink":undefined}),mvContent=typeof mvProps.children==="function"?mvProps.children():mvProps.children,mvBody=mvContent==null?null:${d.jsx}("div",{className:"-ms-2 ps-2","data-message-visibility":mvDim?"normally-collapsed":undefined,title:mvDim?"Normally collapsed; kept visible by the message visibility patch.":undefined,style:mvDim?{opacity:.9}:undefined,children:mvContent});
return mvProps.icon!==undefined?${d.jsx}(${d.iconLayout},{body:mvBody,icon:mvProps.icon,summary:mvSummary}):${d.jsx}(${d.layout},{header:${d.jsx}(${d.header},{dir:mvProps.dir,children:mvSummary}),body:mvBody});}`;
}

// Filled from the shipped build's full syntax, with identifier and quote normalization.
const ORIGINAL = {"turn":{"fingerprint":"42b3a36f4c843edc3775e53c10d9f4ad533cccfe44b25638e647148becd8dcf1","bindings":{"name":0,"units":45,"state":46,"partition":47,"entries":55,"jsx":54}},"group":{"fingerprint":"90688367bd80c488aef0f31caff5452447dc69030ae2192b5aaf7d7e6980be29","bindings":{"name":0,"react":20,"jsx":29,"summary":30,"iconLayout":37,"layout":41,"header":39}}};
const TURN_EXAMPLE = {name:'exampleTurn',units:'makeUnits',state:'collapseState',partition:'partitionUnits',entries:'EntryList',jsx:'jsxRuntime.jsx',fragment:'jsxRuntime.Fragment'};
const GROUP_EXAMPLE = {name:'exampleGroup',react:'reactRuntime',jsx:'jsxRuntime.jsx',summary:'Summary',iconLayout:'IconLayout',layout:'Layout',header:'Header'};
// Preserve published generators when evolving all-mode: backup matching regenerates
// the exact applied bytes so existing installations can switch modes and restore.
const PATCHED = {
  turn: normalizedFunction(functionsFrom(turnReplacement(TURN_EXAMPLE))[0]).fingerprint,
  group: normalizedFunction(functionsFrom(groupReplacement(GROUP_EXAMPLE))[0]).fingerprint,
};

export function inspectExpandedRenderer(source) {
  const text = source.toString('utf8');
  if (!Buffer.from(text).equals(source)) throw new Error('Renderer is not valid UTF-8.');
  // Most assets have neither renderer; avoid parsing every asset in the archive.
  if (!text.includes('shouldAnimateInitialCollapse') && !text.includes(MODE_MARKERS[0]) && !text.includes(MODE_MARKERS[1])) return {status:'unsupported'};
  let declarations;
  try { declarations = functionsFrom(text); }
  catch { throw new Error('Cannot parse candidate collapse renderer; no changes.'); }
  const found = {turn:[],group:[]};
  for (const node of declarations) {
    const hasMarker = node.body.body.some(statement=>statement.type==='ExpressionStatement'&&MODE_MARKERS.includes(statement.expression?.value));
    const normalized = normalizedFunction(node);
    for (const role of ['turn','group']) {
      const original = normalized.fingerprint === ORIGINAL[role].fingerprint;
      const patched = normalized.fingerprint === PATCHED[role];
      if (original || patched) {
        const names = normalized.names;
        const bindings = original ? Object.fromEntries(Object.entries(ORIGINAL[role].bindings).map(([key,index]) => [key,names[index]])) : {};
        if(original)bindings.jsx += '.jsx';
        if(original&&role==='turn')bindings.fragment=bindings.jsx.slice(0,-4)+'.Fragment';
        found[role].push({role,status:patched?'patched':'original',start:node.start,end:node.end,offset:Buffer.byteLength(text.slice(0,node.start)),length:Buffer.byteLength(text.slice(node.start,node.end)),bindings});
      }
    }
    if (hasMarker && !Object.values(PATCHED).includes(normalized.fingerprint)) throw new Error('Modified or incomplete all-mode renderer; no changes.');
  }
  if (!found.turn.length && !found.group.length) return {status:'unsupported'};
  if (found.turn.length!==1 || found.group.length!==1) {
    if([...found.turn,...found.group].some(match=>match.status==='patched'))throw new Error('Incomplete or ambiguous patched collapse renderer; no changes.');
    return {status:'unsupported'};
  }
  const replacements=[found.turn[0],found.group[0]];
  if(replacements[0].status!==replacements[1].status)throw new Error('Partially patched all-mode renderer; no changes.');
  return {status:replacements[0].status,replacements};
}

export function patchExpandedRenderer(source) {
  const inspected=inspectExpandedRenderer(source);
  if(inspected.status!=='original')throw new Error('Expected original turn and group collapse renderers.');
  const result=Buffer.from(source);
  for(const replacement of inspected.replacements){
    if(Object.entries(replacement.bindings).some(([key,name])=>key!=="name"&&/^mv[A-Z]/.test(name)))throw new Error("Renderer dependency conflicts with generated local bindings; no changes.");
    const text=replacement.role==='turn'?turnReplacement(replacement.bindings):groupReplacement(replacement.bindings);
    const bytes=Buffer.from(text);
    if(bytes.length>replacement.length)throw new Error('Expanded renderer replacement does not fit original function.');
    result.fill(32,replacement.offset,replacement.offset+replacement.length);
    bytes.copy(result,replacement.offset);
  }
  if(inspectExpandedRenderer(result).status!=='patched')throw new Error('Expanded renderer verification failed.');
  return result;
}

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
  const expanded = inspectExpandedRenderer(source);
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
    const messagesPatched = predicate.includes('assistant-message');
    if (messagesPatched && expanded.status === 'patched') throw new Error('Mixed visibility patches; restore an exact original backup before changing modes.');
    const mode = expanded.status === 'patched' ? 'all' : messagesPatched ? 'messages' : 'original';
    const status = mode === 'original' ? 'unpatched' : 'patched';
    const within = match[0].lastIndexOf(predicate);
    return { status, mode, allSupported: expanded.status !== 'unsupported', item, predicate, offset: Buffer.byteLength(text.slice(0, match.index + within)) };
  });
}

export function patchBundle(source, mode = 'messages') {
  if (!['messages', 'all'].includes(mode)) throw new Error('Choose --mode messages or --mode all.');
  const matches = inspectBundle(source);
  if (matches.length !== 1) throw new Error(`Unsupported or ambiguous classifier (${matches.length} matches); no changes.`);
  const match = matches[0];
  if (match.status === 'patched') throw new Error('Renderer already keeps authored messages visible.');
  if (mode === 'all') return patchExpandedRenderer(source);
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

export function patchArchive(buffer, mode = 'messages') {
  const parsed = inspectArchive(buffer);
  const patched = patchBundle(parsed.source, mode);
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

function matchingBackup(archive, buffer, mode) {
  const prefix = `${path.basename(archive)}.message-visibility-`;
  const matches = [];
  for (const name of fs.readdirSync(path.dirname(archive))) {
    if (!name.startsWith(prefix) || !name.endsWith('.bak')) continue;
    const candidate = path.join(path.dirname(archive), name);
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.size !== buffer.length) continue;
    try {
      const original = fs.readFileSync(candidate);
      if (sha256(patchArchive(original, mode)) === sha256(buffer)) matches.push({ backup: candidate, original });
    } catch { /* Old or unrelated versions cannot authorize restore. */ }
  }
  if (!matches.length) throw new Error('No exact original backup matches this patched archive; restore refused.');
  return matches[0];
}

export function operate(mode, archive, version = 'manual', visibilityMode = 'messages') {
  if (!['messages', 'all'].includes(visibilityMode)) throw new Error('Choose --mode messages or --mode all.');
  const stat = fs.lstatSync(archive);
  if (!stat.isFile()) throw new Error('Expected a regular archive file, not a symlink.');
  const buffer = fs.readFileSync(archive);
  const parsed = inspectArchive(buffer);
  const currentHash = sha256(buffer);
  const report = { status: parsed.status, mode: parsed.mode, allSupported: parsed.allSupported, archive, version, asset: parsed.asset, archiveSha256: currentHash, rendererSha256: sha256(parsed.source) };
  if (mode === '--check') return report;
  if (mode === '--apply') {
    if (parsed.status === 'patched' && parsed.mode === visibilityMode) return { ...report, result: visibilityMode === 'messages' ? 'Already persistent; no changes.' : 'Already patched in all mode; no changes.' };
    // Mode changes are computed from an exact original, never layered on another patch.
    const prior = parsed.status === 'patched' ? matchingBackup(archive, buffer, parsed.mode) : null;
    const original = prior?.original ?? buffer;
    const result = patchArchive(original, visibilityMode);
    // The classifier may move or get renamed, but the resulting renderer must still parse.
    const syntax = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: inspectArchive(result).source, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    if (syntax.error || syntax.status !== 0) throw new Error('Patched renderer failed JavaScript syntax validation.');
    const backup = prior?.backup ?? backupPath(archive, version, original);
    if (fs.existsSync(backup)) {
      if (!fs.lstatSync(backup).isFile() || sha256(fs.readFileSync(backup)) !== sha256(original)) throw new Error('Backup conflict; no changes.');
    } else {
      writeNew(backup, original, stat);
      syncDirectory(path.dirname(backup));
    }
    atomicWrite(archive, result, stat, currentHash);
    return { ...report, status: 'patched', mode: visibilityMode, backup, archiveSha256: sha256(result), rendererSha256: sha256(inspectArchive(result).source), result: 'Applied. Reload or restart ChatGPT to activate.' };
  }
  if (mode !== '--restore') throw new Error('Unknown operation.');
  if (parsed.status === 'unpatched') return { ...report, result: 'Original classifier present; no changes.' };
  const { backup, original } = matchingBackup(archive, buffer, parsed.mode);
  atomicWrite(archive, original, stat, currentHash);
  return { ...report, status: 'unpatched', mode: 'original', backup, archiveSha256: sha256(original), rendererSha256: sha256(inspectArchive(original).source), result: 'Restored. Reload or restart ChatGPT to activate.' };
}

function main() {
  const [mode = '--check', ...args] = process.argv.slice(2);
  let visibilityMode = 'messages';
  if (args[0] === '--mode') {
    if (mode !== '--apply' || !['messages', 'all'].includes(args[1])) throw new Error('--mode messages|all is supported with --apply.');
    visibilityMode = args.splice(0, 2)[1];
  }
  const [explicitArchive, ...extra] = args;
  if (!['--check', '--apply', '--restore'].includes(mode) || extra.length || explicitArchive?.startsWith('--')) throw new Error('Usage: node patch-message-visibility.mjs --check|--apply|--restore [--mode messages|all] [app.asar]');
  let target;
  if (explicitArchive) target = { archive: path.resolve(explicitArchive), version: 'manual' };
  else target = discoverPackage();
  console.log(JSON.stringify(operate(mode, target.archive, target.version, visibilityMode), null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`chatgpt-message-visibility: ${error.message}`); process.exitCode = 1; }
}
