// SPDX-License-Identifier: MIT
// Synthetic inputs only: no application bundles or private transcript content.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
	backupPath,
	inspectArchive,
	inspectBundle,
	inspectExpandedRenderer,
	operate,
	patchArchive,
	patchBundle,
	readArchive,
	sha256,
} from '../patch-message-visibility.mjs';

function classifier(name = 'keepUnit')
{
	return `function ${name}({unit:unit,keepMcpAppEntriesPersistent:keep,mcpServerStatuses:statuses,renderMcpApps:render}) {
		if (unit.kind !== "standalone") return !1;
		let item = unit.item.item;
		return item.type === "dynamic-tool-call" && dynamic(item) || keep && render && item.type === "mcp-tool-call" && mcp({item:item,mcpServerStatuses:statuses}) ? !0 :
			item.type === "user-message" && (item.steeringStatus != null || item.hookFeedback === !0);
	}`;
}

function renderer()
{
	// Non-ASCII text ensures offsets are byte offsets, not JavaScript indices.
	return Buffer.from(`const exampleLabel = "Näytä viestit";\n${classifier()}\n`);
}

function allModeRenderer()
{
	// Original test components model only the public semantic contract. They are
	// deliberately small and independent of the application's component source.
	return Buffer.from(`${renderer().toString()}
	function turnView({agentActivityProps:base,visibleAgentActivityProps:visible,
		hasFinalAssistantStarted:finished,isTurnCancelled:cancelled,persistedCollapsed:saved,
		forceExpanded:forced,disableCollapse:disabled,preventAutoCollapse:prevented,
		hasInlineSubagentActivity:hasInline,inlineSubagentActivityContent:inline,
		keepMcpAppEntriesPersistent:keep,parts}) {
		let state = collapseState({hasFinalAssistantStarted:finished,persistedCollapsed:saved});
		let bodyUnits = [], persistent = [], hiddenUnits;
		{
			let parts = partitionUnits(makeUnits([], {mcpServerStatuses:base.mcpServerStatuses}), {keepMcpAppEntriesPersistent:keep});
			parts != null && (bodyUnits = state.isCollapsed ? parts.collapsibleUnits : parts.expandedUnits);
			persistent = parts != null && state.isCollapsed ? parts.persistentUnits : [];
			hiddenUnits = parts?.collapsibleUnits ?? bodyUnits;
		}
		let allowCollapse = !disabled && !forced;
		let collapsed = allowCollapse && state.isCollapsed;
		let count = hiddenUnits.reduce((total, unit) => total + (unit.kind === "group" ? unit.items.length : 1), 0);
		let body = jsxRuntime.jsx(Fragment, {children:[
			bodyUnits.length ? jsxRuntime.jsx(Entries, {...base,...visible,units:bodyUnits}) : null,
			inline
		]});
		return jsxRuntime.jsx(Fragment, {children:[
			jsxRuntime.jsx(Summary, {collapsedMessageCount:count,isCollapsed:collapsed}),
			persistent,
			!collapsed && body != null ? jsxRuntime.jsx(Motion.div, {
				className:"-ms-2 ps-2",initial:{height:0,opacity:0},
				animate:{height:"auto",opacity:1},exit:{height:0,opacity:0},
				children:[body]
			}) : null
		]});
	}
	function groupView({summary,summaryKey,summaryTransition,shouldAnimateInitialCollapse,
		canExpand,defaultExpanded,children}) {
		let can = canExpand !== false;
		let state = animationState(defaultExpanded);
		let expanded = state === "expanded";
		return can && state !== "collapsed" ? jsxRuntime.jsx(Motion.div, {
			className:"-ms-2 ps-2",initial:false,
			animate:expanded ? {opacity:1,height:"auto"} : {opacity:0,height:0},
			transition:{duration:0.2},
			style:{overflow:"hidden",pointerEvents:expanded ? "auto" : "none"},
			onAnimationComplete:()=>{},
			children:typeof children === "function" ? children() : children
		}) : null;
	}
	`);
}

