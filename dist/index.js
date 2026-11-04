/** Orca HTML Embed — standalone ES module, using only documented Orca APIs. */
export const TYPE = 'orca-html-embed.html';
export const MAX_BYTES = 5 * 1024 * 1024;
// DOM serialization may expand escaped attributes; derived previews also include our bridge.
const MAX_PREVIEW_BYTES = MAX_BYTES * 6 + 65536;
let pluginName;
let active = false;
let generation = 0;
const disposers = [];
const dialogs = new Set();
const pendingReads = new Map();
const readControllers = new Set();

export function normalizeHeight(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(240, Math.min(2000, Math.round(number))) : 680;
}

export function validateHtml(html, maxBytes = MAX_BYTES) {
  if (typeof html !== 'string' || !html.trim()) throw new Error('请导入 HTML 文件或粘贴 HTML 内容。');
  if (new TextEncoder().encode(html).length > maxBytes) throw new Error(maxBytes === MAX_BYTES ? 'HTML 超过 5 MB，请先缩小文件。' : 'HTML 预览资源过大。');
  if (html.includes('\u0000')) throw new Error('文件含有二进制内容，请选择 UTF-8 编码的 HTML。');
  return html;
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/** Build a new document so CSP precedes every user-controlled element. Never insert source into host DOM. */
export function buildSrcDoc(html, { scripts = true, network = false } = {}, channel = '') {
  const doc = new DOMParser().parseFromString(validateHtml(html), 'text/html');
  doc.querySelectorAll('base, meta[http-equiv]').forEach(el => el.remove());
  const remote = network ? ' https: http:' : '';
  const csp = [
    "default-src 'none'",
    `script-src ${scripts ? "'unsafe-inline' 'unsafe-eval' data: blob:" + remote : "'none'"}`,
    `style-src 'unsafe-inline' data:${remote}`,
    `img-src data: blob:${remote}`, `font-src data: blob:${remote}`,
    `media-src data: blob:${remote}`, `connect-src ${network ? 'https: http:' : "'none'"}`,
    "object-src 'none'", "frame-src 'none'", "base-uri 'none'", "form-action 'none'",
  ].join('; ');
  const bridge = scripts ? `<script>(${frameBridge.toString()})(${JSON.stringify(channel).replace(/</g, '\\u003c')})<\/script>` : '';
  const attrs = element => Array.from(element.attributes)
    .map(a => ` ${a.name}="${escapeHtml(a.value)}"`).join('');
  return `<!doctype html><html${attrs(doc.documentElement)}><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">${bridge}${doc.head.innerHTML}</head><body${attrs(doc.body)}>${doc.body.innerHTML}</body></html>`;
}

function frameBridge(channel) {
  const send = data => parent.postMessage({ source: 'orca-html-embed', channel, ...data }, '*');
  let scheduled = false;
  const measure = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const body = document.body;
      if (!body) return;
      const bounds = body.getBoundingClientRect();
      const height = Math.ceil(Math.max(body.scrollHeight, bounds.height) + Math.max(0, bounds.top) + 16);
      send({ kind: 'height', height });
    });
  };
  addEventListener('DOMContentLoaded', () => {
    new ResizeObserver(measure).observe(document.body);
    new MutationObserver(measure).observe(document.body, { childList: true, subtree: true, attributes: true });
    measure();
  });
  addEventListener('load', measure);
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[href]');
    if (!link) return;
    const href = link.getAttribute('href');
    if (href?.startsWith('#')) return;
    event.preventDefault();
    send({ kind: 'link' });
  }, true);
}

function currentRepr(id) {
  return orca.state.blocks[id]?.properties?.find(p => p.name === '_repr')?.value;
}

function writeContext(panelId, rootViewStateId) {
  const panel = orca.nav.findViewPanel(panelId, orca.state.panels);
  return { repo: orca.state.repo, panelId, rootViewStateId, viewKey: JSON.stringify([panel?.view, panel?.viewArgs]) };
}

function assertWritable(context) {
  if (!active) throw new Error('插件已停用。');
  if (!context || context.repo !== orca.state.repo) throw new Error('笔记库已切换，请重新打开编辑器。');
  const panel = orca.nav.findViewPanel(context.panelId, orca.state.panels);
  if (JSON.stringify([panel?.view, panel?.viewArgs]) !== context.viewKey) throw new Error('原面板已切换页面，请重新打开编辑器。');
  const editor = panel?.viewState?.[context.rootViewStateId];
  if (!editor) throw new Error('原编辑面板已关闭，请重新打开编辑器。');
  if (editor.readOnly) throw new Error('当前笔记处于只读模式。');
  return panel;
}

