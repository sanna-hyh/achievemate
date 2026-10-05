import { supabase, describeSupabaseOutage } from "./supabase-client.js";
import {
  migrateGuestDataToSupabase,
  readGuestPayload,
  MIGRATION_FLAG,
} from "./guest-migration.js";

const DEBOUNCE_MS = 1200;
const STORAGE_KEY = "achievemate-data";
const CV_SETTINGS_STORAGE_KEY = "achievemate_cv_settings";
const CUSTOM_DEFAULTS_STORAGE_KEY = "achievemate_custom_defaults";
const MAX_PROOF_SIZE = 5242880;
const PROOF_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

let currentUser = null;
let debounceTimer = null;
let pushInFlight = false;
let retryTimer = null;
let retryAttempt = 0;
let bootRetried = false;
let bootStarted = false;
let lastErrorToastAt = 0;

const lastPushed = {
  profile: null,
  achievements: [],
  cvDoc: null,
};

const RETRY_DELAYS = [5000, 15000, 60000];

function getApp() {
  return window.AchieveMateApp;
}

function showToast(message, options) {
  window.AchieveMateToast?.show(message, options);
}

function markPending() {
  window.AchieveMateSaveStatus?.markPending();
}

function markComplete() {
  window.AchieveMateSaveStatus?.markComplete();
}

function finishBoot() {
  window.AchieveMateApp?.finishLogbookLoading?.();
}

function sanitizeProofFileName(name) {
  const base = String(name || "proof")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "");

  return (base || "proof").slice(0, 100);
}

function validateProofFile(file) {
  if (!file) {
    return false;
  }

  if (file.size > MAX_PROOF_SIZE || !PROOF_MIME_TYPES.has(file.type)) {
    showToast("Proof must be a PDF, image, or Word file under 5 MB", { tone: "danger" });
    return false;
  }

  return true;
}

function isWhitelistedBlob(blob) {
  return blob.size <= MAX_PROOF_SIZE && PROOF_MIME_TYPES.has(blob.type);
}

function achievementRowToState(row) {
  return {
    id: row.client_id,
    title: row.title || "",
    date: row.date_label || "",
    category: window.AchieveMateApp?.normalizeAchievementCategory?.(row.category) || "others",
    starred: Boolean(row.starred),
    description: row.description || "",
    showDescription: row.show_description ?? true,
    fileName: row.proof_name || "",
    fileType: row.proof_type || "",
    proofPath: row.proof_path || "",
    fileData: "",
  };
}

function achievementStateToRow(achievement, index) {
  return {
    user_id: currentUser.id,
    client_id: achievement.id,
    title: achievement.title || "",
    date_label: achievement.date || "",
    category: window.AchieveMateApp?.normalizeAchievementCategory?.(achievement.category) || "others",
    starred: Boolean(achievement.starred),
    description: achievement.description || "",
    show_description: achievement.showDescription ?? true,
    proof_name: achievement.fileName || "",
    proof_type: achievement.fileType || "",
    proof_path: achievement.proofPath || "",
    position: index,
  };
}

function buildProfilePayload(state) {
  return {
    full_name: state.personalInfo.name || "",
    phone: state.personalInfo.phone || "",
    contact_email: state.personalInfo.email || "",
  };
}

function buildCvDocPayload(state, getCustomDefaults) {
  return {
    layout: state.cvLayout,
    preview_edits: state.cvPreviewEdits,
    settings: state.cvSettings,
    custom_defaults: getCustomDefaults() || {},
  };
}

function applyServerState(profileRow, achievementRows, cvDocRow, exportRows) {
  const app = getApp();
  if (!app) {
    return;
  }

  const { state, DEFAULT_CV_SETTINGS } = app;

  if (profileRow) {
    state.personalInfo = {
      name: profileRow.full_name || "",
      phone: profileRow.phone || "",
      email: profileRow.contact_email || "",
    };
  }

  state.achievements = (achievementRows || []).map(achievementRowToState);
  state.cvLayout = cvDocRow?.layout || [];
  state.cvPreviewEdits = cvDocRow?.preview_edits || { personal: {}, items: {} };
  state.cvSettings = { ...DEFAULT_CV_SETTINGS, ...(cvDocRow?.settings || {}) };
  state.exportHistory = (exportRows || []).map((row) => ({
    id: row.id,
    fileName: row.file_name,
    exportedAt: row.exported_at,
    snapshot: row.snapshot,
  }));

  if (cvDocRow?.custom_defaults && Object.keys(cvDocRow.custom_defaults).length > 0) {
    localStorage.setItem(CUSTOM_DEFAULTS_STORAGE_KEY, JSON.stringify(cvDocRow.custom_defaults));
  }

  localStorage.setItem(CV_SETTINGS_STORAGE_KEY, JSON.stringify(state.cvSettings));
  app.saveState({ skipSync: true });
  app.refreshPersonalForm?.();
  app.renderAchievements?.();

  if (window.AchieveMateCvLayoutPanel) {
    window.AchieveMateCvLayoutPanel.syncFormFromState?.();
  }
  if (window.AchieveMateCvBuilder) {
    window.AchieveMateCvBuilder.render();
  }
  if (window.AchieveMateCvPreview) {
    window.AchieveMateCvPreview.render();
    window.AchieveMateCvPreview.renderExportHistory?.();
  }

  lastPushed.profile = buildProfilePayload(state);
  lastPushed.achievements = state.achievements.map((item) => ({ ...item }));
  lastPushed.cvDoc = JSON.stringify(buildCvDocPayload(state, app.getCustomDefaults));
}

