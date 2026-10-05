(function initAppSidebar() {
  const sidebar = document.getElementById("appSidebar");
  const scrim = document.getElementById("sidebarScrim");
  const toggleBtn = document.getElementById("sidebarToggleBtn");
  const collapseBtn = document.getElementById("sidebarCollapseBtn");
  const openStudioBtn = document.getElementById("sidebarOpenStudioBtn");
  const panelToggles = [...document.querySelectorAll(".sidebar-panel-toggle")];

  if (!sidebar || !toggleBtn) {
    return;
  }

  let sidebarOpen = false;

  function syncSidebarState() {
    document.body.classList.toggle("sidebar-open", sidebarOpen);
    toggleBtn.setAttribute("aria-expanded", String(sidebarOpen));
    toggleBtn.setAttribute("aria-label", sidebarOpen ? "Close menu" : "Open menu");
    collapseBtn?.setAttribute("aria-expanded", String(sidebarOpen));

    if (scrim) {
      scrim.hidden = !sidebarOpen;
      scrim.setAttribute("aria-hidden", String(!sidebarOpen));
    }
  }

  function openSidebar({ focusPanel = null } = {}) {
    sidebarOpen = true;
    syncSidebarState();

    if (focusPanel) {
      openPanel(focusPanel);
    }
  }

  function closeSidebar() {
    sidebarOpen = false;
    syncSidebarState();
  }

  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    syncSidebarState();
  }

  function openPanel(panelId) {
    const panelMap = {
      personal: {
        toggle: document.getElementById("sidebarPersonalToggle"),
        body: document.getElementById("sidebarPersonalBody"),
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
  collapseBtn?.addEventListener("click", closeSidebar);
  scrim?.addEventListener("click", closeSidebar);

  openStudioBtn?.addEventListener("click", () => {
    window.AchieveMateViews?.setActiveView("studio");
    closeSidebar();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && sidebarOpen) {
      closeSidebar();
    }
  });

  syncSidebarState();

  window.AchieveMateSidebar = {
    expand: openSidebar,
    collapse: closeSidebar,
    refreshIdentitySummary: () => window.AchieveMateApp?.updateSidebarIdentitySummary?.(),
  };
})();
