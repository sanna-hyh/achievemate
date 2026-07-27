import { supabase } from "./supabase-client.js";

/** Primary guest snapshot key (spec). Legacy keys are read as fallback. */
export const GUEST_STORAGE_KEY = "achievemate_guest_data";
export const LEGACY_STORAGE_KEY = "achievemate-data";
export const CV_SETTINGS_STORAGE_KEY = "achievemate_cv_settings";
export const CUSTOM_DEFAULTS_STORAGE_KEY = "achievemate_custom_defaults";
export const MIGRATION_FLAG = "achievemate-migrated-v1";

const MAX_PROOF_SIZE = 5242880;
const PROOF_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const GUEST_KEYS = [
  GUEST_STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  CV_SETTINGS_STORAGE_KEY,
  CUSTOM_DEFAULTS_STORAGE_KEY,
];

function log(...args) {
  console.log("[AchieveMate migration]", ...args);
}

function warn(...args) {
  console.warn("[AchieveMate migration]", ...args);
}

function sanitizeProofFileName(name) {
  const base = String(name || "proof")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "");

  return (base || "proof").slice(0, 100);
}

function isWhitelistedBlob(blob) {
  return blob.size <= MAX_PROOF_SIZE && PROOF_MIME_TYPES.has(blob.type);
}

async function uploadProofFile(userId, file, achievementClientId) {
  const sanitized = sanitizeProofFileName(file.name);
  const path = `${userId}/${achievementClientId}/${Date.now()}_${sanitized}`;

  const { error } = await supabase.storage.from("proofs").upload(path, file, {
    contentType: file.type,
    upsert: false,
  });

  if (error) {
    throw error;
  }

  return { proofPath: path, fileName: file.name, fileType: file.type };
}

/**
 * Read guest payload from localStorage.
 * Supports the canonical guest key, legacy app key, and array-only dumps.
 */
export function readGuestPayload() {
  const rawGuest = localStorage.getItem(GUEST_STORAGE_KEY);
  if (rawGuest) {
    try {
      return normalizeGuestPayload(JSON.parse(rawGuest));
    } catch (error) {
      warn("Could not parse guest data:", error.message);
    }
  }

  const rawLegacy = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!rawLegacy) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawLegacy);
    let cvSettings = parsed.cvSettings || {};
    const savedSettings = localStorage.getItem(CV_SETTINGS_STORAGE_KEY);
    if (savedSettings) {
      cvSettings = { ...cvSettings, ...JSON.parse(savedSettings) };
    }

    let customDefaults = {};
    const savedDefaults = localStorage.getItem(CUSTOM_DEFAULTS_STORAGE_KEY);
    if (savedDefaults) {
      customDefaults = JSON.parse(savedDefaults);
    }

    return normalizeGuestPayload({
      ...parsed,
      cvSettings,
      customDefaults,
    });
  } catch (error) {
    warn("Could not parse legacy local data:", error.message);
    return null;
  }
}

function normalizeGuestPayload(raw) {
  if (!raw) {
    return null;
  }

  if (Array.isArray(raw)) {
    const achievements = raw.filter((item) => item?.type === "achievement" || item?.id);
    const cvDraft = raw.find((item) => item?.type === "cv_draft" || item?.type === "cv_document");
    return {
      personalInfo: cvDraft?.personalInfo || { name: "", phone: "", email: "" },
      achievements: achievements.map((item) => ({
        id: item.client_id || item.id || `ach-${Date.now()}`,
        title: item.title || "",
        date: item.date || item.date_label || "",
        description: item.description || "",
        showDescription: item.show_description ?? item.showDescription ?? true,
        fileName: item.fileName || item.proof_name || "",
        fileType: item.fileType || item.proof_type || "",
        fileData: item.fileData || "",
        proofPath: item.proofPath || item.proof_path || "",
      })),
      cvLayout: cvDraft?.layout || cvDraft?.cvLayout || [],
      cvPreviewEdits: cvDraft?.preview_edits || cvDraft?.cvPreviewEdits || { personal: {}, items: {} },
      cvSettings: cvDraft?.settings || cvDraft?.cvSettings || {},
      customDefaults: cvDraft?.custom_defaults || cvDraft?.customDefaults || {},
      exportHistory: cvDraft?.exportHistory || [],
    };
  }

  return {
    personalInfo: raw.personalInfo || { name: "", phone: "", email: "" },
    achievements: Array.isArray(raw.achievements) ? raw.achievements : [],
    cvLayout: Array.isArray(raw.cvLayout) ? raw.cvLayout : [],
    cvPreviewEdits: raw.cvPreviewEdits || { personal: {}, items: {} },
    cvSettings: raw.cvSettings || {},
    customDefaults: raw.customDefaults || {},
    exportHistory: Array.isArray(raw.exportHistory) ? raw.exportHistory : [],
  };
}

export function clearGuestLocalStorage() {
  GUEST_KEYS.forEach((key) => localStorage.removeItem(key));
}

