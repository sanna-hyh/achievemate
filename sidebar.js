(function initAppSidebar() {
  const STORAGE_KEY = "achievemate-sidebar-collapsed";
  const MOBILE_QUERY = window.matchMedia("(max-width: 900px)");

  const sidebar = document.getElementById("appSidebar");
  const scrim = document.getElementById("sidebarScrim");
  const toggleBtn = document.getElementById("sidebarToggleBtn");
  const collapseBtn = document.getElementById("sidebarCollapseBtn");
  const openStudioBtn = document.getElementById("sidebarOpenStudioBtn");
  const railButtons = [...document.querySelectorAll(".sidebar-rail-btn")];
  const panelToggles = [...document.querySelectorAll(".sidebar-panel-toggle")];

  if (!sidebar || !toggleBtn) {
    return;
  }

  let collapsed = false;
  let mobileOpen = false;

  function isMobile() {
    return MOBILE_QUERY.matches;
  }

  function readCollapsedPreference() {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  }

  function saveCollapsedPreference(value) {
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      /* ignore storage errors */
    }
  }

  function syncToggleButtons() {
    const expanded = isMobile() ? mobileOpen : !collapsed;
    toggleBtn.setAttribute("aria-expanded", String(expanded));
    collapseBtn?.setAttribute("aria-expanded", String(expanded));
  }

  function syncBodyClasses() {
    document.body.classList.toggle("sidebar-collapsed", !isMobile() && collapsed);
    document.body.classList.toggle("sidebar-mobile-open", isMobile() && mobileOpen);

    if (scrim) {
      const showScrim = isMobile() && mobileOpen;
      scrim.hidden = !showScrim;
      scrim.setAttribute("aria-hidden", String(!showScrim));
    }

    syncToggleButtons();
  }

  function setCollapsed(nextCollapsed) {
    collapsed = nextCollapsed;
    saveCollapsedPreference(nextCollapsed);
    syncBodyClasses();
  }

  function setMobileOpen(nextOpen) {
    mobileOpen = nextOpen;
    syncBodyClasses();
  }

  function expandSidebar({ focusPanel = null } = {}) {
    if (isMobile()) {
      setMobileOpen(true);
    } else {
      setCollapsed(false);
    }

    if (focusPanel) {
      openPanel(focusPanel);
    }
  }

  function collapseSidebar() {
    if (isMobile()) {
      setMobileOpen(false);
      return;
    }
    setCollapsed(true);
  }

  function toggleSidebar() {
    if (isMobile()) {
      setMobileOpen(!mobileOpen);
      return;
    }
    setCollapsed(!collapsed);
  }

  function openPanel(panelId) {
    const panelMap = {
      personal: {
        toggle: document.getElementById("sidebarPersonalToggle"),
        body: document.getElementById("sidebarPersonalBody"),
      },
      account: {
        body: document.querySelector(".sidebar-panel-static-head + .sidebar-panel-body"),
      },
      settings: {
        toggle: document.getElementById("sidebarSettingsToggle"),
        body: document.getElementById("sidebarSettingsBody"),
      },
    };

    const panel = panelMap[panelId];
    if (!panel?.body) {
      return;
    }

    if (panel.toggle) {
      panel.toggle.setAttribute("aria-expanded", "true");
    }
    panel.body.hidden = false;
  }

  panelToggles.forEach((toggle) => {
    const body = document.getElementById(toggle.getAttribute("aria-controls"));
    if (!body) {
      return;
    }

    toggle.addEventListener("click", () => {
      const isExpanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!isExpanded));
      body.hidden = isExpanded;
    });
  });

  toggleBtn.addEventListener("click", toggleSidebar);
  collapseBtn?.addEventListener("click", collapseSidebar);
  scrim?.addEventListener("click", () => setMobileOpen(false));

  railButtons.forEach((button) => {
    button.addEventListener("click", () => {
      expandSidebar({ focusPanel: button.dataset.panel });
    });
  });

  openStudioBtn?.addEventListener("click", () => {
    document.querySelector('[data-view="studio"]')?.click();
    if (isMobile()) {
      setMobileOpen(false);
    }
  });

  MOBILE_QUERY.addEventListener("change", () => {
    if (isMobile()) {
      collapsed = readCollapsedPreference();
      mobileOpen = false;
    } else {
      mobileOpen = false;
    }
    syncBodyClasses();
  });

  collapsed = readCollapsedPreference();
  if (isMobile()) {
    mobileOpen = false;
  }
  syncBodyClasses();

  window.AchieveMateSidebar = {
    expand: expandSidebar,
    collapse: collapseSidebar,
    refreshIdentitySummary: () => window.AchieveMateApp?.updateSidebarIdentitySummary?.(),
  };
})();