function hasLocalData() {
  return Boolean(readGuestPayload());
}

function serverHasData(achievementRows, cvDocRow) {
  return (
    (achievementRows?.length ?? 0) > 0 ||
    (Array.isArray(cvDocRow?.layout) && cvDocRow.layout.length > 0)
  );
}

async function removeProofPaths(paths) {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  if (uniquePaths.length === 0) {
    return;
  }

  const { error } = await supabase.storage.from("proofs").remove(uniquePaths);
  if (error) {
    console.warn("Could not remove proof file(s):", error.message);
  }
}

async function uploadProofFile(file, achievementClientId, oldPath = "") {
  if (!currentUser) {
    throw new Error("Not signed in");
  }

  if (!validateProofFile(file)) {
    throw new Error("Invalid proof file");
  }

  const sanitized = sanitizeProofFileName(file.name);
  const path = `${currentUser.id}/${achievementClientId}/${Date.now()}_${sanitized}`;

  const { error } = await supabase.storage.from("proofs").upload(path, file, {
    contentType: file.type,
    upsert: false,
  });

  if (error) {
    throw error;
  }

  if (oldPath) {
    await removeProofPaths([oldPath]);
  }

  return {
    proofPath: path,
    fileName: file.name,
    fileType: file.type,
  };
}

async function openProof(achievement) {
  if (achievement.proofPath) {
    const { data, error } = await supabase.storage
      .from("proofs")
      .createSignedUrl(achievement.proofPath, 120);

    if (error || !data?.signedUrl) {
      showToast("Could not open proof file", { tone: "danger" });
      return;
    }

    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    return;
  }

  if (achievement.fileData) {
    window.open(achievement.fileData, "_blank", "noopener,noreferrer");
  }
}

async function pushAchievements(state) {
  const currentIds = new Set(state.achievements.map((item) => item.id));
  const previousById = new Map(lastPushed.achievements.map((item) => [item.id, item]));
  const removed = lastPushed.achievements.filter((item) => !currentIds.has(item.id));

  if (removed.length > 0) {
    const removedIds = removed.map((item) => item.id);
    const { error: deleteError } = await supabase
      .from("achievements")
      .delete()
      .eq("user_id", currentUser.id)
      .in("client_id", removedIds);

    if (deleteError) {
      throw deleteError;
    }

    await removeProofPaths(removed.map((item) => item.proofPath));
  }

  const changedOrNew = state.achievements.filter((achievement, index) => {
    const previous = previousById.get(achievement.id);
    if (!previous) {
      return true;
    }

    const row = achievementStateToRow(achievement, index);
    const prevRow = achievementStateToRow(previous, index);
    return JSON.stringify(row) !== JSON.stringify(prevRow);
  });

  if (changedOrNew.length > 0) {
    const rows = changedOrNew.map((achievement) => {
      const index = state.achievements.findIndex((item) => item.id === achievement.id);
      return achievementStateToRow(achievement, index);
    });

    const { error: upsertError } = await supabase
      .from("achievements")
      .upsert(rows, { onConflict: "user_id,client_id" });

    if (upsertError) {
      throw upsertError;
    }
  }

  lastPushed.achievements = state.achievements.map((item) => ({ ...item }));
}

