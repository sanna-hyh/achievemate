(function initViewSwitcher() {
  const tablist = document.getElementById("viewSwitcher");
  const views = {
    logbook: document.getElementById("viewLogbook"),
    studio: document.getElementById("viewStudio"),
  };

  if (!tablist || !views.logbook || !views.studio) {
    return;
  }

  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  const track = tablist.querySelector(".view-switcher-track");
  const indicator = tablist.querySelector(".view-switcher-indicator");
  const STORAGE_KEY = "achievemate-active-tab";
  let activeView = "logbook";
  let switchTimer = null;

  function updateSwitcherIndicator(activeTab) {
    if (!track || !indicator || !activeTab) {
      return;
    }

    const left = activeTab.offsetLeft;
    const width = activeTab.offsetWidth;

    indicator.style.width = `${width}px`;
    indicator.style.transform = `translateX(${left}px)`;
  }

  function syncSwitcherIndicator() {
    const activeTab = tabs.find((tab) => tab.classList.contains("is-active"));
    updateSwitcherIndicator(activeTab);
  }

  function mapLegacyTab(tabId) {
    if (tabId === "profile" || tabId === "achievements" || tabId === "logbook") {
      return "logbook";
    }
    if (tabId === "cv-builder" || tabId === "export" || tabId === "studio") {
      return "studio";
    }
    return null;
  }

  function syncViewVisibility(viewId) {
    Object.entries(views).forEach(([id, view]) => {
      const isActive = id === viewId;
      view.classList.toggle("is-active", isActive);
      view.setAttribute("aria-hidden", String(!isActive));
    });
  }

  function setActiveView(viewId, { focusTab = false } = {}) {
    if (!views[viewId] || viewId === activeView) {
      return;
    }

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
      previousView.setAttribute("aria-hidden", "true");
    }, 160);

    tabs.forEach((tab) => {
      const isActive = tab.dataset.view === viewId;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
      tab.tabIndex = isActive ? 0 : -1;
    });

    syncSwitcherIndicator();

    activeView = viewId;

    try {
      localStorage.setItem(STORAGE_KEY, viewId);
    } catch {
      /* ignore storage errors */
    }

    if (focusTab) {
      tabs.find((tab) => tab.dataset.view === viewId)?.focus();
    }

    if (viewId === "studio") {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.AchieveMateCvPreview?.scheduleSmartLayout();
          window.AchieveMateCvPreview?.scheduleFitPreview();
        });
      });
    }
  }

  tablist.addEventListener("click", (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (!tab || !tablist.contains(tab)) {
      return;
    }
    setActiveView(tab.dataset.view);
  });

  tablist.addEventListener("keydown", (event) => {
    const currentIndex = tabs.findIndex((tab) => tab.classList.contains("is-active"));
    if (currentIndex === -1) {
      return;
    }

    let nextIndex = currentIndex;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      event.preventDefault();
      nextIndex = 0;
    } else if (event.key === "End") {
      event.preventDefault();
      nextIndex = tabs.length - 1;
    } else {
      return;
    }

    setActiveView(tabs[nextIndex].dataset.view, { focusTab: true });
  });

  let initialView = "logbook";
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const mapped = saved ? mapLegacyTab(saved) : null;
    if (mapped && views[mapped]) {
      initialView = mapped;
    }
  } catch {
    /* ignore storage errors */
  }

  activeView = initialView;
  syncViewVisibility(initialView);

  tabs.forEach((tab) => {
    const isActive = tab.dataset.view === initialView;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
  });

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

  if (initialView === "studio") {
    requestAnimationFrame(() => {
      window.AchieveMateCvPreview?.scheduleSmartLayout();
      window.AchieveMateCvPreview?.scheduleFitPreview();
    });
  }

  window.AchieveMateViews = {
    setActiveView,
    getActiveView: () => activeView,
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