export function isGuestLocalStorageEmpty() {
  return GUEST_KEYS.every((key) => !localStorage.getItem(key));
}

function buildProfilePayload(personalInfo) {
  return {
    full_name: personalInfo?.name || "",
    phone: personalInfo?.phone || "",
    contact_email: personalInfo?.email || "",
  };
}

function buildCvDocPayload(payload) {
  return {
    layout: payload.cvLayout || [],
    preview_edits: payload.cvPreviewEdits || { personal: {}, items: {} },
    settings: payload.cvSettings || {},
    custom_defaults: payload.customDefaults || {},
  };
}

function applyPayloadToApp(payload) {
  const app = window.AchieveMateApp;
  if (!app) {
    return;
  }

  const { state, DEFAULT_CV_SETTINGS, saveState } = app;

  state.personalInfo = { ...state.personalInfo, ...payload.personalInfo };
  state.achievements = payload.achievements.map((achievement) => ({
    ...achievement,
    fileData: "",
    proofPath: achievement.proofPath || "",
  }));
  state.cvLayout = payload.cvLayout;
  state.cvPreviewEdits = payload.cvPreviewEdits;
  state.cvSettings = { ...DEFAULT_CV_SETTINGS, ...payload.cvSettings };
  state.exportHistory = payload.exportHistory;

  if (payload.customDefaults && Object.keys(payload.customDefaults).length > 0) {
    localStorage.setItem(CUSTOM_DEFAULTS_STORAGE_KEY, JSON.stringify(payload.customDefaults));
  }

  saveState?.({ skipSync: true });
  app.refreshPersonalForm?.();
  app.renderAchievements?.();
  window.AchieveMateCvLayoutPanel?.syncFormFromState?.();
  window.AchieveMateCvBuilder?.render?.();
  window.AchieveMateCvPreview?.render?.();
}

/**
 * Migrate guest localStorage data into Supabase for the authenticated user.
 * Maps achievements → `achievements`, CV draft → `cv_documents` (not cv_drafts).
 */
export async function migrateGuestDataToSupabase(user, { silent = false } = {}) {
  if (!user?.id) {
    return { migrated: false, reason: "no-user" };
  }

  if (localStorage.getItem(MIGRATION_FLAG) === "true" && !localStorage.getItem(GUEST_STORAGE_KEY)) {
    return { migrated: false, reason: "already-migrated" };
  }

  const payload = readGuestPayload();
  if (!payload) {
    return { migrated: false, reason: "no-guest-data" };
  }

  const hasContent =
    payload.achievements.length > 0 ||
    payload.cvLayout.length > 0 ||
    Boolean(payload.personalInfo?.name?.trim()) ||
    Boolean(payload.personalInfo?.email?.trim());

  if (!hasContent) {
    return { migrated: false, reason: "empty-guest-data" };
  }

  log("Starting guest → Supabase migration for user", user.id.slice(0, 8));

  const errors = [];
  const skippedProofs = [];

  try {
    const profilePayload = buildProfilePayload(payload.personalInfo);
    const { error: profileError } = await supabase
      .from("profiles")
      .update(profilePayload)
      .eq("id", user.id);

    if (profileError) {
      throw profileError;
    }

    for (let index = 0; index < payload.achievements.length; index += 1) {
      const achievement = { ...payload.achievements[index] };
      let proofPath = achievement.proofPath || "";
      let proofName = achievement.fileName || "";
      let proofType = achievement.fileType || "";

      if (achievement.fileData?.startsWith("data:")) {
        try {
          const blob = await (await fetch(achievement.fileData)).blob();
          if (!isWhitelistedBlob(blob)) {
            skippedProofs.push(achievement.title || achievement.id);
          } else {
            const uploadName = proofName || "proof.bin";
            const file = new File([blob], uploadName, { type: blob.type || proofType });
            const uploaded = await uploadProofFile(user.id, file, achievement.id);
            proofPath = uploaded.proofPath;
            proofName = uploaded.fileName;
            proofType = uploaded.fileType;
          }
        } catch (proofError) {
          warn("Proof upload skipped for", achievement.id, proofError.message);
          skippedProofs.push(achievement.title || achievement.id);
        }
      }

      const row = {
        user_id: user.id,
        client_id: achievement.id,
        title: achievement.title || "",
        date_label: achievement.date || "",
        description: achievement.description || "",
        show_description: achievement.showDescription ?? true,
        proof_name: proofName,
        proof_type: proofType,
        proof_path: proofPath,
        position: index,
      };

      const { error } = await supabase
        .from("achievements")
        .upsert(row, { onConflict: "user_id,client_id" });

      if (error) {
        errors.push({ client_id: achievement.id, message: error.message });
        warn("Achievement upsert failed:", achievement.id, error.message);
      }
    }

    const cvPayload = buildCvDocPayload(payload);
    const { error: cvError } = await supabase
      .from("cv_documents")
      .update(cvPayload)
      .eq("user_id", user.id);

    if (cvError) {
      throw cvError;
    }

    const historyEntries = [...payload.exportHistory].slice(0, 20).reverse();
    for (const entry of historyEntries) {
      const { error: historyError } = await supabase.from("export_history").insert({
        user_id: user.id,
        file_name: entry.fileName,
        snapshot: entry.snapshot,
        exported_at: entry.exportedAt,
      });

      if (historyError) {
        errors.push({ export: entry.fileName, message: historyError.message });
        warn("Export history insert failed:", entry.fileName, historyError.message);
      }
    }

    localStorage.setItem(MIGRATION_FLAG, "true");
    clearGuestLocalStorage();
    applyPayloadToApp(payload);

    if (!silent) {
      window.AchieveMateToast?.show("Your logbook is now synced to your account", { tone: "success" });
      if (skippedProofs.length > 0) {
        window.AchieveMateToast?.show(
          `${skippedProofs.length} proof file(s) were too large to sync and stayed on this device`,
          { tone: "neutral" }
        );
      }
    }

    log("Migration complete", {
      achievements: payload.achievements.length,
      errors: errors.length,
      skippedProofs: skippedProofs.length,
      guestStorageEmpty: isGuestLocalStorageEmpty(),
    });

    return {
      migrated: true,
      achievements: payload.achievements.length,
      errors,
      skippedProofs,
      guestStorageEmpty: isGuestLocalStorageEmpty(),
    };
  } catch (error) {
    warn("Migration failed:", error.message);
    if (!silent) {
      window.AchieveMateToast?.show("Couldn't sync guest data — try again after signing in", {
        tone: "danger",
      });
    }
    return { migrated: false, reason: "write-error", error: error.message, partialErrors: errors };
  }
}

