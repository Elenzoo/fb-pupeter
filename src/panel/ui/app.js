(() => {
  const $ = (id) => document.getElementById(id);

  // ---------- state ----------
  let token = localStorage.getItem("FBW_PANEL_TOKEN") || "";
  let logAutoTimer = null;
  let lastLogMode = "out"; // 'out' | 'err'
  let logsExpanded = false;

  // modal state
  let modalResolve = null;

  // edit modal state
  let editResolve = null;

  // ---------- ui refs ----------
  const elToken = $("token");
  const btnSaveToken = $("saveToken");
  const btnRefresh = $("refresh");
  const elStatus = $("status");

  const btnSaveEnv = $("saveEnv");
  const btnPm2Start = $("pm2Start");
  const btnPm2Stop = $("pm2Stop");
  const btnPm2Restart = $("pm2Restart");
  const btnClearCookies = $("clearCookies");
  const elEnvMsg = $("envMsg");

  const elNewPostUrl = $("newPostUrl");
  const elNewPostName = $("newPostName");
  const elNewPostImage = $("newPostImage");
  const elNewPostDescription = $("newPostDescription");
  const elNewPostActive = $("newPostActive");
  const btnAddPost = $("addPost");
  const elPostsTbody = $("posts");

  const btnLoadOut = $("loadOut");
  const btnLoadErr = $("loadErr");
  const elLogLines = $("logLines");
  const elLogAutoEvery = $("logAutoEvery");
  const btnLogAutoToggle = $("logAutoToggle");
  const elLogAutoScroll = $("logAutoScroll");
  const elLogs = $("logs");
  const elLogHint = $("logHint");

  const logsCard = $("logsCard");
  const btnToggleLogsSize = $("toggleLogsSize");

  // modal refs (delete + generic)
  const modalOverlay = $("modalOverlay");
  const modalBody = $("modalBody");
  const modalCancel = $("modalCancel");
  const modalOk = $("modalOk");

  // env fields
  const ENV_FIELDS = [
    "FB_EMAIL",
    "FB_PASSWORD",
    "WEBHOOK_URL",
    "CHECK_INTERVAL_MS",
    "POSTS_SHEET_URL",
    "HEADLESS_BROWSER",
    "USE_UI_HANDLERS",
    "INCLUDE_REPLIES",
  ];

  function setHint(el, msg, ok = true) {
    if (!el) return;
    el.textContent = msg || "";
    el.classList.remove("ok", "err");
    el.classList.add(ok ? "ok" : "err");
  }

  function fmtTime() {
    try {
      return new Date().toLocaleString();
    } catch {
      return "";
    }
  }

  function getAuthHeaders() {
    const t = (token || "").trim();
    return t ? { Authorization: `Bearer ${t}` } : {};
  }

  async function api(path, opts = {}) {
    const headers = {
      ...(opts.headers || {}),
      ...getAuthHeaders(),
    };

    let body = opts.body;
    if (body && typeof body === "object" && !(body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(body);
    }

    const res = await fetch(path, {
      method: opts.method || "GET",
      headers,
      body,
    });

    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: false, error: text || `HTTP ${res.status}` };
    }

    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}`, status: res.status, data };
    }
    return data;
  }

  // ---------- modal ----------
  function showModal({ title = "Potwierdzenie", body = "", okText = "OK", danger = false } = {}) {
    return new Promise((resolve) => {
      modalResolve = resolve;

      $("modalTitle").textContent = title;
      modalBody.innerHTML = body;

      modalOk.textContent = okText;
      modalOk.classList.toggle("danger", !!danger);

      modalOverlay.classList.add("show");
      modalOverlay.setAttribute("aria-hidden", "false");

      setTimeout(() => {
        (danger ? modalOk : modalCancel).focus();
      }, 0);
    });
  }

  function closeModal(result) {
    modalOverlay.classList.remove("show");
    modalOverlay.setAttribute("aria-hidden", "true");
    const r = modalResolve;
    modalResolve = null;
    if (typeof r === "function") r(result);
  }

  modalCancel.addEventListener("click", () => closeModal(false));
  modalOk.addEventListener("click", () => closeModal(true));
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal(false);
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalOverlay.classList.contains("show")) closeModal(false);
  });

  // ---------- core actions ----------
  async function loadStatus() {
    setHint(elStatus, "Ładowanie statusu...", true);

    const r = await api("/api/status");
    if (!r.ok) {
      setHint(
        elStatus,
        `Brak dostępu do API. Wpisz token i kliknij „Zapisz token”. (${r.error || "błąd"})`,
        false
      );
      return null;
    }

    setHint(elStatus, `Połączono • ${fmtTime()}`, true);
    return r;
  }

  async function loadEnv() {
    setHint(elEnvMsg, "Wczytuję ustawienia...", true);
    const r = await api("/api/env/get");
    if (!r.ok) {
      setHint(elEnvMsg, `Nie udało się wczytać .env (${r.error || "błąd"})`, false);
      return;
    }
    const v = r.values || {};
    for (const k of ENV_FIELDS) {
      const el = $(k);
      if (!el) continue;
      el.value = (v[k] ?? "").toString();
    }
    setHint(elEnvMsg, `Ustawienia wczytane.`, true);
  }

  async function saveEnv(restart = false) {
    const set = {};
    for (const k of ENV_FIELDS) {
      const el = $(k);
      if (!el) continue;
      set[k] = (el.value ?? "").toString();
    }

    setHint(elEnvMsg, restart ? "Zapisuję i restartuję..." : "Zapisuję...", true);

    const r = await api("/api/env/set", {
      method: "POST",
      body: { set, restart },
    });

    if (!r.ok) {
      setHint(elEnvMsg, `Nie udało się zapisać ustawień (${r.error || "błąd"})`, false);
      return;
    }

    setHint(elEnvMsg, restart ? "Zapisano i zrestartowano watchera." : "Zapisano ustawienia.", true);
  }

  function copyIconSvg() {
    // klasyczna ikonka "kopiuj" (dwa arkusze)
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="9" y="9" width="10" height="10" rx="2"></rect>
        <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1"></path>
      </svg>
    `;
  }

  async function loadPosts() {
    const r = await api("/api/posts");
    if (!r.ok) {
      setHint(elEnvMsg, `Nie udało się wczytać postów (${r.error || "błąd"})`, false);
      return;
    }

    const posts = Array.isArray(r.posts) ? r.posts : [];
    elPostsTbody.innerHTML = "";

    for (const p of posts) {
      const tr = document.createElement("tr");

      const tdId = document.createElement("td");
      tdId.className = "mono col-id";
      tdId.textContent = p.id || "";
      tr.appendChild(tdId);

      // LINK + IKONKA KOPIUJ PRZY LINKU
      const tdUrl = document.createElement("td");
      tdUrl.className = "col-url";

      if (p.url) {
        const wrap = document.createElement("div");
        wrap.className = "urlWrap";

        const a = document.createElement("a");
        a.href = p.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = p.url;

        const btnCopyIcon = document.createElement("button");
        btnCopyIcon.className = "iconBtn";
        btnCopyIcon.type = "button";
        btnCopyIcon.title = "Kopiuj link";
        btnCopyIcon.innerHTML = copyIconSvg();

        btnCopyIcon.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();

          const ok = await copyToClipboard(p.url);
          if (ok) setHint(elEnvMsg, "Link skopiowany do schowka.", true);
          else setHint(elEnvMsg, "Nie udało się skopiować linku.", false);
        });

        wrap.appendChild(a);
        wrap.appendChild(btnCopyIcon);
        tdUrl.appendChild(wrap);
      }

      tr.appendChild(tdUrl);

      const tdName = document.createElement("td");
      tdName.className = "col-name";
      tdName.textContent = p.name || "";
      tr.appendChild(tdName);

      const tdImg = document.createElement("td");
      tdImg.className = "col-img";
      if (p.image) {
        tdImg.innerHTML = `<img class="thumb" src="${escapeHtml(p.image)}" alt="miniatura" />`;
      } else {
        tdImg.textContent = "";
      }
      tr.appendChild(tdImg);

      const tdDesc = document.createElement("td");
      tdDesc.className = "col-desc";
      tdDesc.textContent = p.description || "";
      tr.appendChild(tdDesc);

      const tdActive = document.createElement("td");
      tdActive.className = "col-act";
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = !!p.active;
      chk.addEventListener("change", async () => {
        await api(`/api/posts/${encodeURIComponent(p.id)}`, {
          method: "PATCH",
          body: { active: chk.checked },
        });
        await loadPosts();
      });
      tdActive.appendChild(chk);
      tr.appendChild(tdActive);

      // AKCJE: EDYTUJ + USUŃ
      const tdActions = document.createElement("td");
      tdActions.className = "col-btn";

      const actions = document.createElement("div");
      actions.className = "actionsWrap";

      const btnEdit = document.createElement("button");
      btnEdit.className = "small";
      btnEdit.type = "button";
      btnEdit.textContent = "Edytuj";
      btnEdit.addEventListener("click", async () => {
        // minimalny edytor: szybkie wpisanie wartości przez modal (prosto i bez dorabiania HTML-a)
        // jeśli chcesz “ładny formularz” w modalu – zrobimy w następnym kroku
        const ok = await showModal({
          title: "Edytuj post",
          body:
            `<div class="muted">Na szybko: skopiuj/wklej wartości i zapisz.</div>` +
            `<div style="margin-top:10px">
              <label class="muted" style="display:block;margin:8px 0 6px;">Link</label>
              <input id="edit_url" value="${escapeHtml(p.url || "")}" />
              <label class="muted" style="display:block;margin:8px 0 6px;">Nazwa</label>
              <input id="edit_name" value="${escapeHtml(p.name || "")}" />
              <label class="muted" style="display:block;margin:8px 0 6px;">URL zdjęcia</label>
              <input id="edit_img" value="${escapeHtml(p.image || "")}" />
              <label class="muted" style="display:block;margin:8px 0 6px;">Opis</label>
              <textarea id="edit_desc" style="height:90px;">${escapeHtml(p.description || "")}</textarea>
            </div>`,
          okText: "Zapisz",
          danger: false,
        });

        if (!ok) return;

        const newUrl = (document.getElementById("edit_url")?.value || "").trim();
        const newName = (document.getElementById("edit_name")?.value || "").trim();
        const newImg = (document.getElementById("edit_img")?.value || "").trim();
        const newDesc = (document.getElementById("edit_desc")?.value || "").trim();

        const rr = await api(`/api/posts/${encodeURIComponent(p.id)}`, {
          method: "PATCH",
          body: { url: newUrl, name: newName, image: newImg, description: newDesc },
        });

        if (!rr.ok) {
          setHint(elEnvMsg, `Nie udało się zapisać zmian (${rr.error || "błąd"})`, false);
          return;
        }

        setHint(elEnvMsg, "Zapisano zmiany posta.", true);
        await loadPosts();
      });

      const btnDel = document.createElement("button");
      btnDel.className = "danger";
      btnDel.type = "button";
      btnDel.textContent = "Usuń";
      btnDel.addEventListener("click", async () => {
        const ok = await showModal({
          title: "Usunąć post?",
          body:
            `<div>Ta operacja jest nieodwracalna.</div>` +
            `<div style="margin-top:10px" class="mono">${escapeHtml(p.name || "")}</div>` +
            `<div style="margin-top:8px; opacity:.85; font-size:12px; overflow-wrap:anywhere;">${escapeHtml(p.url || "")}</div>`,
          okText: "Usuń",
          danger: true,
        });
        if (!ok) return;

        const rr = await api(`/api/posts/${encodeURIComponent(p.id)}`, { method: "DELETE" });
        if (!rr.ok) {
          setHint(elEnvMsg, `Nie udało się usunąć posta (${rr.error || "błąd"})`, false);
          return;
        }
        setHint(elEnvMsg, "Post usunięty.", true);
        await loadPosts();
      });

      actions.appendChild(btnEdit);
      actions.appendChild(btnDel);

      tdActions.appendChild(actions);
      tr.appendChild(tdActions);

      elPostsTbody.appendChild(tr);
    }
  }

  async function addPost() {
    const url = (elNewPostUrl.value || "").trim();
    const name = (elNewPostName.value || "").trim();
    const image = (elNewPostImage.value || "").trim();
    const description = (elNewPostDescription.value || "").trim();
    const active = !!elNewPostActive.checked;

    const r = await api("/api/posts", {
      method: "POST",
      body: { url, name, image, description, active },
    });

    if (!r.ok) {
      await showModal({
        title: "Nie udało się dodać posta",
        body: `<div>${escapeHtml(r.error || "Błąd")}</div>`,
        okText: "OK",
        danger: false,
      });
      return;
    }

    elNewPostUrl.value = "";
    elNewPostName.value = "";
    elNewPostImage.value = "";
    elNewPostDescription.value = "";
    elNewPostActive.checked = true;

    setHint(elEnvMsg, "Dodano post.", true);
    await loadPosts();
  }

  async function pm2Call(which) {
    const map = {
      start: "/api/pm2/start",
      stop: "/api/pm2/stop",
      restart: "/api/pm2/restart",
      status: "/api/pm2/status",
    };
    const path = map[which];
    if (!path) return;

    const label =
      which === "start" ? "Startuję watchera..."
        : which === "stop" ? "Zatrzymuję watchera..."
          : which === "restart" ? "Restartuję watchera..."
            : "Sprawdzam status...";

    setHint(elEnvMsg, label, true);

    const r = await api(path, { method: which === "status" ? "GET" : "POST" });
    if (!r.ok) {
      setHint(elEnvMsg, `Operacja PM2 nieudana (${r.error || "błąd"})`, false);
      return;
    }

    const okMsg =
      which === "start" ? "Watcher uruchomiony."
        : which === "stop" ? "Watcher zatrzymany."
          : which === "restart" ? "Watcher zrestartowany."
            : "Status pobrany.";

    setHint(elEnvMsg, okMsg, true);

    if (which !== "status") await loadStatus();
  }

  async function clearCookies() {
    const ok = await showModal({
      title: "Wyczyścić cookies?",
      body: `<div>To wymusi ponowne logowanie do Facebooka przy kolejnym uruchomieniu.</div>`,
      okText: "Wyczyść",
      danger: true,
    });
    if (!ok) return;

    setHint(elEnvMsg, "Czyszczę cookies...", true);

    const r = await api("/api/cookies/clear", {
      method: "POST",
      body: { confirm: true },
    });

    if (!r.ok) {
      setHint(elEnvMsg, `Nie udało się wyczyścić cookies (${r.error || "błąd"})`, false);
      return;
    }
    setHint(elEnvMsg, "Cookies wyczyszczone.", true);
  }

  // ---------- logs ----------
  function getLines() {
    const n = parseInt((elLogLines.value || "200").toString(), 10);
    if (!isFinite(n)) return 200;
    return Math.max(20, Math.min(2000, n));
  }

  async function loadLogs(mode) {
    lastLogMode = mode;
    const lines = getLines();
    setHint(elLogHint, `Wczytuję logi...`, true);

    const r = await api(`/api/logs/${mode}?lines=${lines}`);
    if (!r.ok) {
      elLogs.value = "";
      setHint(elLogHint, `Nie udało się wczytać logów (${r.error || "błąd"})`, false);
      return;
    }

    elLogs.value = (r.log || "").toString();
    setHint(elLogHint, `Wczytano: ${mode.toUpperCase()} • ${fmtTime()} • ${lines} linii`, true);

    if (elLogAutoScroll.checked) {
      elLogs.scrollTop = elLogs.scrollHeight;
    }
  }

  function stopAutoLogs() {
    if (logAutoTimer) {
      clearInterval(logAutoTimer);
      logAutoTimer = null;
    }
    btnLogAutoToggle.textContent = "Auto: WYŁ";
    btnLogAutoToggle.classList.remove("primary");
  }

  function startAutoLogs() {
    const every = parseInt((elLogAutoEvery.value || "0").toString(), 10) || 0;
    if (every <= 0) {
      stopAutoLogs();
      return;
    }

    stopAutoLogs();
    btnLogAutoToggle.textContent = "Auto: WŁ";
    btnLogAutoToggle.classList.add("primary");

    logAutoTimer = setInterval(() => {
      loadLogs(lastLogMode).catch(() => {});
    }, every);
  }

  function toggleLogsSize() {
    logsExpanded = !logsExpanded;
    logsCard.classList.toggle("logsExpanded", logsExpanded);
    btnToggleLogsSize.textContent = logsExpanded ? "Zwiń" : "Rozwiń";
  }

  // ---------- utils ----------
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        document.body.removeChild(ta);
        return true;
      } catch {
        document.body.removeChild(ta);
        return false;
      }
    }
  }

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // ---------- wire events ----------
  function wire() {
    elToken.value = token;

    btnSaveToken.addEventListener("click", async () => {
      token = (elToken.value || "").trim();
      localStorage.setItem("FBW_PANEL_TOKEN", token);
      await hardRefresh();
    });

    btnRefresh.addEventListener("click", async () => {
      await hardRefresh();
    });

    btnSaveEnv.addEventListener("click", async () => {
      await saveEnv(false);
    });

    btnPm2Start.addEventListener("click", async () => await pm2Call("start"));
    btnPm2Stop.addEventListener("click", async () => await pm2Call("stop"));
    btnPm2Restart.addEventListener("click", async () => await pm2Call("restart"));

    btnClearCookies.addEventListener("click", async () => await clearCookies());

    btnAddPost.addEventListener("click", async () => await addPost());

    btnLoadOut.addEventListener("click", async () => await loadLogs("out"));
    btnLoadErr.addEventListener("click", async () => await loadLogs("err"));

    btnLogAutoToggle.addEventListener("click", () => {
      if (logAutoTimer) stopAutoLogs();
      else startAutoLogs();
    });

    elLogAutoEvery.addEventListener("change", () => {
      if (logAutoTimer) startAutoLogs();
    });

    btnToggleLogsSize.addEventListener("click", () => toggleLogsSize());
  }

  async function hardRefresh() {
    await loadStatus();
    await loadEnv();
    await loadPosts();

    if (elLogs.value && elLogs.value.trim().length > 0) {
      await loadLogs(lastLogMode);
    }
  }

  // ---------- init ----------
  wire();
  hardRefresh().catch(() => {
    setHint(elStatus, "Nie udało się odświeżyć panelu (token / backend).", false);
  });
})();
