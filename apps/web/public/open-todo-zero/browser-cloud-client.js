(() => {
  if (window.Onea2oCloud) return;
  const connectionKey = "1a2o.cloud.connection.v1";
  const definitions = {
    tasks: {
      key: "still.tasks.v1",
      baseline: "zenro.tasks.saved-baseline",
      dirty: "open-inbox-zero.todo.dirty",
    },
    notes: {
      key: "zenro.notes.v1",
      baseline: "zenro.notes.baseline",
      dirty: "zenro.notes.dirty",
    },
  };
  let connection = stored(connectionKey, null),
    initializing = null;
  if (connection && !/^[a-f0-9]{64}$/.test(connection.deviceId || "")) {
    connection = null;
    localStorage.removeItem(connectionKey);
  }
  const active = new Map(),
    timers = new Map(),
    statuses = new Map();
  const channel =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel("1a2o-cloud-changes")
      : null;
  const currentWorkspace = () =>
    location.pathname.endsWith("/notes.html")
      ? "notes"
      : document.getElementById("inbox-todo-bootstrap")
        ? JSON.parse(
            document.getElementById("inbox-todo-bootstrap").textContent,
          ).workspace || "tasks"
        : null;
  function stored(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
    } catch {
      return fallback;
    }
  }
  function save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
  function metaKey(workspace) {
    return connection
      ? `1a2o.cloud.meta:${connection.namespace}:${workspace}`
      : null;
  }
  const items = (workspace) => stored(definitions[workspace].key, []);
  function displayStatus(workspace, fallback) {
    const status = statuses.get(workspace);
    if (
      status?.state === "synced" &&
      JSON.stringify(items(workspace)) === status.payload
    )
      return "Saved on device and in private cloud";
    if (connection && status?.state === "revoked")
      return "Saved on device - reconnect private cloud";
    if (connection && status?.state === "pending")
      return "Saved on device - cloud sync pending";
    return fallback;
  }
  function report(workspace, state, payload) {
    statuses.set(workspace, { state, payload, at: Date.now() });
    window.dispatchEvent(
      new CustomEvent("onea2o-cloud-status", { detail: { workspace, state } }),
    );
    const element = document.getElementById("storage-status");
    if (element && currentWorkspace() === workspace)
      element.textContent = displayStatus(
        workspace,
        state === "synced"
          ? "Saved on device and in private cloud"
          : "Saved on device - cloud sync will retry",
      );
  }
  async function refreshConnection() {
    if (initializing) return initializing;
    initializing = (async () => {
      try {
        const response = await fetch("/api/user/todo/sync/connection", {
          cache: "no-store",
          credentials: "same-origin",
          signal: AbortSignal.timeout(5000),
        });
        if (response.status === 401 || response.status === 403) {
          connection = null;
          localStorage.removeItem(connectionKey);
          return null;
        }
        if (!response.ok) return connection;
        const data = await response.json();
        if (!data.enabled) {
          connection = null;
          localStorage.removeItem(connectionKey);
          return null;
        }
        const url = new URL(data.url);
        if (
          url.protocol !== "https:" ||
          url.pathname !== "/" ||
          url.search ||
          url.hash ||
          url.username ||
          url.password ||
          !/^[a-f0-9]{64}$/.test(data.key) ||
          !/^[a-f0-9]{64}$/.test(data.token) ||
          !/^[a-f0-9]{64}$/.test(data.deviceId || "")
        )
          throw new Error("Invalid private cloud connection");
        connection = {
          url: url.origin,
          namespace: data.namespace,
          key: data.key,
          token: data.token,
          deviceId: data.deviceId,
        };
        save(connectionKey, connection);
        return connection;
      } catch {
        return connection;
      } finally {
        initializing = null;
      }
    })();
    return initializing;
  }
  async function requestCloud(path, init) {
    const response = await fetch(connection.url + path, {
      ...init,
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${connection.token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401 || response.status === 403)
      throw Object.assign(new Error("Device cloud access was revoked"), {
        revoked: true,
      });
    const data = await response.json();
    return { response, data };
  }
  function emit(workspace, value) {
    window.dispatchEvent(
      new CustomEvent("onea2o-cloud-merge", {
        detail: { workspace, items: structuredClone(value) },
      }),
    );
    channel?.postMessage({ workspace });
  }
  async function backendOwnsSync(workspace) {
    try {
      const response = await fetch("/api/user/todo/sync", {
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) return false;
      const status = await response.json();
      if (
        !status.enabled ||
        !status.checkedAt ||
        Date.now() - status.checkedAt > 45_000
      )
        return false;
      // The host worker is the only cloud writer while it is available.
      // Direct encrypted sync remains available when the host is offline.
      report(workspace, "pending");
      try {
        const snapshotResponse = await fetch(
          `/api/user/todo/state?workspace=${workspace}`,
          {
            credentials: "same-origin",
            cache: "no-store",
            signal: AbortSignal.timeout(2500),
          },
        );
        if (snapshotResponse.ok) {
          const snapshot = await snapshotResponse.json();
          const worker = status.workspaces?.[workspace];
          const payload = JSON.stringify(items(workspace));
          if (
            worker?.revision === snapshot.revision &&
            !worker.pending &&
            !worker.error &&
            payload === JSON.stringify(snapshot.tasks)
          )
            report(workspace, "synced", payload);
        }
      } catch {
        /* An unavailable snapshot must not start a second cloud writer. */
      }
      return true;
    } catch {
      return false;
    }
  }
  async function synchronize(workspace) {
    if (await backendOwnsSync(workspace)) return;
    if (!connection) await refreshConnection();
    if (!connection || !crypto.subtle) return;
    const { key, baseline, dirty } = definitions[workspace];
    const meta = stored(metaKey(workspace), {
      revision: null,
      baseline: stored(baseline, []),
    });
    const [
      { documentId, packCloudState, unpackCloudState },
      { mergeWorkspaceItems },
    ] = await Promise.all([
      import("./browser-cloud-crypto.mjs"),
      import("./workspace-data.mjs"),
    ]);
    const id = await documentId(connection.namespace, workspace);
    const { response, data: remote } = await requestCloud(
      `/v1/documents/${id}`,
    );
    if (!response.ok && response.status !== 404)
      throw new Error("Private cloud is unavailable");
    const cloud = response.ok
      ? await unpackCloudState(remote.payload, connection.key)
      : null;
    if (cloud && (!Array.isArray(cloud.tasks) || cloud.revision !== remote.rev))
      throw new Error("Private cloud snapshot validation failed");
    const before = items(workspace);
    const merged = cloud
      ? mergeWorkspaceItems(meta.baseline, before, cloud.tasks)
      : before;
    const payload = JSON.stringify(merged),
      changed = payload !== JSON.stringify(before);
    if (changed) {
      save(key, merged);
      localStorage.setItem(dirty, "true");
      emit(workspace, merged);
    }
    if (cloud && payload === JSON.stringify(cloud.tasks)) {
      save(metaKey(workspace), {
        revision: remote.rev,
        baseline: cloud.tasks,
        at: Date.now(),
      });
      report(workspace, "synced", payload);
      return;
    }
    report(workspace, "pending");
    const snapshot = {
      revision: crypto.randomUUID(),
      tasks: structuredClone(merged),
    };
    const encrypted = await packCloudState(snapshot, connection.key);
    const result = await requestCloud(`/v1/documents/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        rev: snapshot.revision,
        parent: remote.rev ?? null,
        payload: encrypted,
      }),
    });
    if (result.response.status === 409) {
      schedule(workspace, 500);
      return;
    }
    if (!result.response.ok) throw new Error("Private cloud save will retry");
    save(metaKey(workspace), {
      revision: snapshot.revision,
      baseline: snapshot.tasks,
      at: Date.now(),
    });
    if (JSON.stringify(items(workspace)) === payload)
      report(workspace, "synced", payload);
    else {
      report(workspace, "pending");
      schedule(workspace, 500);
    }
  }
  async function sync(workspace) {
    if (active.has(workspace)) return active.get(workspace);
    const operation = (async () => {
      try {
        if (navigator.locks && connection)
          return await navigator.locks.request(
            `1a2o-cloud:${connection.namespace}:${workspace}`,
            () => synchronize(workspace),
          );
        return await synchronize(workspace);
      } catch (error) {
        report(workspace, error.revoked ? "revoked" : "pending");
      } finally {
        active.delete(workspace);
      }
    })();
    active.set(workspace, operation);
    return operation;
  }
  function schedule(workspace, wait = 500) {
    clearTimeout(timers.get(workspace));
    timers.set(
      workspace,
      setTimeout(() => {
        timers.delete(workspace);
        sync(workspace);
      }, wait),
    );
  }
  function changed(workspace) {
    if (!definitions[workspace]) return;
    report(workspace, "pending");
    schedule(workspace);
  }
  async function hydrateAll() {
    await refreshConnection();
    await Promise.all(Object.keys(definitions).map(sync));
  }
  window.Onea2oCloud = {
    changed,
    sync,
    hydrateAll,
    displayStatus,
    status: (workspace) => statuses.get(workspace),
  };
  if (channel)
    channel.onmessage = (event) => {
      if (definitions[event.data?.workspace])
        window.dispatchEvent(
          new CustomEvent("onea2o-cloud-merge", {
            detail: {
              workspace: event.data.workspace,
              items: items(event.data.workspace),
            },
          }),
        );
    };
  window.addEventListener("storage", (event) => {
    for (const [workspace, value] of Object.entries(definitions))
      if (event.key === value.key) schedule(workspace);
  });
  window.addEventListener("online", () => {
    refreshConnection();
    for (const workspace of Object.keys(definitions)) sync(workspace);
  });
  window.addEventListener("focus", () => {
    for (const workspace of Object.keys(definitions)) sync(workspace);
  });
  setInterval(() => {
    for (const workspace of Object.keys(definitions)) sync(workspace);
  }, 15_000);
  setInterval(refreshConnection, 15 * 60_000);
  if (connection) {
    refreshConnection();
    for (const workspace of Object.keys(definitions)) schedule(workspace, 0);
  } else hydrateAll();
})();
