(function initViewSwitcher() {
  const tablist = document.getElementById("viewSwitcher");
  const homeLink = document.getElementById("homeLink");
  const views = {
    logbook: document.getElementById("viewLogbook"),
    studio: document.getElementById("viewStudio"),
  };

  if (!views.logbook || !views.studio) {
    return;
  }

  const HOME_VIEW = "studio";
  const LOGBOOK_VIEW = "logbook";
  const logbookEnabled = window.ENABLE_LOGBOOK === true;
  const tabs = tablist ? [...tablist.querySelectorAll("[data-view]")] : [];
  const track = tablist?.querySelector(".view-switcher-track") ?? null;
  const indicator = tablist?.querySelector(".view-switcher-indicator") ?? null;
  const cvMakerMenuBtn = document.getElementById("sidebarOpenCvMakerBtn");
  const logbookMenuBtn = document.getElementById("sidebarOpenLogbookBtn");
  const STORAGE_KEY = "achievemate-active-tab";
  let activeView = HOME_VIEW;
  let switchTimer = null;

  function tokenFromHash(hash) {
    const raw = String(hash || "").replace(/^#/, "");
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      decoded = raw;
    }
    return decoded.replace(/^\/+/, "").split(/[/?&#]/)[0].trim().toLowerCase();
  }

  function hashForView(viewId) {
    return viewId === LOGBOOK_VIEW ? "#library" : "#/";
  }

  function isLibraryToken(token) {
    return (
      token === "library" ||
      token === "logbook" ||
      token === "viewlogbook" ||
      token === "profile" ||
      token === "achievements"
    );
  }

  function isLibraryPathAlias() {
    return /\/(?:logbook|library)\/?$/i.test(location.pathname);
  }

  function canonicalPathname() {
    const next = location.pathname.replace(/\/(?:logbook|library)\/?$/i, "/");
    return next || "/";
  }

  // Bare `/` is the CV canvas. Library opens from #library; #logbook, /logbook,
  // and the older profile/achievements links land on that same page. With the
  // flag off, those links return to the CV home instead of a hidden view.
  function resolveRoute(hash) {
    const token = tokenFromHash(hash);
    const pathAlias = isLibraryPathAlias();
    if (pathAlias || isLibraryToken(token)) {
      if (!logbookEnabled) {
        return { viewId: HOME_VIEW, redirect: true };
      }
      return { viewId: LOGBOOK_VIEW, redirect: pathAlias || token !== "library" };
    }
    if (!token) {
      return { viewId: HOME_VIEW, redirect: false };
    }
    return { viewId: HOME_VIEW, redirect: true };
  }

  function persistView(viewId) {
    try {
      localStorage.setItem(STORAGE_KEY, viewId);
    } catch {
      /* ignore storage errors */
    }
  }

  function syncRoute(viewId, { replace = false } = {}) {
    const nextHash = hashForView(viewId);
    const nextPath = canonicalPathname();
    const current = location.hash;
    const samePath = nextPath === location.pathname;
    const alreadyHome =
      viewId === HOME_VIEW &&
      samePath &&
      (current === "" || current === "#" || current === "#/");
    if ((current === nextHash || alreadyHome) && samePath) {
      return;
    }

    if (replace || !samePath) {
      const url = new URL(location.href);
      url.pathname = nextPath;
      url.hash = nextHash;
      history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      return;
    }

    location.hash = nextHash;
  }

  function updateSwitcherIndicator(activeTab) {
    if (!track || !indicator) {
      return;
    }

    if (!activeTab) {
      indicator.classList.add("is-hidden");
      return;
    }

    indicator.classList.remove("is-hidden");
    indicator.style.width = `${activeTab.offsetWidth}px`;
    indicator.style.transform = `translateX(${activeTab.offsetLeft}px)`;
  }

  function syncSwitcherIndicator() {
    const activeTab = tabs.find((tab) => tab.classList.contains("is-active"));
    updateSwitcherIndicator(activeTab);
  }

  function syncChrome(viewId) {
    tabs.forEach((tab) => {
      const isActive = tab.dataset.view === viewId;
      tab.classList.toggle("is-active", isActive);
      if (isActive) {
        tab.setAttribute("aria-current", "page");
      } else {
        tab.removeAttribute("aria-current");
      }
    });

    if (homeLink) {
      if (viewId === HOME_VIEW) {
        homeLink.setAttribute("aria-current", "page");
      } else {
        homeLink.removeAttribute("aria-current");
      }
    }

    if (cvMakerMenuBtn) {
      if (viewId === HOME_VIEW) {
        cvMakerMenuBtn.setAttribute("aria-current", "page");
      } else {
        cvMakerMenuBtn.removeAttribute("aria-current");
      }
    }

    if (logbookMenuBtn) {
      if (viewId === LOGBOOK_VIEW) {
        logbookMenuBtn.setAttribute("aria-current", "page");
      } else {
        logbookMenuBtn.removeAttribute("aria-current");
      }
    }

    document.body.classList.toggle("is-studio-view", viewId === HOME_VIEW);
    syncSwitcherIndicator();
  }

  function syncViewVisibility(viewId) {
    Object.entries(views).forEach(([id, view]) => {
      const isActive = id === viewId;
      view.classList.toggle("is-active", isActive);
      view.classList.remove("is-leaving");
      view.setAttribute("aria-hidden", String(!isActive));
    });
  }

  function scheduleStudioLayout() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.AchieveMateCvPreview?.scheduleSmartLayout();
        window.AchieveMateCvPreview?.scheduleFitPreview();
      });
    });
  }

  function applyViewChange(viewId, { focusTab = false } = {}) {
    const previousView = views[activeView];
    const nextView = views[viewId];

    previousView.classList.add("is-leaving");
    previousView.classList.remove("is-active");
    previousView.setAttribute("aria-hidden", "false");

    nextView.classList.add("is-active");
    nextView.setAttribute("aria-hidden", "false");

    window.clearTimeout(switchTimer);
    switchTimer = window.setTimeout(() => {
      previousView.classList.remove("is-leaving");
      if (activeView !== viewId) {
        return;
      }
      previousView.setAttribute("aria-hidden", "true");
    }, 160);

    activeView = viewId;
    syncChrome(viewId);
    persistView(viewId);

    if (focusTab) {
      tabs.find((tab) => tab.dataset.view === viewId)?.focus();
    }

    if (viewId === HOME_VIEW) {
      scheduleStudioLayout();
    }
  }

  function setActiveView(viewId, { focusTab = false, fromRoute = false, replaceHistory = false } = {}) {
    if (!logbookEnabled && viewId === LOGBOOK_VIEW) {
      viewId = HOME_VIEW;
      replaceHistory = true;
      fromRoute = false;
    }

    if (!views[viewId]) {
      return;
    }

    if (viewId !== activeView) {
      applyViewChange(viewId, { focusTab });
    } else {
      syncChrome(viewId);
      persistView(viewId);
    }

    if (!fromRoute || replaceHistory) {
      syncRoute(viewId, { replace: replaceHistory });
    }
  }

  tablist?.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-view]");
    if (!tab || !tablist.contains(tab)) {
      return;
    }
    event.preventDefault();
    setActiveView(tab.dataset.view);
  });

  homeLink?.addEventListener("click", (event) => {
    event.preventDefault();
    setActiveView(HOME_VIEW);
  });

  window.addEventListener("hashchange", () => {
    const route = resolveRoute(location.hash);
    setActiveView(route.viewId, { fromRoute: true, replaceHistory: route.redirect });
  });

  const initialRoute = resolveRoute(location.hash);
  activeView = initialRoute.viewId;
  syncViewVisibility(initialRoute.viewId);
  syncChrome(initialRoute.viewId);
  persistView(initialRoute.viewId);

  if (initialRoute.redirect) {
    syncRoute(initialRoute.viewId, { replace: true });
  }

  requestAnimationFrame(syncSwitcherIndicator);

  if (track && typeof ResizeObserver !== "undefined") {
    const resizeObserver = new ResizeObserver(() => {
      syncSwitcherIndicator();
    });
    resizeObserver.observe(track);
    tabs.forEach((tab) => resizeObserver.observe(tab));
  } else {
    window.addEventListener("resize", syncSwitcherIndicator);
  }

  if (initialRoute.viewId === HOME_VIEW) {
    requestAnimationFrame(() => {
      window.AchieveMateCvPreview?.scheduleSmartLayout();
      window.AchieveMateCvPreview?.scheduleFitPreview();
    });
  }

  window.AchieveMateViews = {
    setActiveView,
    getActiveView: () => activeView,
    resolveRoute,
  };
})();

(function initSavedIndicator() {
  const indicator = document.getElementById("savedIndicator");
  const textEl = document.getElementById("savedIndicatorText");
  if (!indicator || !textEl) {
    return;
  }

  let savedTimer = null;
  let pendingWrites = 0;

  function showSaving() {
    indicator.classList.add("is-saving");
    textEl.textContent = "Saving…";
  }

  function showSaved() {
    indicator.classList.remove("is-saving");
    textEl.textContent = "Saved";
  }

  function markPending() {
    pendingWrites += 1;
    window.clearTimeout(savedTimer);
    showSaving();
  }

  function markComplete() {
    pendingWrites = Math.max(0, pendingWrites - 1);
    if (pendingWrites > 0) {
      return;
    }

    window.clearTimeout(savedTimer);
    savedTimer = window.setTimeout(showSaved, 600);
  }

  window.AchieveMateSaveStatus = {
    markPending,
    markComplete,
  };

  showSaved();
})();
