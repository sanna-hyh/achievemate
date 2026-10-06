(function initCvHistory() {
  const MAX_STEPS = 60;
  const SUPPRESS_MS = 450;
  const undoBtn = document.getElementById("cvUndoBtn");
  const redoBtn = document.getElementById("cvRedoBtn");

  let stack = [];
  let index = -1;
  let applying = false;
  let suppressUntil = 0;
  let lastRecordAt = 0;
  const listeners = new Set();

  function getApp() {
    return window.AchieveMateApp;
  }

  function cloneCvState() {
    const { state } = getApp() || {};
    if (!state) {
      return null;
    }

    return {
      cvLayout: JSON.parse(JSON.stringify(state.cvLayout || [])),
      cvLibrary: JSON.parse(JSON.stringify(state.cvLibrary || [])),
      cvPreviewEdits: JSON.parse(
        JSON.stringify(state.cvPreviewEdits || { personal: {}, items: {} })
      ),
      personalInfo: JSON.parse(
        JSON.stringify(state.personalInfo || { name: "", phone: "", email: "" })
      ),
    };
  }

  function sameSnapshot(a, b) {
    if (!a || !b) {
      return false;
    }
    return (
      JSON.stringify({
        cvLayout: a.cvLayout,
        cvLibrary: a.cvLibrary,
        cvPreviewEdits: a.cvPreviewEdits,
        personalInfo: a.personalInfo,
      }) ===
      JSON.stringify({
        cvLayout: b.cvLayout,
        cvLibrary: b.cvLibrary,
        cvPreviewEdits: b.cvPreviewEdits,
        personalInfo: b.personalInfo,
      })
    );
  }

  function notify() {
    listeners.forEach((listener) => {
      try {
        listener({
          canUndo: index > 0,
          canRedo: index >= 0 && index < stack.length - 1,
        });
      } catch (error) {
        console.warn("CV history listener failed:", error);
      }
    });
    syncButtons();
  }

  function syncButtons() {
    if (undoBtn) {
      undoBtn.disabled = index <= 0;
    }
    if (redoBtn) {
      redoBtn.disabled = index < 0 || index >= stack.length - 1;
    }
  }

  function toastHistory(message) {
    window.AchieveMateToast?.show(message, { tone: "neutral" });
  }

  function applySnapshot(entry) {
    const app = getApp();
    if (!app?.state || !entry) {
      return;
    }

    applying = true;
    suppressUntil = performance.now() + SUPPRESS_MS;
    app.state.cvLayout = JSON.parse(JSON.stringify(entry.cvLayout));
    app.state.cvLibrary = JSON.parse(JSON.stringify(entry.cvLibrary || []));
    app.state.cvPreviewEdits = JSON.parse(JSON.stringify(entry.cvPreviewEdits));
    app.state.personalInfo = JSON.parse(JSON.stringify(entry.personalInfo));
    app.saveState();
    app.refreshPersonalForm?.();
    window.AchieveMateCvBuilder?.render?.();
    window.AchieveMateCvPreview?.render?.();
    window.AchieveMateCvPreview?.syncLibraryStars?.();
    window.AchieveMateCvPreview?.scheduleSmartLayout?.();
    window.AchieveMateCvPreview?.scheduleFitPreview?.();
    applying = false;
    // Keep suppress a bit after async layout/blur settles.
    suppressUntil = performance.now() + SUPPRESS_MS;
    notify();
  }

  function record(label = "Edit") {
    if (applying || performance.now() < suppressUntil) {
      return false;
    }

    const snapshot = cloneCvState();
    if (!snapshot) {
      return false;
    }

    const now = performance.now();
    const entry = { label: String(label || "Edit"), ...snapshot };

    if (index >= 0 && sameSnapshot(stack[index], entry)) {
      return false;
    }

    // Replace tip for rapid repeats of the same action (e.g. continuous typing commits).
    if (
      index >= 0 &&
      stack[index].label === entry.label &&
      now - lastRecordAt < 700 &&
      entry.label === "Edit text"
    ) {
      stack[index] = entry;
      lastRecordAt = now;
      notify();
      return true;
    }

    stack = stack.slice(0, index + 1);
    stack.push(entry);
    if (stack.length > MAX_STEPS) {
      stack.shift();
    }
    index = stack.length - 1;
    lastRecordAt = now;
    notify();
    return true;
  }

  function seed() {
    stack = [];
    index = -1;
    lastRecordAt = 0;
    suppressUntil = 0;
    applying = false;
    const snapshot = cloneCvState();
    if (!snapshot) {
      return;
    }
    stack.push({ label: "Start", ...snapshot });
    index = 0;
    notify();
  }

  function undo() {
    if (index <= 0) {
      return false;
    }
    const undone = stack[index];
    index -= 1;
    applySnapshot(stack[index]);
    toastHistory(`Undid ${undone?.label || "Edit"}`);
    return true;
  }

  function redo() {
    if (index < 0 || index >= stack.length - 1) {
      return false;
    }
    index += 1;
    const redone = stack[index];
    applySnapshot(stack[index]);
    toastHistory(`Redid ${redone?.label || "Edit"}`);
    return true;
  }

  function subscribe(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    listeners.add(listener);
    listener({
      canUndo: index > 0,
      canRedo: index >= 0 && index < stack.length - 1,
    });
    return () => listeners.delete(listener);
  }

  function isEditableTarget(target) {
    if (!(target instanceof Element)) {
      return false;
    }
    return Boolean(
      target.closest(
        'input, textarea, select, [contenteditable="true"], [contenteditable=""]'
      )
    );
  }

  undoBtn?.addEventListener("click", () => {
    undo();
  });

  redoBtn?.addEventListener("click", () => {
    redo();
  });

  document.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) {
      return;
    }

    const key = event.key.toLowerCase();
    const isUndo = key === "z" && !event.shiftKey;
    const isRedo = key === "y" || (key === "z" && event.shiftKey);

    if (!isUndo && !isRedo) {
      return;
    }

    // Let native field undo work while typing inside an editable.
    if (isEditableTarget(event.target)) {
      return;
    }

    if (!document.body.classList.contains("is-studio-view")) {
      return;
    }

    if (isUndo && index > 0) {
      event.preventDefault();
      undo();
    } else if (isRedo && index >= 0 && index < stack.length - 1) {
      event.preventDefault();
      redo();
    }
  });

  window.AchieveMateCvHistory = {
    record,
    seed,
    undo,
    redo,
    subscribe,
    canUndo: () => index > 0,
    canRedo: () => index >= 0 && index < stack.length - 1,
    isApplying: () => applying || performance.now() < suppressUntil,
  };

  if (getApp()?.state) {
    seed();
  } else {
    window.addEventListener(
      "load",
      () => {
        if (stack.length === 0) {
          seed();
        }
      },
      { once: true }
    );
  }

  syncButtons();
})();
