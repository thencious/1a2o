(() => {
  const configKey = "still.alerts.v1",
    queueKey = "still.ntfy.queue.v1";
  let config = { topic: "" },
    queue = {},
    busy = false,
    lastAttempt = 0;
  try {
    const saved = localStorage.getItem(configKey);
    if (saved) config = JSON.parse(saved);
    queue = JSON.parse(localStorage.getItem(queueKey) || "{}");
  } catch {}
  const statusListeners = new Set();
  let status = "";
  const setStatus = (s) => {
    status = s;
    statusListeners.forEach((fn) => fn(s));
  };
  const token = () => {
    if (window.InboxTodoHost) return "";
    try {
      return sessionStorage.getItem("still.ntfy.token") || "";
    } catch {
      return "";
    }
  };
  async function configure(topic, accessToken) {
    if (window.InboxTodoHost) {
      await InboxTodoHost.configureNtfy(topic, accessToken);
      config = { topic };
      localStorage.setItem(configKey, JSON.stringify(config));
      setStatus("ntfy saved securely. Background scheduling enabled.");
      lastAttempt = 0;
      return;
    }
    if (topic) {
      const url = new URL(topic);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !/^\/[\w-]+\/?$/.test(url.pathname)
      )
        throw new Error("Use an HTTPS ntfy topic URL.");
      topic = url.origin + url.pathname.replace(/\/$/, "");
    }
    config = { topic };
    localStorage.setItem(configKey, JSON.stringify(config));
    sessionStorage.setItem("still.ntfy.token", accessToken || "");
    lastAttempt = 0;
    setStatus(topic ? "ntfy configured. Scheduling alerts…" : "ntfy disabled.");
  }
  const trigger = (task) => {
    const policy = window.InboxTodoHost?.policy();
    if (policy && !policy.remindersEnabled) return null;
    const lead =
      policy?.reminderLeadMinutes > 0
        ? policy.reminderLeadMinutes * 60
        : Number(task.estimatedSeconds) || 0;
    return !task.completedAt && Number.isFinite(task.deadline?.at)
      ? task.deadline.at - lead * 1000
      : null;
  };
  async function send(url, options) {
    const headers = { ...options.headers };
    if (
      token() &&
      config.topic &&
      new URL(url).origin === new URL(config.topic).origin
    )
      headers.Authorization = `Bearer ${token()}`;
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(`ntfy rejected request (${response.status}).`);
      return response;
    } finally {
      clearTimeout(timer);
    }
  }
  async function sync(tasks, _save) {
    if (window.InboxTodoHost) {
      try {
        const result = await InboxTodoHost.syncReminders();
        if (result)
          setStatus(
            result.configured
              ? result.errors?.[0] ||
                  `${result.queued} ntfy alerts queued. Background scheduler active.${result.waiting ? ` ${result.waiting} waiting for the scheduling window.` : ""}`
              : "ntfy not configured.",
          );
      } catch (error) {
        setStatus(error.message || "Background reminder check will retry.");
      }
      return;
    }
    if (window.StillCloud) {
      StillCloud.save(tasks);
      return;
    }
    if (busy || Date.now() - lastAttempt < 10_000) return;
    busy = true;
    lastAttempt = Date.now();
    let pending = 0,
      scheduled = 0;
    try {
      for (const [id, record] of Object.entries(queue)) {
        const task = tasks.find((t) => t.id === id),
          at = task ? trigger(task) : null;
        if (
          at !== record.at ||
          !config.topic ||
          !record.url.startsWith(`${config.topic}/`)
        ) {
          if (record.at > Date.now())
            await send(record.url, { method: "DELETE" });
          delete queue[id];
          localStorage.setItem(queueKey, JSON.stringify(queue));
        }
      }
      if (!config.topic) {
        setStatus("ntfy not configured.");
        return;
      }
      for (const task of tasks) {
        const at = trigger(task);
        if (at === null) continue;
        const record = queue[task.id];
        if (
          record?.at === at &&
          (record.title === task.title || at <= Date.now())
        ) {
          scheduled++;
          continue;
        }
        const delay = at - Date.now();
        if (delay > 259_190_000 || (delay > 0 && delay <= 10_000)) {
          pending++;
          continue;
        }
        const url = `${config.topic}/still-${encodeURIComponent(task.id)}`,
          headers = {
            "Content-Type": "text/plain; charset=utf-8",
            Title: "Time to start your task",
            Priority: "4",
            Click: location.origin + location.pathname,
          };
        if (delay > 10_000) headers.Delay = String(Math.ceil(at / 1000));
        const minutes = Math.ceil(task.estimatedSeconds / 60),
          message = `${task.title}\nEstimated work: ${minutes} min. Due ${new Date(task.deadline.at).toLocaleString()}.`;
        await send(url, { method: "POST", headers, body: message });
        queue[task.id] = { url, at, title: task.title };
        localStorage.setItem(queueKey, JSON.stringify(queue));
        scheduled++;
      }
      setStatus(
        `${scheduled} ntfy alert${scheduled === 1 ? "" : "s"} queued.${pending ? ` ${pending} waiting for the 3-day scheduling window.` : ""}`,
      );
    } catch (e) {
      setStatus(
        `${e.message || "ntfy unavailable"} Pending alerts will retry while this app is open.`,
      );
    } finally {
      busy = false;
    }
  }
  function tick(tasks, save, toast) {
    let changed = false;
    for (const task of tasks) {
      const at = trigger(task);
      if (at === null || Date.now() < at) continue;
      const signature = `${task.deadline.at}:${task.estimatedSeconds}`;
      if (task.alerted === signature) continue;
      task.alerted = signature;
      changed = true;
      const body = `About ${Math.ceil(task.estimatedSeconds / 60)} min of work left. Due ${new Date(task.deadline.at).toLocaleString()}.`;
      if (
        !window.InboxTodoHost?.windowsNotifications &&
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        try {
          const notice = new Notification(`Time to start: ${task.title}`, {
            body,
            tag: `still-${task.id}`,
          });
          notice.onclick = () => {
            window.focus();
            notice.close();
          };
        } catch {}
      }
      toast(`Time to start: ${task.title}`);
    }
    if (changed) {
      save();
      lastAttempt = 0;
    }
  }
  async function enable() {
    if (window.InboxTodoHost?.windowsNotifications)
      return "Windows task alerts are enabled through 1a2o, including while this window is closed.";
    if (!("Notification" in window))
      return "Browser notifications are not supported here.";
    const permission = await Notification.requestPermission();
    return permission === "granted"
      ? "Browser alerts enabled while the app is open."
      : `Browser alerts are ${permission}. In-app alerts still work.`;
  }
  window.StillAlerts = {
    configure,
    sync,
    tick,
    enable,
    topic: () => config.topic || "",
    token,
    status: () => status,
    onStatus: (fn) => statusListeners.add(fn),
    serverStatus: setStatus,
    refresh: () => {
      lastAttempt = 0;
    },
  };
})();