function invokeWrite(context, command, ...args) {
  assertWritable(context);
  orca.nav.switchFocusTo(context.panelId);
  return orca.commands.invokeEditorCommand(command, null, ...args);
}

async function updateRepr(id, patch, context) {
  assertWritable(context);
  const repr = currentRepr(id);
  if (!repr || repr.type !== TYPE) throw new Error('该 HTML 块已删除或类型已改变。');
  await invokeWrite(context, 'core.editor.setProperties', [id], [
    { name: '_repr', type: 0, value: { ...repr, ...patch } },
  ]);
}

export function assetUrl(source, repoDir) {
  const value = String(source).replaceAll('\\', '/');
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:\//i.test(value)) return value;
  let absolute = value;
  if (!/^(?:[a-z]:\/|\/)/i.test(value)) {
    if (!repoDir) throw new Error('无法确定当前笔记库的资源目录。');
    const relative = value.replace(/^\.\//, '');
    if (relative.split('/').includes('..')) throw new Error('HTML 资源路径超出了资源目录。');
    absolute = `${String(repoDir).replaceAll('\\', '/').replace(/\/$/, '')}/assets/${relative}`;
  }
  const encoded = absolute.split('/').map((part, i) => i === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part)).join('/');
  return absolute.startsWith('//') ? `file:${encoded}` : `file://${absolute.startsWith('/') ? '' : '/'}${encoded}`;
}

export async function readHtml(repr, { preview = false } = {}) {
  if (typeof repr.html === 'string') return validateHtml(repr.html); // portable inline fallback
  if (!repr.src) throw new Error('HTML 内容尚未导入。');
  const repoDir = orca.state?.repoDir || (orca.state?.dataDir && orca.state?.repo ? `${orca.state.dataDir}/repos/${orca.state.repo}` : undefined);
  const url = assetUrl(orca.utils.getAssetPath(repr.src), repoDir);
  const maxBytes = preview ? MAX_PREVIEW_BYTES : MAX_BYTES;
  const key = `${maxBytes}:${url}`;
  // Share only concurrent reads; never retain large HTML strings for the lifetime of the plugin.
  if (!pendingReads.has(key)) {
    const job = (async () => {
      const controller = new AbortController();
      readControllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`读取 HTML 资源失败（${response.status}）。`);
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > maxBytes) throw new Error(preview ? 'HTML 预览资源过大。' : 'HTML 资源超过 5 MB。');
        return validateHtml(new TextDecoder('utf-8', { fatal: true }).decode(bytes), maxBytes);
      } finally { clearTimeout(timeout); readControllers.delete(controller); }
    })();
    pendingReads.set(key, job);
    job.finally(() => { if (pendingReads.get(key) === job) pendingReads.delete(key); }).catch(() => {});
  }
  return pendingReads.get(key);
}

async function storeHtml(html) {
  const token = generation;
  validateHtml(html);
  const bytes = new TextEncoder().encode(html);
  try {
    const src = await orca.invokeBackend('upload-asset-binary', 'text/html', bytes.buffer);
    if (typeof src !== 'string' || !src) throw new Error('资源上传未返回路径。');
    const readback = await readHtml({ src });
    if (readback !== html) throw new Error('HTML 资源回读与原文不一致。');
    return { src, html: undefined };
  } catch (error) {
    if (!active || token !== generation) throw new Error('插件已停用，未保存内容。');
    // Host builds differ in their HTML asset scheme support. Keep content durable in the block.
    console.warn('[orca-html-embed] Asset storage unavailable; using block content.', error);
    orca.notify('warn', '当前版本无法回读 HTML 资源，已改为保存在块内，内容仍可随笔记保存。');
    return { src: undefined, html };
  }
}