function integrity(source, blockSize = 97)
{
	let blocks = [];
	for (let offset = 0; offset < source.length; offset += blockSize)
		blocks.push(sha256(source.subarray(offset, offset + blockSize)));
	return {algorithm:'SHA256', hash:sha256(source), blockSize, blocks};
}

function archiveFixture(source = renderer(), mutateHeader = () => {})
{
	let files = [
		['package.json', Buffer.from('{"name":"synthetic-fixture"}\n')],
		['webview/assets/renamed-fixture.mjs', source],
		['webview/assets/unrelated.js', Buffer.from('export const untouched = "sentinel";\n')],
	];
	let header = {files:{}};
	let offset = 0;
	for (let [name, contents] of files)
	{
		let parts = name.split('/');
		let parent = header;
		for (let part of parts.slice(0, -1))
		{
			parent.files[part] ??= {files:{}};
			parent = parent.files[part];
		}
		parent.files[parts.at(-1)] = {size:contents.length, offset:String(offset), integrity:integrity(contents)};
		offset += contents.length;
	}
	mutateHeader(header);
	let json = Buffer.from(JSON.stringify(header));
	let headerSize = Math.ceil((json.length + 8) / 4) * 4;
	let preamble = Buffer.alloc(8 + headerSize);
	preamble.writeUInt32LE(4, 0);
	preamble.writeUInt32LE(headerSize, 4);
	preamble.writeUInt32LE(headerSize - 4, 8);
	preamble.writeUInt32LE(json.length, 12);
	json.copy(preamble, 16);
	return Buffer.concat([preamble, ...files.map(([, contents]) => contents)]);
}

function withArchive(contents, callback)
{
	let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'message-visibility-test-'));
	let archive = path.join(directory, 'app.asar');
	try
	{
		fs.writeFileSync(archive, contents, {mode:0o640});
		fs.chmodSync(archive, 0o640);
		return callback(archive, directory);
	}
	finally
	{
		fs.rmSync(directory, {recursive:true, force:true});
	}
}

test('authored messages remain persistent while original tool decisions are preserved', () =>
{
	let source = renderer();
	let original = Buffer.from(source);
	let patched = patchBundle(source);
	assert.deepEqual(source, original);
	assert.equal(patched.length, source.length);
	assert.equal(inspectBundle(patched)[0].mode, 'messages');
	let select = new Function('dynamic', 'mcp', `${patched.toString()}\nreturn keepUnit;`)(() => true, () => true);
	let run = (item, options = {}) => select({unit:{kind:'standalone', item:{item}}, ...options});
	assert.equal(run({type:'assistant-message'}), true);
	assert.equal(run({type:'user-message'}), true);
	assert.equal(run({type:'dynamic-tool-call'}), true);
	assert.equal(run({type:'mcp-tool-call'}, {keepMcpAppEntriesPersistent:true, renderMcpApps:true}), true);
	assert.equal(run({type:'mcp-tool-call'}), false);
	assert.equal(run({type:'ordinary-tool'}), false);
	assert.equal(select({unit:{kind:'group'}}), false);
});

test('function examples in strings and comments are not executable candidates', () =>
{
	let decoys = `const example = ${JSON.stringify(classifier('stringExample'))};\n/* ${classifier('commentExample')} */\n`;
	assert.deepEqual(inspectBundle(Buffer.from(decoys)), []);
	let source = Buffer.from(decoys + classifier());
	let patched = patchBundle(source);
	assert.equal(inspectBundle(source).length, 1);
	assert.equal(inspectBundle(patched).length, 1);
	assert.equal(patched.subarray(0, Buffer.byteLength(decoys)).toString(), decoys);
});

test('ambiguous executable classifiers and unsupported structures fail without changing input', () =>
{
	let ambiguous = Buffer.from(classifier('first') + '\n' + classifier('second'));
	let unchanged = Buffer.from(ambiguous);
	assert.throws(() => patchBundle(ambiguous), /ambiguous/i);
	assert.deepEqual(ambiguous, unchanged);
	assert.throws(() => patchBundle(Buffer.from('export const unrelated = 1;')), /unsupported/i);
});