async function pushToServer() {
  if (!currentUser || pushInFlight) {
    return;
  }

  const app = getApp();
  if (!app) {
    return;
  }

  const { state, getCustomDefaults } = app;
  pushInFlight = true;

  try {
    const profilePayload = buildProfilePayload(state);
    if (JSON.stringify(profilePayload) !== JSON.stringify(lastPushed.profile)) {
      const { error } = await supabase
        .from("profiles")
        .update(profilePayload)
        .eq("id", currentUser.id);

      if (error) {
        throw error;
      }

      lastPushed.profile = profilePayload;
    }

    await pushAchievements(state);

    const cvPayload = buildCvDocPayload(state, getCustomDefaults);
    const cvSerialized = JSON.stringify(cvPayload);
    if (cvSerialized !== lastPushed.cvDoc) {
      const { error } = await supabase
        .from("cv_documents")
        .update(cvPayload)
        .eq("user_id", currentUser.id);

      if (error) {
        throw error;
      }

      lastPushed.cvDoc = cvSerialized;
    }

    retryAttempt = 0;
    if (retryTimer) {
      window.clearTimeout(retryTimer);
      retryTimer = null;
    }

    markComplete();
  } catch (error) {
    console.warn("Sync push failed:", error);

    const now = Date.now();
    if (now - lastErrorToastAt > 3000) {
      lastErrorToastAt = now;
      showToast(error.message || "Could not sync changes", { tone: "danger" });
    }

    scheduleRetry();
  } finally {
    pushInFlight = false;
  }
}

function scheduleRetry() {
  if (retryTimer) {
    return;
  }

  const delay = RETRY_DELAYS[Math.min(retryAttempt, RETRY_DELAYS.length - 1)];
  retryAttempt += 1;

  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    pushToServer();
  }, delay);
}

function queuePush() {
  if (!currentUser) {
    markComplete();
    return;
  }

  markPending();
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    debounceTimer = null;
    pushToServer();
  }, DEBOUNCE_MS);
}

async function insertExportHistory(fileName, snapshot) {
  if (!currentUser) {
    return;
  }

  const { data, error } = await supabase
    .from("export_history")
    .insert({
      user_id: currentUser.id,
      file_name: fileName,
      snapshot,
    })
    .select("id")
    .single();

  if (error) {
    showToast("Could not save export history", { tone: "danger" });
    return null;
  }

  return data?.id || null;
}

async function deleteExportHistory(entryId) {
  if (!currentUser || !entryId) {
    return;
  }

  const { error } = await supabase.from("export_history").delete().eq("id", entryId);
  if (error) {
    showToast("Could not delete export history", { tone: "danger" });
  }
}

async function bootFetch() {
  const [profileResult, achievementsResult, cvDocResult, exportResult] = await Promise.all([
    supabase.from("profiles").select("*").single(),
    supabase.from("achievements").select("*").order("position"),
    supabase.from("cv_documents").select("*").single(),
    supabase
      .from("export_history")
      .select("*")
      .order("exported_at", { ascending: false })
      .limit(20),
  ]);

  const errors = [
    profileResult.error,
    achievementsResult.error,
    cvDocResult.error,
    exportResult.error,
  ].filter(Boolean);

  if (errors.length > 0) {
    throw errors[0];
  }

  return {
    profile: profileResult.data,
    achievements: achievementsResult.data || [],
    cvDoc: cvDocResult.data,
    exportHistory: exportResult.data || [],
  };
}

async function handleBoot(user) {
  if (bootStarted) {
    return;
  }
  bootStarted = true;

  currentUser = user;

  try {
    const data = await bootFetch();

    if (serverHasData(data.achievements, data.cvDoc)) {
      applyServerState(data.profile, data.achievements, data.cvDoc, data.exportHistory);
    } else if (hasLocalData() && localStorage.getItem(MIGRATION_FLAG) !== "true") {
      await migrateGuestDataToSupabase(user);
    } else {
      const app = getApp();
      if (app) {
        lastPushed.profile = buildProfilePayload(app.state);
        lastPushed.achievements = app.state.achievements.map((item) => ({ ...item }));
        lastPushed.cvDoc = JSON.stringify(buildCvDocPayload(app.state, app.getCustomDefaults));
      }
    }
  } catch (error) {
    console.warn("Boot fetch failed:", error);
    showToast(describeSupabaseOutage(error), { tone: "danger" });

    if (!bootRetried) {
      bootRetried = true;
      window.setTimeout(() => {
        bootStarted = false;
        handleBoot(user);
      }, 5000);
    }
  } finally {
    finishBoot();
  }
}

document.addEventListener("achievemate:authed", (event) => {
  handleBoot(event.detail.user);
});

window.AchieveMateSync = {
  queuePush,
  uploadProofFile,
  openProof,
  validateProofFile,
  insertExportHistory,
  deleteExportHistory,
  handleBoot,
};