async function prepareContent(values, previous, previousHtml) {
  const sameHtml = values.html === previousHtml;
  const original = sameHtml && previous?.src ? { src: previous.src, html: undefined } : await storeHtml(values.html);
  if (sameHtml && previous?.previewSrc && previous.previewVersion === 1 &&
      (previous.scripts !== false) === values.scripts && (previous.network === true) === values.network) {
    try {
      await readHtml({ src: previous.previewSrc }, { preview: true });
      return { ...original, previewSrc: previous.previewSrc, previewChannel: previous.previewChannel, previewVersion: 1 };
    } catch { /* Recreate a missing preview from the still-readable original. */ }
  }
  const previewChannel = crypto.randomUUID();
  const previewHtml = buildSrcDoc(values.html, values, previewChannel);
  try {
    const previewSrc = await orca.invokeBackend('upload-asset-binary', 'text/html', new TextEncoder().encode(previewHtml).buffer);
    if (typeof previewSrc !== 'string' || await readHtml({ src: previewSrc }, { preview: true }) !== previewHtml) throw new Error('预览资源回读校验失败。');
    return { ...original, previewSrc, previewChannel, previewVersion: 1 };
  } catch (error) {
    console.warn('[orca-html-embed] Compatible preview unavailable.', error);
    return { ...original, previewSrc: undefined, previewChannel: undefined, previewVersion: undefined };
  }
}

function report(error) {
  orca.notify('error', error instanceof Error ? error.message : String(error));
}

function run(task) { Promise.resolve().then(task).catch(report); }

function element(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

/** The editor owns no note mutations until the user presses Save. */
function showEditor(initial, onSave) {
  const token = generation;
  const dialog = element('dialog', { className: 'ohe-dialog', 'aria-label': 'HTML 嵌入编辑器' });
  const title = element('input', { type: 'text', value: initial.title || '', placeholder: '例如：课程权重对照矩阵', maxLength: 200 });
  const file = element('input', { type: 'file', accept: '.html,.htm,text/html', 'aria-label': '选择 HTML 文件' });
  const source = element('textarea', { value: initial.html || '', spellcheck: false, placeholder: '<!doctype html>\n<html>…</html>', 'aria-label': 'HTML 源码' });
  const height = element('input', { type: 'number', min: 240, max: 2000, step: 20, value: normalizeHeight(initial.height) });
  const scripts = element('input', { type: 'checkbox', checked: initial.scripts !== false });
  const network = element('input', { type: 'checkbox', checked: initial.network === true });
  const status = element('p', { className: 'ohe-status', role: 'status' });
  const save = element('button', { type: 'submit', text: '保存 HTML 嵌入' });
  const cancel = element('button', { type: 'button', text: '取消' });
  const label = (text, field) => element('label', { className: 'ohe-field' }, [element('span', { text }), field]);
  let saving = false;
  let reading = false;
  let fileSequence = 0;
  let alive = true;
  const close = () => { alive = false; dialogs.delete(dialog); dialog.close(); dialog.remove(); };
  cancel.onclick = () => { if (!saving) close(); };
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!saving) close(); });
  file.addEventListener('change', async () => {
    const selected = file.files?.[0];
    if (!selected) return;
    const seq = ++fileSequence;
    reading = true; save.disabled = true; status.textContent = '正在读取文件…';
    try {
      if (!/\.html?$/i.test(selected.name)) throw new Error('请选择 .html 或 .htm 文件。');
      if (selected.size > MAX_BYTES) throw new Error('文件超过 5 MB，请先缩小文件。');
      const html = new TextDecoder('utf-8', { fatal: true }).decode(await selected.arrayBuffer());
      validateHtml(html);
      if (!alive || seq !== fileSequence) return;
      source.value = html;
      title.value = selected.name.replace(/\.html?$/i, '');
      status.textContent = `已读取 ${selected.name}（${Math.ceil(selected.size / 1024)} KB）`;
    } catch (error) {
      if (alive && seq === fileSequence) status.textContent = error instanceof TypeError ? '文件不是有效的 UTF-8 编码，请转换后重试。' : error.message;
    } finally {
      if (alive && seq === fileSequence) { reading = false; save.disabled = false; }
    }
  });
  const form = element('form', {}, [
    element('h2', { text: initial.html ? '编辑 HTML 嵌入' : '嵌入 HTML' }),
    element('p', { text: '导入单个 HTML 文件，或粘贴源码。图片、样式和图表库请内嵌在文件中。' }),
    label('选择文件', file), label('标题', title), label('HTML 源码', source),
    element('div', { className: 'ohe-options' }, [label('显示高度（像素）', height), label('启用交互脚本', scripts), label('允许联网资源', network)]),
    element('p', { className: 'ohe-hint', text: '默认离线显示；相对路径资源不会随文件导入。脚本在隔离区域运行。' }),
    status, element('div', { className: 'ohe-actions' }, [cancel, save]),
  ]);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || reading) return;
    try {
      validateHtml(source.value);
      if (!active || generation !== token) throw new Error('插件已重新加载，请重新打开编辑器。');
      saving = true; save.disabled = true; cancel.disabled = true; status.textContent = '正在保存…';
      const values = { title: title.value.trim() || 'HTML 内容', html: source.value, height: normalizeHeight(height.value), scripts: scripts.checked, network: network.checked };
      await onSave(values, token);
      if (alive) close();
    } catch (error) {
      if (alive) { status.textContent = error.message; saving = false; save.disabled = false; cancel.disabled = false; }
    }
  });
  dialog.append(form); document.body.append(dialog); dialogs.add(dialog); dialog.showModal();
  file.focus();
}