test('archive patch refreshes every renderer integrity block and preserves unrelated bytes and offsets', () =>
{
	let original = archiveFixture();
	let unchanged = Buffer.from(original);
	let before = readArchive(original);
	let patched = patchArchive(original);
	let after = readArchive(patched);
	let target = inspectArchive(patched);
	assert.deepEqual(original, unchanged);
	assert.equal(patched.length, original.length);
	assert.equal(after.dataStart, before.dataStart);
	assert.equal(target.mode, 'messages');
	assert.deepEqual(target.entry.integrity, integrity(target.source));
	assert.ok(target.entry.integrity.blocks.length > 1);
	for (let file of before.files)
	{
		let result = after.files.find(candidate => candidate.asset === file.asset);
		assert.equal(result.start, file.start);
		assert.equal(result.entry.size, file.entry.size);
		if (file.asset !== target.asset)
		{
			assert.deepEqual(result.source, file.source);
			assert.deepEqual(result.entry, file.entry);
		}
	}
	assert.deepEqual(patched.subarray(0, 16), original.subarray(0, 16));
	assert.deepEqual(patched.subarray(16 + before.headerLength, before.dataStart), original.subarray(16 + before.headerLength, before.dataStart));
});

test('corrupt renderer hash or integrity blocks are refused before patching', () =>
{
	for (let field of ['hash', 'blocks'])
	{
		let original = archiveFixture(renderer(), header =>
		{
			let entry = header.files.webview.files.assets.files['renamed-fixture.mjs'];
			if (field === 'hash') entry.integrity.hash = '0'.repeat(64);
			else entry.integrity.blocks[0] = '0'.repeat(64);
		});
		let unchanged = Buffer.from(original);
		assert.throws(() => patchArchive(original), /integrity/i);
		assert.deepEqual(original, unchanged);
	}
});

test('overlapping ASAR files are refused', () =>
{
	let original = archiveFixture(renderer(), header =>
	{
		let entries = header.files.webview.files.assets.files;
		entries['unrelated.js'].offset = entries['renamed-fixture.mjs'].offset;
	});
	assert.throws(() => patchArchive(original), /overlap/i);
});

test('ambiguous archive assets are refused', () =>
{
	let original = archiveFixture(renderer(), header =>
	{
		let entries = header.files.webview.files.assets.files;
		entries['second-renderer.js'] = structuredClone(entries['renamed-fixture.mjs']);
	});
	assert.throws(() => patchArchive(original), /ambiguous/i);
});

test('apply, repeated apply, restore and repeated restore preserve exact original bytes and permissions', () =>
{
	let original = archiveFixture();
	withArchive(original, (archive, directory) =>
	{
		let first = operate('--apply', archive, 'synthetic-build', 'messages');
		let patched = fs.readFileSync(archive);
		assert.equal(first.mode, 'messages');
		assert.deepEqual(fs.readFileSync(first.backup), original);
		assert.equal(fs.statSync(archive).mode & 0o777, 0o640);
		assert.equal(fs.statSync(first.backup).mode & 0o777, 0o640);
		assert.equal(operate('--check', archive).mode, 'messages');
		operate('--apply', archive, 'synthetic-build', 'messages');
		assert.deepEqual(fs.readFileSync(archive), patched);
		assert.equal(fs.readdirSync(directory).filter(name => name.endsWith('.bak')).length, 1);
		assert.equal(operate('--restore', archive).mode, 'original');
		assert.deepEqual(fs.readFileSync(archive), original);
		operate('--restore', archive);
		assert.deepEqual(fs.readFileSync(archive), original);
		assert.equal(fs.statSync(archive).mode & 0o777, 0o640);
	});
});

