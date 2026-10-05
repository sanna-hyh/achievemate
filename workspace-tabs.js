(function initViewSwitcher() {
  const tablist = document.getElementById("viewSwitcher");
  const homeLink = document.getElementById("homeLink");
  const views = {
    logbook: document.getElementById("viewLogbook"),
    studio: document.getElementById("viewStudio"),
  };

  if (!tablist || !views.logbook || !views.studio) {
    return;
  }

  const HOME_VIEW = "studio";
  const LOGBOOK_VIEW = "logbook";
  const tabs = [...tablist.querySelectorAll("[data-view]")];
  const track = tablist.querySelector(".view-switcher-track");
  const indicator = tablist.querySelector(".view-switcher-indicator");
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
    return viewId === LOGBOOK_VIEW ? "#logbook" : "#/";
  }

  // Bare `/` is the CV canvas. Explicit `#logbook` stays on the logbook.
  // Older names that used to mean "open the app" or "open the CV" land on the canvas.
  // Profile/achievements were folded into the logbook, so those links still open it.
  function resolveRoute(hash) {
    const token = tokenFromHash(hash);
    if (token === "logbook" || token === "viewlogbook") {
      return { viewId: LOGBOOK_VIEW, redirect: false };
    }
    if (token === "profile" || token === "achievements") {
      return { viewId: LOGBOOK_VIEW, redirect: true };
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
    const current = location.hash;
    const alreadyHome =
      viewId === HOME_VIEW && (current === "" || current === "#" || current === "#/");
    if (current === nextHash || alreadyHome) {
      return;
    }

    if (replace) {
      const url = new URL(location.href);
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

  tablist.addEventListener("click", (event) => {
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
