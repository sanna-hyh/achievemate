(function initCvHistory() {
  const MAX_STEPS = 60;
  const undoBtn = document.getElementById("cvUndoBtn");
  const redoBtn = document.getElementById("cvRedoBtn");

  let stack = [];
  let index = -1;
  let applying = false;
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
    return JSON.stringify(a) === JSON.stringify(b);
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

  function applySnapshot(snapshot) {
    const app = getApp();
    if (!app?.state || !snapshot) {
      return;
    }

    applying = true;
    app.state.cvLayout = JSON.parse(JSON.stringify(snapshot.cvLayout));
    app.state.cvLibrary = JSON.parse(JSON.stringify(snapshot.cvLibrary || []));
    app.state.cvPreviewEdits = JSON.parse(JSON.stringify(snapshot.cvPreviewEdits));
    app.state.personalInfo = JSON.parse(JSON.stringify(snapshot.personalInfo));
    app.saveState();
    app.refreshPersonalForm?.();
    window.AchieveMateCvBuilder?.render?.();
    window.AchieveMateCvPreview?.render?.();
    window.AchieveMateCvPreview?.syncLibraryStars?.();
    window.AchieveMateCvPreview?.scheduleSmartLayout?.();
    window.AchieveMateCvPreview?.scheduleFitPreview?.();
    applying = false;
    notify();
  }

  function record() {
    if (applying) {
      return false;
    }

    const snapshot = cloneCvState();
    if (!snapshot) {
      return false;
    }

    if (index >= 0 && sameSnapshot(stack[index], snapshot)) {
      return false;
    }

    stack = stack.slice(0, index + 1);
    stack.push(snapshot);
    if (stack.length > MAX_STEPS) {
      stack.shift();
    }
    index = stack.length - 1;
    notify();
    return true;
  }

  function seed() {
    stack = [];
    index = -1;
    record();
  }

  function undo() {
    if (index <= 0) {
      return false;
    }
    index -= 1;
    applySnapshot(stack[index]);
    return true;
  }

  function redo() {
    if (index < 0 || index >= stack.length - 1) {
      return false;
    }
    index += 1;
    applySnapshot(stack[index]);
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
    isApplying: () => applying,
  };

  // Baseline after app state is available.
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