test('restore refuses an unrelated backup and retains all current archive bytes', () =>
{
	let original = archiveFixture();
	withArchive(original, archive =>
	{
		let applied = operate('--apply', archive);
		let current = fs.readFileSync(archive);
		let damagedBackup = Buffer.from(original);
		damagedBackup[damagedBackup.length - 1] ^= 1;
		fs.writeFileSync(applied.backup, damagedBackup);
		assert.throws(() => operate('--restore', archive), /exact original backup/i);
		assert.deepEqual(fs.readFileSync(archive), current);
	});
});

test('backup conflicts and unsupported all mode leave the archive untouched', () =>
{
	let original = archiveFixture();
	withArchive(original, (archive, directory) =>
	{
		assert.throws(() => operate('--apply', archive, 'fixture', 'all'), /original|unsupported/i);
		assert.deepEqual(fs.readFileSync(archive), original);
		assert.deepEqual(fs.readdirSync(directory), ['app.asar']);
		let backup = backupPath(archive, 'fixture', original);
		fs.writeFileSync(backup, Buffer.alloc(original.length));
		assert.throws(() => operate('--apply', archive, 'fixture'), /backup conflict/i);
		assert.deepEqual(fs.readFileSync(archive), original);
	});
});

test('all mode reapplication and switching modes restore the exact original archive', () =>
{
	let original = archiveFixture(allModeRenderer());
	withArchive(original, (archive, directory) =>
	{
		assert.equal(operate('--check', archive).allSupported, true);
		operate('--apply', archive, 'synthetic-build', 'all');
		let expanded = fs.readFileSync(archive);
		assert.equal(inspectArchive(expanded).mode, 'all');
		let expandedFiles = readArchive(expanded).files;
		for (let file of readArchive(original).files)
		{
			let result = expandedFiles.find(candidate => candidate.asset === file.asset);
			assert.equal(result.entry.size, result.source.length);
			assert.deepEqual(result.entry.integrity, integrity(result.source));
			if (!file.asset.endsWith('/renamed-fixture.mjs'))
				assert.deepEqual(result.source, file.source);
		}
		operate('--apply', archive, 'synthetic-build', 'all');
		assert.deepEqual(fs.readFileSync(archive), expanded);
		operate('--apply', archive, 'synthetic-build', 'messages');
		assert.deepEqual(fs.readFileSync(archive), patchArchive(original, 'messages'));
		operate('--apply', archive, 'synthetic-build', 'all');
		assert.deepEqual(fs.readFileSync(archive), expanded);
		assert.equal(fs.readdirSync(directory).filter(name => name.endsWith('.bak')).length, 1);
		operate('--restore', archive);
		assert.deepEqual(fs.readFileSync(archive), original);
	});
});

