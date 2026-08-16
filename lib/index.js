/**
 * dsh-session-mover — host half.
 *
 * Move a session to another workspace:
 *   1. read the source session's full log (sessionQuery.readSession),
 *   2. create a new session in the target workspace carrying the whole history
 *      (same title / createdAt / agentPreset, new cwd = target workspace path),
 *   3. attach it to the target workspace account (workspace.attachSession),
 *   4. archive the source session so it leaves its old workspace.
 *
 * The client half (lib/client.js) reaches this through host.call('move-session'):
 *   - in a static install the web runtime routes it to the /session-mover/…
 *     route registered below (the same convention dsh-omni-bridge uses),
 *   - in the dynamic plugin runner the guarded harness.handle arm answers it.
 */

export const name = 'dsh-session-mover';
export const inject = [];

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1024 * 1024) throw new Error('request body too large');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function messageOf(error) {
  return (error && error.message) || String(error);
}

async function moveSession(ctx, sessionId, targetWorkspaceId) {
  if (typeof sessionId !== 'string' || typeof targetWorkspaceId !== 'string') {
    return { ok: false, error: 'sessionId 与 targetWorkspaceId 必须为字符串' };
  }
  const sessions = ctx.get('sessions');
  const sessionQuery = ctx.get('sessionQuery');
  const workspaceRegistry = ctx.get('workspaceRegistry');
  if (!sessions || !sessionQuery || !workspaceRegistry) {
    return { ok: false, error: '宿主服务不可用（sessions/sessionQuery/workspaceRegistry）' };
  }

  const target = workspaceRegistry.get(targetWorkspaceId);
  if (!target) return { ok: false, error: '目标工作区不存在' };

  let snapshot;
  try {
    snapshot = await sessionQuery.readSession(sessionId);
  } catch (error) {
    return { ok: false, error: '读取会话失败: ' + messageOf(error) };
  }
  const header = snapshot.session;
  if (header.cwd === target.path) {
    return { ok: false, error: '该会话已经属于这个工作区' };
  }

  // 克隆：在目标工作区创建携带完整历史的新会话（保持创建时间与 agent 预设）
  const meta = { cwd: target.path, createdAt: header.createdAt };
  if (typeof header.agentPreset === 'string') meta.agentPreset = header.agentPreset;

  let session;
  try {
    session = sessions.create(undefined, { seed: snapshot.events, meta });
  } catch (error) {
    return { ok: false, error: '创建目标会话失败: ' + messageOf(error) };
  }
  try {
    await sessions.flush(session);
  } catch (error) {
    return { ok: false, error: '持久化目标会话失败: ' + messageOf(error) };
  }
  try {
    await target.attachSession(session.id);
  } catch (error) {
    return { ok: false, error: '归属目标工作区失败: ' + messageOf(error) };
  }
  try {
    await workspaceRegistry.archiveSession(sessionId);
  } catch (error) {
    return { ok: false, error: '归档原会话失败: ' + messageOf(error) };
  }

  return {
    ok: true,
    newSessionId: session.id,
    archivedSessionId: sessionId,
    targetWorkspaceId,
    targetTitle: target.title
  };
}

export function apply(ctx) {
  // 静态安装：webServer 路由（与 dsh-omni-bridge 相同约定，host.call(method) → /session-mover/<method>）
  ctx.inject(['webServer'], (hostCtx) => {
    const server = hostCtx.webServer;
    if (!server || typeof server.register !== 'function') return;
    server.register({
      kind: 'exact',
      path: '/session-mover/move-session',
      handler: async (request, response) => {
        try {
          if (request.method !== 'POST') {
            sendJson(response, 405, { ok: false, error: 'method not allowed' });
            return;
          }
          const body = await readJsonBody(request);
          const result = await moveSession(ctx, body && body.sessionId, body && body.targetWorkspaceId);
          sendJson(response, 200, result);
        } catch (error) {
          sendJson(response, 500, { ok: false, error: messageOf(error) });
        }
      }
    });
  });

  // 动态插件运行器（可选）：harness.handle 与客户端 host.call 配对
  try {
    if (typeof harness !== 'undefined' && harness && typeof harness.handle === 'function') {
      harness.handle('move-session', async (args) =>
        moveSession(ctx, args && args.sessionId, args && args.targetWorkspaceId)
      );
    }
  } catch (error) {
    // 静态环境没有 harness，忽略
  }
}
