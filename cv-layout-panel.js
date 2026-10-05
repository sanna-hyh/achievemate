(function initCvLayoutPanel() {
  const app = window.AchieveMateApp;
  if (!app) {
    return;
  }

  const { state, saveState, saveCvSettings, resetCvSettings, saveCustomDefaults } = app;
  const form = document.getElementById("cvLayoutForm");
  if (!form) {
    return;
  }

  const outputs = {
    baseFontSize: document.getElementById("layoutBaseFontSizeValue"),
    nameFontSize: document.getElementById("layoutNameFontSizeValue"),
    headingFontSize: document.getElementById("layoutHeadingFontSizeValue"),
    lineHeight: document.getElementById("layoutLineHeightValue"),
    sectionGap: document.getElementById("layoutSectionGapValue"),
    itemGap: document.getElementById("layoutItemGapValue"),
  };

  const colorInputs = {
    textColor: document.getElementById("layoutTextColor"),
    accentColor: document.getElementById("layoutAccentColor"),
  };

  const colorSwatches = {
    textColor: {
      button: document.getElementById("layoutTextColorSwatch"),
      preview: document.getElementById("layoutTextColorPreview"),
    },
    accentColor: {
      button: document.getElementById("layoutAccentColorSwatch"),
      preview: document.getElementById("layoutAccentColorPreview"),
    },
  };

  const autoFitFields = ["baseFontSize", "lineHeight", "sectionGap"];
  const spacingFields = [...autoFitFields, "itemGap"];
  let chipSettleTimer = null;

  function markOutputLive(name) {
    if (outputs[name]) {
      outputs[name].classList.add("is-live");
    }
  }

  function scheduleChipSettle() {
    window.clearTimeout(chipSettleTimer);
    chipSettleTimer = window.setTimeout(() => {
      Object.values(outputs).forEach((output) => output?.classList.remove("is-live"));
    }, 400);
  }

  function syncSliderFill(input) {
    if (!input) {
      return;
    }

    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    const ratio = max > min ? ((value - min) / (max - min)) * 100 : 0;
    input.style.setProperty("--slider-fill", `${ratio}%`);
  }

  function syncAllSliderFills() {
    form.querySelectorAll(".drawer-slider").forEach(syncSliderFill);
  }

  function syncColorSwatches() {
    Object.entries(colorInputs).forEach(([key, input]) => {
      const swatch = colorSwatches[key];
      if (!input || !swatch?.preview) {
        return;
      }
      swatch.preview.style.backgroundColor = input.value;
    });
  }

  function syncAutoFitUi() {
    const autoFitOn = form.autoFit.checked;

    form.querySelectorAll("[data-auto-fit-field]").forEach((row) => {
      row.classList.toggle("is-auto-overridden", autoFitOn);
    });
  }

  function syncFormFromState() {
    const styles = state.cvSettings;
    form.fontFamily.value = styles.fontFamily;
    form.baseFontSize.value = String(styles.baseFontSize);
    form.nameFontSize.value = String(styles.nameFontSize ?? 20);
    form.headingFontSize.value = String(styles.headingFontSize ?? 13);
    form.textColor.value = styles.textColor;
    form.accentColor.value = styles.accentColor;
    form.lineHeight.value = String(styles.lineHeight);
    form.sectionGap.value = String(styles.sectionGap);
    form.itemGap.value = String(styles.itemGap);

    const marginInput = form.querySelector(`input[name="pageMargin"][value="${styles.pageMargin}"]`);
    if (marginInput) {
      marginInput.checked = true;
    }

    const dividerInput = form.querySelector(
      `input[name="headingDivider"][value="${styles.headingDivider ?? "solid"}"]`
    );
    if (dividerInput) {
      dividerInput.checked = true;
    }

    form.autoFit.checked = styles.autoFit === true;
    syncColorSwatches();
    syncAutoFitUi();
    updateOutputs();
    syncAllSliderFills();
  }

  function updateOutputs() {
    const autoFitOn = form.autoFit.checked;

    if (autoFitOn) {
      outputs.baseFontSize.textContent = "auto";
      outputs.lineHeight.textContent = "auto";
      outputs.sectionGap.textContent = "auto";
    } else {
      outputs.baseFontSize.textContent = `${form.baseFontSize.value}pt`;
      outputs.lineHeight.textContent = Number(form.lineHeight.value).toFixed(2).replace(/\.?0+$/, "");
      outputs.sectionGap.textContent = `${form.sectionGap.value}px`;
    }

    outputs.nameFontSize.textContent = `${form.nameFontSize.value}pt`;
    outputs.headingFontSize.textContent = `${form.headingFontSize.value}pt`;
    outputs.itemGap.textContent = `${form.itemGap.value}px`;
  }

  function readFormIntoState() {
    state.cvSettings = {
      fontFamily: form.fontFamily.value,
      baseFontSize: Number(form.baseFontSize.value),
      nameFontSize: Number(form.nameFontSize.value),
      headingFontSize: Number(form.headingFontSize.value),
      textColor: form.textColor.value,
      accentColor: form.accentColor.value,
      lineHeight: Number(form.lineHeight.value),
      sectionGap: Number(form.sectionGap.value),
      itemGap: Number(form.itemGap.value),
      pageMargin: form.querySelector('input[name="pageMargin"]:checked')?.value || "normal",
      headingDivider: form.querySelector('input[name="headingDivider"]:checked')?.value || "solid",
      autoFit: form.autoFit.checked,
    };
    saveCvSettings();
    saveState();
  }

  function applyAndRefresh() {
    readFormIntoState();
    syncAutoFitUi();
    updateOutputs();
    syncAllSliderFills();

    if (window.AchieveMateCvPreview?.scheduleSmartLayout) {
      window.AchieveMateCvPreview.scheduleSmartLayout();
    } else if (window.AchieveMateCvPreview?.applyLayoutStyles) {
      window.AchieveMateCvPreview.applyLayoutStyles();
    }
  }

  function handleFormUpdate(event) {
    const { name, type } = event.target;

    if (name === "autoFit") {
      syncAutoFitUi();
      updateOutputs();
      applyAndRefresh();
      return;
    }

    if (name && spacingFields.includes(name) && form.autoFit.checked && type !== "checkbox") {
      form.autoFit.checked = false;
      syncAutoFitUi();
      updateOutputs();
    }

    if (event.target.classList?.contains("drawer-slider")) {
      syncSliderFill(event.target);
      if (name && outputs[name]) {
        markOutputLive(name);
        scheduleChipSettle();
      }
    }

    if (name === "textColor" || name === "accentColor") {
      syncColorSwatches();
    }

    applyAndRefresh();
  }

  form.addEventListener("input", handleFormUpdate);
  form.addEventListener("change", handleFormUpdate);

  Object.entries(colorSwatches).forEach(([key, swatch]) => {
    const input = colorInputs[key];
    if (!swatch?.button || !input) {
      return;
    }

    swatch.button.addEventListener("click", () => {
      input.click();
    });
  });

  function showToast(message, options = {}) {
    if (window.AchieveMateToast?.show) {
      window.AchieveMateToast.show(message, options);
    }
  }

  function refreshPreviewAfterReset() {
    syncFormFromState();

    if (window.AchieveMateCvPreview?.scheduleSmartLayout) {
      window.AchieveMateCvPreview.scheduleSmartLayout();
    } else if (window.AchieveMateCvPreview?.applyLayoutStyles) {
      window.AchieveMateCvPreview.applyLayoutStyles();
    }
  }

  const saveDefaultsBtn = document.getElementById("saveCvDefaultsBtn");
  if (saveDefaultsBtn) {
    saveDefaultsBtn.addEventListener("click", () => {
      readFormIntoState();
      saveCustomDefaults(state.cvSettings);
      showToast("Default style saved", { tone: "success" });
    });
  }

  const resetBtn = document.getElementById("resetCvSettingsBtn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      resetCvSettings();
      refreshPreviewAfterReset();
    });
  }

  syncFormFromState();

  if (window.AchieveMateCvPreview?.applyLayoutStyles) {
    window.AchieveMateCvPreview.applyLayoutStyles();
  }

  window.AchieveMateCvLayoutPanel = {
    syncFormFromState,
  };
})();
