/**
 * dsh-session-mover — client half.
 *
 * 直接在会话列表里拖：按住侧边栏（或任意会话列表）中的会话行，拖到另一个
 * 工作区的标题行（role="treeitem" + aria-expanded）上松手，即把会话移动到
 * 该工作区（克隆 + 归档原会话）。移动结果以底部 toast 反馈。
 *
 * 实现要点：
 *  - 官方侧边栏的会话行本身可拖拽，拖起时把会话 ID 写入
 *    dataTransfer（setData("text/plain", id)）——但官方只允许同工作区内重排；
 *  - 插件在 document 层监听 drop，用语义属性（role/aria-expanded，而非样式类）
 *    定位光标下的工作区标题行，再按其在树中的顺序映射到对应工作区；
 *  - 同工作区内拖动仍走官方重排逻辑，互不干扰。
 */
const CSS = `
.smv-toast { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%); z-index: 130; pointer-events: auto; padding: 8px 14px; border-radius: 9px; background: var(--dsw-alias-bg-overlay, #1b1f27); border: 1px solid var(--dsw-alias-border-l2, #3a4150); color: var(--dsw-alias-label-primary, #eceff4); font-size: 13px; box-shadow: 0 10px 30px rgba(0,0,0,.5); max-width: 80vw; }
.smv-toast-ok { border-color: var(--dsw-alias-state-success-primary, #3fb68b); color: var(--dsw-alias-state-success-primary, #3fb68b); }
.smv-toast-err { border-color: var(--dsw-alias-state-error-primary, #e5534b); color: var(--dsw-alias-state-error-primary, #e5534b); }
.smv-toast-info { border-color: var(--dsw-alias-border-l2, #3a4150); color: var(--dsw-alias-label-secondary, #9aa3b2); }
`;

const store = {
  byId: {},
  workspaces: [],
  current: undefined,
  sessions: undefined,
  timer: undefined,
  toast: null,
  listeners: new Set(),
  toastDispose: null
};

function notifyToast() {
  for (const fn of Array.from(store.listeners)) fn();
}

function subscribeToast(fn) {
  store.listeners.add(fn);
  return () => { store.listeners.delete(fn); };
}

function showToast(kind, text) {
  if (store.toastDispose) { store.toastDispose(); store.toastDispose = null; }
  store.toast = { kind: kind, text: text };
  notifyToast();
  if (store.timer !== undefined) {
    store.toastDispose = store.timer.timeout(() => {
      store.toast = null;
      store.toastDispose = null;
      notifyToast();
    }, 2600);
  }
}

async function doMove(sessionId, wsId) {
  if (typeof sessionId !== 'string' || typeof wsId !== 'string') return;
  const ws = store.workspaces.find((w) => w.workspaceId === wsId);
  if (!ws) return;
  const sourceWs = store.workspaces.find((w) => (w.sessionIds || []).indexOf(sessionId) !== -1);
  // 同工作区：交给官方逻辑（组内重排），静默跳过
  if (sourceWs && sourceWs.workspaceId === wsId) return;
  try {
    const res = await host.call('move-session', { sessionId: sessionId, targetWorkspaceId: wsId });
    if (res && res.ok === true) {
      const s = store.byId[sessionId];
      const name = (s && s.displayTitle) || sessionId;
      showToast('ok', '已移动「' + name + '」到「' + (res.targetTitle || ws.title || wsId) + '」');
      if (store.sessions !== undefined && store.current === sessionId && typeof res.newSessionId === 'string') {
        store.sessions.open(res.newSessionId);
      }
    } else {
      showToast('err', (res && res.error) || '移动失败');
    }
  } catch (error) {
    showToast('err', '移动失败: ' + ((error && error.message) || String(error)));
  }
}

function registerDrag() {
  if (typeof document === 'undefined') return () => {};
  const headerSelector = '[role="treeitem"][aria-expanded]';
  const workspaceOfHeader = (header) => {
    try {
      const tree = header.closest('[role="tree"]');
      if (!tree) return null;
      const headers = Array.from(tree.querySelectorAll(headerSelector));
      const index = headers.indexOf(header);
      const ws = store.workspaces[index];
      return ws ? ws.workspaceId : null;
    } catch (error) {
      return null;
    }
  };
  const targetWorkspaceOf = (e) => {
    try {
      const el = e.target;
      if (!el || typeof el.closest !== 'function') return null;
      let node = el;
      while (node && node !== document.body && node !== document.documentElement) {
        if (node.hasAttribute && node.getAttribute('role') === 'treeitem' && node.hasAttribute('aria-expanded')) {
          return workspaceOfHeader(node);
        }
        if (node.querySelector) {
          const header = node.querySelector(headerSelector);
          if (header) return workspaceOfHeader(header);
        }
        node = node.parentElement;
      }
    } catch (error) {}
    return null;
  };
  const onDragOver = (e) => {
    try { if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; } catch (error) {}
  };
  const onDrop = (e) => {
    let sid = null;
    try { sid = e.dataTransfer.getData('text/plain'); } catch (error) {}
    if (!sid || !store.byId[sid]) return;
    const wsId = targetWorkspaceOf(e);
    if (!wsId) return;
    doMove(sid, wsId);
  };
  document.addEventListener('dragover', onDragOver);
  document.addEventListener('drop', onDrop);
  return () => {
    document.removeEventListener('dragover', onDragOver);
    document.removeEventListener('drop', onDrop);
  };
}

function SessionMoverToast(props) {
  const [toast, setLocal] = React.useState(store.toast);
  React.useEffect(() => subscribeToast(() => setLocal(store.toast)), []);
  const list = props.useSessions ? props.useSessions((s) => s) : null;
  const wsState = props.useWorkspaces ? props.useWorkspaces((s) => s) : null;
  store.byId = (list && list.byId) || {};
  store.current = list && list.current;
  store.workspaces = (wsState && wsState.items) || [];
  if (!toast) return null;
  return React.createElement('div', { className: 'smv-toast smv-toast-' + toast.kind }, toast.text);
}

return {
  inject: ['slots'],
  apply(ctx) {
    store.timer = ctx.get('timer');
    store.sessions = ctx.get('sessions');
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => registerDrag());
    } else {
      registerDrag();
    }
    styles.insert(CSS);
    ctx.slots.register(
      { name: 'shell.overlay', id: 'session-mover-overlay', order: 100 },
      SessionMoverToast
    );
  }
};