test('all mode renders full turn and group content even when their saved state is collapsed', () =>
{
	let items = [
		{type:'assistant-message', text:'commentary'},
		{type:'ordinary-tool', text:'tool'},
		{type:'assistant-message', text:'earlier-final'},
		{type:'user-message', text:'follow-up'},
	];
	let expandedUnits = items.map(item => ({kind:'standalone', item:{item}}));
	function components(source, collapsed = true)
	{
		return new Function('jsxRuntime', 'Motion', 'Fragment', 'Summary', 'Entries',
			'makeUnits', 'collapseState', 'partitionUnits', 'animationState',
			`${source.toString()}\nreturn {turnView,groupView};`)(
			{jsx:(type, props) => ({type, props})}, {div:'motion-div'}, 'fragment', 'summary', 'entries',
			() => expandedUnits, () => ({isCollapsed:collapsed}),
			() => ({expandedUnits, collapsibleUnits:[expandedUnits[1]], persistentUnits:[expandedUnits[0]]}),
			() => 'collapsed');
	}
	function entryNode(tree)
	{
		if (tree == null || typeof tree !== 'object') return null;
		if (Array.isArray(tree)) return tree.map(entryNode).find(Boolean) ?? null;
		if (tree.type === 'entries') return tree;
		return entryNode(tree.props?.children);
	}
	let before = components(allModeRenderer());
	let patched = patchBundle(allModeRenderer(), 'all');
	let after = components(patched);
	let props = {
		agentActivityProps:{wrapSearchableContent:entry => entry.content},
		hasFinalAssistantStarted:true,
		persistedCollapsed:true,
		// Same-named outer input must never replace the block's cached hidden units.
		parts:{collapsibleUnits:[]},
	};
	assert.equal(entryNode(before.turnView(props)), null);
	let visible = entryNode(after.turnView(props));
	assert.deepEqual(visible.props.units, expandedUnits);
	let dimmedTool = visible.props.wrapSearchableContent({item:items[1], content:'tool content'});
	let persistentMessage = visible.props.wrapSearchableContent({item:items[0], content:'commentary content'});
	assert.equal(dimmedTool.props.style.opacity, 0.9);
	assert.equal(persistentMessage.props.style.opacity, 1);
	let expanded = entryNode(components(patched, false).turnView(props));
	assert.equal(expanded.props.wrapSearchableContent({item:items[1], content:'tool content'}).props.style.opacity, 1);
	assert.equal(before.groupView({canExpand:true, children:'group content'}), null);
	let calls = 0;
	let group = after.groupView({canExpand:true, children:() => { calls += 1; return 'group content'; }});
	assert.equal(group.props.children, 'group content');
	assert.equal(calls, 1);
	assert.notEqual(group.props.style?.pointerEvents, 'none');
});

test('all-mode source and marker examples in strings or comments are ignored', () =>
{
	let original = allModeRenderer();
	let patched = patchBundle(original, 'all');
	let examples = Buffer.from(`const priorExample = ${JSON.stringify(patched.toString())};\n/* ${original.toString()} */\n`);
	assert.equal(inspectExpandedRenderer(examples).status, 'unsupported');
	let combined = Buffer.concat([examples, original]);
	assert.equal(inspectExpandedRenderer(combined).status, 'original');
	let result = patchBundle(combined, 'all');
	assert.equal(inspectExpandedRenderer(result).status, 'patched');
	assert.deepEqual(result.subarray(0, examples.length), examples);
});

test('duplicate or changed all-mode roles are refused instead of guessing', () =>
{
	let original = allModeRenderer().toString();
	let group = original.slice(original.indexOf('function groupView')).replace('function groupView', 'function secondGroup');
	let ambiguous = Buffer.from(original + group);
	assert.equal(inspectExpandedRenderer(ambiguous).status, 'unsupported');
	assert.throws(() => patchBundle(ambiguous, 'all'), /original|unsupported/i);
	let changed = Buffer.from(original.replace('animate:{height:"auto",opacity:1}', 'animate:{height:"unset",opacity:1}'));
	assert.notEqual(changed.toString(), original);
	assert.equal(inspectExpandedRenderer(changed).status, 'unsupported');
	assert.throws(() => patchBundle(changed, 'all'), /original|unsupported/i);
});

test('partial all-mode patches, changed helper and altered marked gates are refused', () =>
{
	let patched = patchBundle(allModeRenderer(), 'all').toString();
	let mutations = [
		patched.replace('"chatgpt-message-visibility:all:group:2";', ''),
		patched.replace('"message-visibility:persistent"', '"missing-marker"'),
		patched.replace('c&&s.has(e.item)', 'c||s.has(e.item)'),
		patched.replace('("message-visibility:body",body != null)', '("message-visibility:body",false)'),
		patched.replace('("message-visibility:units",parts.expandedUnits)', '("message-visibility:units",parts.collapsibleUnits)'),
		patched.replace('("message-visibility:group-body",true)', '("message-visibility:group-body",false)'),
	];
	for (let mutation of mutations)
	{
		assert.notEqual(mutation, patched, 'mutation must change the synthetic output');
		assert.throws(() => inspectExpandedRenderer(Buffer.from(mutation)), /modified|incomplete|partial/i);
	}
});