/**
 * Console verification helper for manual testing.
 * Usage (while signed in): await AchieveMateMigration.verifyDataMigration()
 */
export async function verifyDataMigration() {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    console.error("[verifyDataMigration] FAIL — sign in first, then re-run.");
    return false;
  }

  const userId = session.user.id;
  const dummyClientId = `verify-${Date.now()}`;

  const dummyPayload = {
    personalInfo: { name: "Verify User", phone: "+1 555 0100", email: "verify@achievemate.test" },
    achievements: [
      {
        id: dummyClientId,
        title: "Verify Migration Achievement",
        date: "Jul 2026",
        description: "Seeded by verifyDataMigration()",
        showDescription: true,
        fileName: "",
        fileType: "",
        fileData: "",
        proofPath: "",
      },
    ],
    cvLayout: [{ id: "blk-verify", type: "heading", title: "Verification Section" }],
    cvPreviewEdits: { personal: {}, items: {} },
    cvSettings: { baseFontSize: 11 },
    customDefaults: {},
    exportHistory: [],
  };

  console.group("[verifyDataMigration]");
  console.log("a) Seeding dummy guest data into localStorage…");
  localStorage.removeItem(MIGRATION_FLAG);
  localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(dummyPayload));

  console.log("b) Simulating post-auth migration…");
  const result = await migrateGuestDataToSupabase(session.user, { silent: true });
  console.log("   migration result:", result);

  console.log("c) Querying Supabase for seeded achievement…");
  const { data: rows, error: queryError } = await supabase
    .from("achievements")
    .select("client_id, title, user_id")
    .eq("user_id", userId)
    .eq("client_id", dummyClientId);

  if (queryError) {
    console.error("   query error:", queryError.message);
  } else {
    console.log("   rows:", rows);
  }

  const { data: cvDoc } = await supabase
    .from("cv_documents")
    .select("layout")
    .eq("user_id", userId)
    .single();

  console.log("d) Checking guest localStorage cleared…");
  const guestEmpty = isGuestLocalStorageEmpty();
  console.log("   guest keys empty:", guestEmpty, GUEST_KEYS);

  const rowOk = !queryError && rows?.length === 1 && rows[0].user_id === userId;
  const cvOk = Array.isArray(cvDoc?.layout) && cvDoc.layout.some((b) => b.id === "blk-verify");
  const pass = Boolean(result.migrated && rowOk && guestEmpty && cvOk);

  console.log(pass ? "PASS — migration verified" : "FAIL — see details above");
  console.groupEnd();

  return pass;
}

/** Vanilla-JS equivalent of a React `useAuth` migration effect. */
export function attachAuthMigrationListener() {
  const { data: subscription } = supabase.auth.onAuthStateChange(async (event, session) => {
    if (event !== "SIGNED_IN" && event !== "INITIAL_SESSION") {
      return;
    }

    if (!session?.user) {
      return;
    }

    await migrateGuestDataToSupabase(session.user);
  });

  return () => subscription.subscription.unsubscribe();
}

window.AchieveMateMigration = {
  migrateGuestDataToSupabase,
  verifyDataMigration,
  readGuestPayload,
  clearGuestLocalStorage,
  isGuestLocalStorageEmpty,
  attachAuthMigrationListener,
  GUEST_STORAGE_KEY,
};