function getAnchor(cursor) {
  const selection = cursor || orca.utils.getCursorDataFromSelection(window.getSelection());
  const id = selection?.anchor?.blockId;
  if (id == null || !orca.state.blocks[id]) throw new Error('请先在笔记中点击一个文字块，再插入 HTML。');
  return id;
}

function insertEditor(cursor, context) {
  assertWritable(context);
  const anchorId = getAnchor(cursor);
  showEditor({}, async (values, token) => {
    assertWritable(context);
    const content = await prepareContent(values);
    if (!active || token !== generation) throw new Error('插件已停用，未插入内容。');
    const anchor = orca.state.blocks[anchorId];
    if (!anchor) throw new Error('插入位置已不存在，请重新选择文字块。');
    const repr = { type: TYPE, ...values, ...content };
    const id = await invokeWrite(context, 'core.editor.insertBlock', anchor, 'after', [{ t: 't', v: values.title }], repr);
    if (id == null) throw new Error('未能插入 HTML 块，请重新选择笔记中的文字块。');
  });
}

async function editBlock(id, repr, context) {
  assertWritable(context);
  const startGeneration = generation;
  let html;
  try { html = await readHtml(repr); }
  catch { html = ''; }
  if (!active || startGeneration !== generation) return;
  assertWritable(context);
  if (!html) orca.notify('warn', '原 HTML 资源无法读取。可在编辑器中重新导入，取消将保留原块。');
  showEditor({ ...repr, html }, async (values, token) => {
    assertWritable(context);
    const content = await prepareContent(values, repr, html);
    if (!active || token !== generation) throw new Error('插件已停用，未修改内容。');
    assertWritable(context);
    orca.nav.switchFocusTo(context.panelId);
    await orca.commands.invokeGroup(async () => {
      await updateRepr(id, { ...values, ...content }, context);
      await invokeWrite(context, 'core.editor.setBlocksContent', [{ id, content: [{ t: 't', v: values.title }] }], false);
    }, { topGroup: true });
  });
}

