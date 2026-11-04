import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeHeight, validateHtml, escapeHtml, MAX_BYTES, readHtml, assetUrl } from '../src/main.js';

test('viewport sizes are bounded, rounded and cannot become CSS injection', () => {
  assert.equal(normalizeHeight('680'), 680);
  assert.equal(normalizeHeight(-50), 240);
  assert.equal(normalizeHeight(20000), 2000);
  assert.equal(normalizeHeight(500.9), 501);
  assert.equal(normalizeHeight('1px; display:none'), 680);
  assert.equal(normalizeHeight(Infinity), 680);
});
test('reject empty, binary and oversized UTF-8 payloads', () => {
  assert.throws(() => validateHtml('  '));
  assert.throws(() => validateHtml('x\0y'));
  assert.throws(() => validateHtml('汉'.repeat(Math.ceil(MAX_BYTES / 3))));
  assert.equal(validateHtml('<p>储能</p>'), '<p>储能</p>');
});
test('escape HTML attributes and markup', () => {
  assert.equal(escapeHtml('<img x="a&b">'), '&lt;img x=&quot;a&amp;b&quot;&gt;');
});
test('Orca asset paths resolve against the repository assets directory', () => {
  assert.equal(assetUrl('./text-123.html', 'D:\\orca\\repos\\abc'), 'file:///D:/orca/repos/abc/assets/text-123.html');
  assert.equal(assetUrl('text-123.html', 'D:/orca/repos/abc'), 'file:///D:/orca/repos/abc/assets/text-123.html');
  assert.equal(assetUrl('D:\\资料\\图 #1%.html'), 'file:///D:/%E8%B5%84%E6%96%99/%E5%9B%BE%20%231%25.html');
  assert.equal(assetUrl('https://example.org/report.html'), 'https://example.org/report.html');
  assert.equal(assetUrl('file:///D:/report.html'), 'file:///D:/report.html');
  assert.equal(assetUrl('\\\\server\\share\\report.html'), 'file://server/share/report.html');
  assert.throws(()=>assetUrl('../other.html','D:/repo'));
});
test('read saved inline content without file or network dependency', async () => {
  assert.equal(await readHtml({html:'<p>persistent</p>'}), '<p>persistent</p>');
});
test('asset read shares concurrent fetches and errors remain retryable', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.orca = {utils:{getAssetPath:x=>x}};
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('<p>图表</p>'); };
  try {
    const result = await Promise.all([readHtml({src:'asset://test'}), readHtml({src:'asset://test'})]);
    assert.deepEqual(result, ['<p>图表</p>','<p>图表</p>']);
    assert.equal(calls, 1);
    globalThis.fetch = async () => new Response('', {status:404});
    await assert.rejects(readHtml({src:'asset://missing'}), /404/);
    globalThis.fetch = async () => new Response('<p>restored</p>');
    assert.equal(await readHtml({src:'asset://missing'}), '<p>restored</p>');
    globalThis.fetch = async () => new Response(Uint8Array.of(0xff,0xff));
    await assert.rejects(readHtml({src:'asset://invalid-utf8'}));
  } finally { globalThis.fetch = previousFetch; delete globalThis.orca; }
});
test('derived previews may exceed 5 MB without relaxing original HTML limits', async () => {
  const original = `<p>${'x'.repeat(MAX_BYTES - 7)}</p>`;
  const preview = `${original}<!-- generated preview bridge -->`;
  assert.equal(validateHtml(original), original);
  assert.throws(() => validateHtml(preview), /5 MB/);
  await assert.rejects(readHtml({html: preview}, {preview: true}), /5 MB/);

  const previousFetch = globalThis.fetch;
  const previousOrca = globalThis.orca;
  globalThis.orca = {utils: {getAssetPath: x => x}};
  globalThis.fetch = async url => new Response(url.endsWith('/original') ? original : preview);
  try {
    assert.equal(await readHtml({src: 'asset://size-limit/original'}), original);
    // Both call orders must keep a concurrent preview read from changing source validation.
    for (const previewFirst of [true, false]) {
      const repr = {src: `asset://size-limit/derived-${previewFirst}`};
      const modes = previewFirst ? [true, false] : [false, true];
      const results = await Promise.allSettled(modes.map(mode => readHtml(repr, {preview: mode})));
      const previewResult = results[modes.indexOf(true)];
      const originalResult = results[modes.indexOf(false)];
      assert.equal(previewResult.status, 'fulfilled');
      assert.equal(previewResult.value, preview);
      assert.equal(originalResult.status, 'rejected');
      assert.match(originalResult.reason.message, /5 MB/);
    }
  } finally {
    globalThis.fetch = previousFetch;
    if (previousOrca === undefined) delete globalThis.orca;
    else globalThis.orca = previousOrca;
  }
});
test('release entry equals reviewed source', async () => {
  assert.deepEqual(await readFile(new URL('../dist/index.js', import.meta.url)), await readFile(new URL('../src/main.js', import.meta.url)));
});
