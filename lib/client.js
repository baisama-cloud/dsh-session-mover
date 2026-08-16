/* dsh-session-mover — client bundle (web platform).
 *
 * 直接在会话列表里拖：按住侧边栏（或任意会话列表）中的会话行，拖到另一个
 * 工作区的标题行（role="treeitem" + aria-expanded）上松手，即把会话移动到
 * 该工作区（克隆 + 归档原会话）。移动结果以底部 toast 反馈。
 *
 * 说明：这是与 dsh-omni-bridge 相同的「已打包」bundle 形态
 * （window.__ModuleLoader__.load + require('react')）。
 * 宿主 RPC 走 webServer 路由：POST /session-mover/move-session
 * （见 lib/index.js 的 /session-mover/… 路由）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-mover',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require('react');

    var CSS =
      '.smv-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:130;pointer-events:auto;padding:8px 14px;border-radius:9px;background:var(--dsw-alias-bg-overlay,#1b1f27);border:1px solid var(--dsw-alias-border-l2,#3a4150);color:var(--dsw-alias-label-primary,#eceff4);font-size:13px;box-shadow:0 10px 30px rgba(0,0,0,.5);max-width:80vw}' +
      '.smv-toast-ok{border-color:var(--dsw-alias-state-success-primary,#3fb68b);color:var(--dsw-alias-state-success-primary,#3fb68b)}' +
      '.smv-toast-err{border-color:var(--dsw-alias-state-error-primary,#e5534b);color:var(--dsw-alias-state-error-primary,#e5534b)}' +
      '.smv-toast-info{border-color:var(--dsw-alias-border-l2,#3a4150);color:var(--dsw-alias-label-secondary,#9aa3b2)}';

    var store = {
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
      var fns = Array.from(store.listeners);
      for (var i = 0; i < fns.length; i++) fns[i]();
    }

    function subscribeToast(fn) {
      store.listeners.add(fn);
      return function () { store.listeners.delete(fn); };
    }

    function showToast(kind, text) {
      if (store.toastDispose) { store.toastDispose(); store.toastDispose = null; }
      store.toast = { kind: kind, text: text };
      notifyToast();
      if (store.timer !== undefined) {
        store.toastDispose = store.timer.timeout(function () {
          store.toast = null;
          store.toastDispose = null;
          notifyToast();
        }, 2600);
      }
    }

    function callHost(method, args) {
      return fetch('/session-mover/' + method, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
        body: args === undefined ? undefined : JSON.stringify(args)
      }).then(function (res) {
        return res.json();
      });
    }

    function doMove(sessionId, wsId) {
      if (typeof sessionId !== 'string' || typeof wsId !== 'string') return;
      var ws = null;
      for (var i = 0; i < store.workspaces.length; i++) {
        if (store.workspaces[i].workspaceId === wsId) { ws = store.workspaces[i]; break; }
      }
      if (!ws) return;
      var sourceWs = null;
      for (var j = 0; j < store.workspaces.length; j++) {
        var ids = store.workspaces[j].sessionIds || [];
        if (ids.indexOf(sessionId) !== -1) { sourceWs = store.workspaces[j]; break; }
      }
      // 同工作区：交给官方逻辑（组内重排），静默跳过
      if (sourceWs && sourceWs.workspaceId === wsId) return;
      callHost('move-session', { sessionId: sessionId, targetWorkspaceId: wsId }).then(function (res) {
        if (res && res.ok === true) {
          var s = store.byId[sessionId];
          var name = (s && s.displayTitle) || sessionId;
          showToast('ok', '已移动「' + name + '」到「' + (res.targetTitle || ws.title || wsId) + '」');
          if (store.sessions !== undefined && store.current === sessionId && typeof res.newSessionId === 'string') {
            store.sessions.open(res.newSessionId);
          }
        } else {
          showToast('err', (res && res.error) || '移动失败');
        }
      }).catch(function (error) {
        showToast('err', '移动失败: ' + ((error && error.message) || String(error)));
      });
    }

    function registerDrag() {
      if (typeof document === 'undefined') return function () {};
      var headerSelector = '[role="treeitem"][aria-expanded]';
      function workspaceOfHeader(header) {
        try {
          var tree = header.closest('[role="tree"]');
          if (!tree) return null;
          var headers = Array.from(tree.querySelectorAll(headerSelector));
          var index = headers.indexOf(header);
          var ws = store.workspaces[index];
          return ws ? ws.workspaceId : null;
        } catch (error) {
          return null;
        }
      }
      function targetWorkspaceOf(e) {
        try {
          var el = e.target;
          if (!el || typeof el.closest !== 'function') return null;
          var node = el;
          while (node && node !== document.body && node !== document.documentElement) {
            if (node.hasAttribute && node.getAttribute('role') === 'treeitem' && node.hasAttribute('aria-expanded')) {
              return workspaceOfHeader(node);
            }
            if (node.querySelector) {
              var header = node.querySelector(headerSelector);
              if (header) return workspaceOfHeader(header);
            }
            node = node.parentElement;
          }
        } catch (error) {}
        return null;
      }
      function onDragOver(e) {
        try { if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; } catch (error) {}
      }
      function onDrop(e) {
        var sid = null;
        try { sid = e.dataTransfer.getData('text/plain'); } catch (error) {}
        if (!sid || !store.byId[sid]) return;
        var wsId = targetWorkspaceOf(e);
        if (!wsId) return;
        doMove(sid, wsId);
      }
      document.addEventListener('dragover', onDragOver);
      document.addEventListener('drop', onDrop);
      return function () {
        document.removeEventListener('dragover', onDragOver);
        document.removeEventListener('drop', onDrop);
      };
    }

    function SessionMoverToast(props) {
      var state = React.useState(store.toast);
      var toast = state[0];
      var setLocal = state[1];
      React.useEffect(function () { return subscribeToast(function () { setLocal(store.toast); }); }, []);
      var list = props.useSessions ? props.useSessions(function (s) { return s; }) : null;
      var wsState = props.useWorkspaces ? props.useWorkspaces(function (s) { return s; }) : null;
      store.byId = (list && list.byId) || {};
      store.current = list && list.current;
      store.workspaces = (wsState && wsState.items) || [];
      if (!toast) return null;
      return React.createElement('div', { className: 'smv-toast smv-toast-' + toast.kind }, toast.text);
    }

    var inject = ['slots'];

    function apply(ctx) {
      store.timer = ctx.get('timer');
      store.sessions = ctx.get('sessions');
      if (typeof ctx.effect === 'function') {
        ctx.effect(function () { return registerDrag(); });
      } else {
        registerDrag();
      }
      try {
        var style = document.createElement('style');
        style.textContent = CSS;
        document.head.appendChild(style);
      } catch (error) {}
      ctx.slots.register(
        { name: 'shell.overlay', id: 'session-mover-overlay', order: 100 },
        SessionMoverToast
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.name = 'dsh-session-mover';
    return module.exports;
  }
});