function downloadHtml(html, title) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = element('a', { href: url, download: `${(title || 'HTML 内容').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')}.html` });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function HtmlBlock(props) {
  const React = window.React;
  const { createElement: h, useState, useEffect, useRef, useMemo } = React;
  const snapshot = window.Valtio.useSnapshot(orca.state);
  const editorContext = window.Valtio.useSnapshot(React.useContext(orca.contexts.BlockEditorContext));
  const context = writeContext(props.panelId, editorContext?.rootViewStateId);
  const panelSnapshot = orca.nav.findViewPanel(props.panelId, snapshot.panels);
  const editorSnapshot = panelSnapshot?.viewState?.[editorContext?.rootViewStateId];
  const writable = active && snapshot.repo === context.repo && editorSnapshot != null && !editorSnapshot.readOnly;
  const id = props.mirrorId ?? props.blockId;
  const repr = snapshot.blocks[id]?.properties?.find(p => p.name === '_repr')?.value || props;
  const [html, setHtml] = useState(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [measured, setMeasured] = useState(null);
  const frame = useRef(null);
  const surface = useRef(null);
  const channel = useMemo(() => repr.previewChannel || crypto.randomUUID(), [revision, repr.previewChannel, repr.src, repr.html, repr.scripts, repr.network]);
  useEffect(() => {
    let live = true;
    setHtml(null); setError(''); setMeasured(null);
    readHtml(repr).then(value => { if (live) setHtml(value); }, e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [repr.src, repr.html, revision]);
  useEffect(() => {
    setMeasured(null);
    const receive = event => {
      if (event.source !== frame.current?.contentWindow || event.data?.source !== 'orca-html-embed' || event.data?.channel !== channel) return;
      if (event.data.kind === 'height' && Number.isFinite(event.data.height)) setMeasured(normalizeHeight(event.data.height));
      if (event.data.kind === 'link') orca.notify('info', '如需打开资料来源链接，请先导出 HTML，再用浏览器打开。');
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [channel, revision]);
  useEffect(() => {
    if (!expanded) return;
    // Top-layer placement avoids the editor's containing blocks and clipping.
    const node = surface.current;
    node.showPopover();
    const escape = event => { if (event.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('keydown', escape); if (node.matches(':popover-open')) node.hidePopover(); };
  }, [expanded]);
  const documentHtml = useMemo(() => html == null ? '' : buildSrcDoc(html, { scripts: repr.scripts !== false, network: repr.network === true }, channel), [html, repr.scripts, repr.network, channel]);
  const repoDir = orca.state.repoDir || `${orca.state.dataDir}/repos/${orca.state.repo}`;
  const previewUrl = repr.previewSrc ? assetUrl(orca.utils.getAssetPath(repr.previewSrc), repoDir) : undefined;
  const button = (text, task, disabled = false) => h('button', { type: 'button', disabled, onClick: event => { event.stopPropagation(); run(task); } }, text);
  const content = h('section', { ref: surface, popover: expanded ? 'manual' : undefined, className: `ohe-block${expanded ? ' ohe-expanded' : ''}`, 'aria-label': repr.title || 'HTML 嵌入', contentEditable: false, onPointerDown: e => e.stopPropagation() },
    h('header', { className: 'ohe-bar' },
      h('strong', { className: 'ohe-title', title: repr.title }, repr.title || 'HTML 内容'),
      h('span', { className: 'ohe-mode' }, repr.network ? '允许联网' : '离线'),
      button('编辑', () => editBlock(id, repr, context), !writable),
      button('重载', () => setRevision(v => v + 1)),
      button('适应内容', () => updateRepr(id, { height: measured }, context), !writable || repr.scripts === false || measured == null || expanded),
      button(expanded ? '收起' : '展开', () => setExpanded(v => !v)),
      button('导出', () => downloadHtml(html, repr.title), html == null),
    ),
    !previewUrl && repr.scripts !== false ? h('p', { className: 'ohe-preview-note' }, '交互预览尚未生成，请点击“编辑”重新保存。') : null,
    error ? h('div', { className: 'ohe-error', role: 'alert' }, error, ' 请点击编辑重新导入文件，或重载重试。') : html == null ? h('p', { className: 'ohe-loading' }, '正在加载 HTML…') :
      h('iframe', { key: `${channel}:${revision}`, ref: frame, className: 'ohe-frame', title: repr.title || 'HTML 内容', src: previewUrl, srcDoc: previewUrl ? undefined : documentHtml,
        sandbox: repr.scripts === false ? '' : 'allow-scripts', referrerPolicy: 'no-referrer',
        allow: "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'",
        style: { height: expanded ? 'calc(100vh - 110px)' : `${normalizeHeight(repr.height)}px` } }),
  );
  const shell = {};
  for (const key of ['panelId','blockId','rndId','blockLevel','indentLevel','mirrorId','initiallyCollapsed','renderingMode']) shell[key] = props[key];
  return h(orca.components.BlockShell, { ...shell, reprClassName: 'ohe-shell', contentClassName: 'ohe-content', contentAttrs: { contentEditable: false }, contentJsx: content,
    childrenJsx: h(orca.components.BlockChildren, { blockId: props.blockId, panelId: props.panelId, blockLevel: props.blockLevel, indentLevel: props.indentLevel, renderingMode: props.renderingMode }) });
}

const CSS = `
.ohe-block{border:1px solid var(--orca-color-border,#d2d7e0);border-radius:10px;overflow:hidden;min-width:0;background:var(--orca-color-bg-1,#fff);color:var(--orca-color-text-1,#222)}
.ohe-bar{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:8px 10px;background:var(--orca-color-bg-2,#f4f6f9);border-bottom:1px solid var(--orca-color-border,#d2d7e0)}
.ohe-title{flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.ohe-mode{font-size:11px;opacity:.65;margin-right:6px}
.ohe-block button,.ohe-dialog button{border:1px solid var(--orca-color-border,#cbd2db);border-radius:5px;padding:5px 9px;cursor:pointer;background:var(--orca-color-bg-1,#fff);color:inherit;font:inherit;font-size:12px}.ohe-block button:hover,.ohe-dialog button:hover{filter:brightness(.94)}.ohe-block button:disabled,.ohe-dialog button:disabled{opacity:.45;cursor:default}
.ohe-frame{display:block;width:100%;border:0;background:white;color-scheme:light}.ohe-error,.ohe-loading{padding:22px;font-size:13px}.ohe-error{color:var(--orca-color-dangerous-5,#b32d37)}
.ohe-preview-note{font-size:12px;padding:8px 12px;margin:0;color:var(--orca-color-text-2,#777)}
.ohe-expanded{position:fixed;inset:28px;margin:0;padding:0;width:auto;height:auto;z-index:10000;box-shadow:0 0 0 100vmax #0009;display:flex;flex-direction:column}.ohe-expanded .ohe-frame{flex:1;min-height:0}.ohe-expanded .ohe-bar{flex-shrink:0}.ohe-shell,.ohe-content{min-width:0}
.ohe-dialog{box-sizing:border-box;width:min(900px,92vw);max-height:90vh;overflow:auto;border:1px solid var(--orca-color-border,#ccd3dc);border-radius:14px;background:var(--orca-color-bg-1,#fff);color:var(--orca-color-text-1,#222);padding:24px;box-shadow:0 20px 80px #0005;font:14px/1.5 system-ui,sans-serif}.ohe-dialog::backdrop{background:#0007}.ohe-dialog h2{margin:0 0 8px;font-size:21px}.ohe-dialog p{margin:8px 0 14px}.ohe-field{display:flex;flex-direction:column;gap:5px;margin:12px 0}.ohe-field input:not([type=checkbox]),.ohe-dialog textarea{box-sizing:border-box;max-width:100%;border:1px solid var(--orca-color-border,#cbd2db);border-radius:5px;padding:8px;background:var(--orca-color-bg-2,#f5f7fa);color:inherit;font:inherit}.ohe-dialog textarea{width:100%;height:220px;resize:vertical;font:12px/1.5 Consolas,monospace}.ohe-options{display:flex;flex-wrap:wrap;gap:24px;align-items:center}.ohe-options input[type=number]{width:140px}.ohe-options input[type=checkbox]{align-self:flex-start;width:18px;height:18px}.ohe-hint{font-size:12px;opacity:.7}.ohe-actions{display:flex;gap:10px;justify-content:flex-end}.ohe-actions button[type=submit]{background:#136a80;color:#fff;border-color:#136a80}.ohe-status{min-height:22px;font-size:12px}
`;

export async function load(name) {
  if (active) await unload();
  pluginName = name;
  active = true; generation++;
  try {
    const style = element('style', { text: CSS, id: `${pluginName}-style` });
    document.head.append(style); disposers.push(() => style.remove());
    orca.renderers.registerBlock(TYPE, false, HtmlBlock, { assetFields: ['src', 'previewSrc'] });
    disposers.push(() => orca.renderers.unregisterBlock(TYPE));
    for (const format of ['plain', 'markdown']) {
      orca.converters.registerBlock(format, TYPE, (_block, repr) => `HTML 嵌入：${repr.title || 'HTML 内容'}${repr.src ? ` (${repr.src})` : '（正文保存在块内；请用插件导出原始 HTML）'}`);
      disposers.push(() => orca.converters.unregisterBlock(format, TYPE));
    }
    const command = `${pluginName}.insert`;
    // Slash/editor invocation captures the cursor before the modal moves focus.
    orca.commands.registerEditorCommand(command, async ([panelId, rootId, cursor]) => {
      try { insertEditor(cursor, writeContext(panelId, String(rootId))); } catch (error) { report(error); }
      return null;
    }, () => {}, { label: '插入 HTML 嵌入' });
    disposers.push(() => orca.commands.unregisterCommand(command));
    orca.slashCommands.registerSlashCommand(`${pluginName}.html`, { icon: 'ti ti-code', group: '插入', title: 'HTML 嵌入', command });
    disposers.push(() => orca.slashCommands.unregisterSlashCommand(`${pluginName}.html`));
    orca.toolbar.registerToolbarButton(`${pluginName}.html`, { icon: 'ti ti-code', tooltip: '插入 HTML 嵌入', command });
    disposers.push(() => orca.toolbar.unregisterToolbarButton(`${pluginName}.html`));
  } catch (error) { await unload(); throw error; }
}

export async function unload() {
  active = false; generation++;
  for (const dialog of dialogs) { dialog.close(); dialog.remove(); }
  dialogs.clear(); pendingReads.clear();
  for (const controller of readControllers) controller.abort();
  readControllers.clear();
  for (const dispose of disposers.splice(0).reverse()) { try { dispose(); } catch (error) { console.warn('[orca-html-embed] cleanup', error); } }
  pluginName = undefined;
}
