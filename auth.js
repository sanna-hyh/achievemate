import { supabase } from "./supabase-client.js";
import {
  migrateGuestDataToSupabase,
  clearAppDataLocalStorage,
} from "./guest-migration.js";

const AUTH_MESSAGES = {
  export: {
    title: "Sign in to export",
    caption: "Create a free account to download your CV as PDF and keep it synced.",
  },
  save: {
    title: "Sign in to save",
    caption: "Create a free account so your library and CV are saved for next time.",
  },
};

let authModalRoot = null;
let isAuthed = false;
let pendingAuthResolve = null;
let pendingAuthCallback = null;

const signOutBtn = document.getElementById("signOutBtn");
const topbarSignOutBtn = document.getElementById("topbarSignOutBtn");
const saveAccountBtn = document.getElementById("saveAccountBtn");

function removeAuthModal() {
  authModalRoot?.remove();
  authModalRoot = null;
}

function resolvePendingAuth(success) {
  if (success && pendingAuthCallback) {
    pendingAuthCallback();
  }
  pendingAuthCallback = null;

  if (pendingAuthResolve) {
    pendingAuthResolve(success);
    pendingAuthResolve = null;
  }
}

function showAuthModal(reason = "save") {
  removeAuthModal();

  const copy = AUTH_MESSAGES[reason] || AUTH_MESSAGES.save;
  const allowDismiss = reason !== "export";
  const dismissButton = allowDismiss
    ? `<button type="button" class="btn btn-ghost" id="authCancelBtn">Continue without an account</button>`
    : "";

  authModalRoot = document.createElement("div");
  authModalRoot.className = "modal-root auth-modal-root";
  authModalRoot.innerHTML = `
    <div class="modal-overlay auth-modal-overlay" aria-hidden="true"></div>
    <section
      class="modal-panel auth-modal-panel identity-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <header class="identity-card-header">
        <span class="label" id="auth-modal-title">${copy.title}</span>
        <span class="caption">${copy.caption}</span>
      </header>
      <form class="auth-form" id="authForm" novalidate>
        <label class="identity-field identity-field-full">
          <span class="label">Email</span>
          <input class="field-input" type="email" name="email" autocomplete="email" required placeholder="you@example.com" />
        </label>
        <label class="identity-field identity-field-full">
          <span class="label">Password</span>
          <input class="field-input" type="password" name="password" autocomplete="current-password" required placeholder="Your password" />
        </label>
        <p class="auth-error" id="authError" hidden></p>
        <p class="auth-success caption" id="authSuccess" hidden></p>
        <div class="auth-actions">
          <button type="submit" class="btn btn-primary">Sign in</button>
          <button type="button" class="btn btn-ghost" id="authCreateBtn">Create account</button>
          ${dismissButton}
        </div>
      </form>
    </section>
  `;

  document.body.appendChild(authModalRoot);

  const form = authModalRoot.querySelector("#authForm");
  const emailInput = authModalRoot.querySelector('[name="email"]');
  const passwordInput = authModalRoot.querySelector('[name="password"]');
  const errorEl = authModalRoot.querySelector("#authError");
  const successEl = authModalRoot.querySelector("#authSuccess");
  const createBtn = authModalRoot.querySelector("#authCreateBtn");
  const cancelBtn = authModalRoot.querySelector("#authCancelBtn");
  const overlay = authModalRoot.querySelector(".auth-modal-overlay");

  function clearMessages() {
    errorEl.hidden = true;
    errorEl.textContent = "";
    successEl.hidden = true;
    successEl.textContent = "";
  }

  function showError(message) {
    successEl.hidden = true;
    successEl.textContent = "";
    errorEl.hidden = false;
    errorEl.textContent = message;
  }

  function showSuccess(message) {
    errorEl.hidden = true;
    errorEl.textContent = "";
    successEl.hidden = false;
    successEl.textContent = message;
  }

  function closeModal() {
    removeAuthModal();
    resolvePendingAuth(false);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessages();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      showError(error.message);
    }
  });

  createBtn.addEventListener("click", async () => {
    clearMessages();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
      showError(error.message);
      return;
    }

    showSuccess("Check your email to confirm your account, then sign in.");
  });

  cancelBtn?.addEventListener("click", closeModal);

  if (allowDismiss) {
    overlay.addEventListener("click", closeModal);

    document.addEventListener(
      "keydown",
      function onEscape(event) {
        if (event.key === "Escape" && authModalRoot) {
          document.removeEventListener("keydown", onEscape);
          closeModal();
        }
      },
      { once: false }
    );
  }

  emailInput.focus();
}

async function signOut() {
  await supabase.auth.signOut();
}

function bindSignOutButtons() {
  signOutBtn?.addEventListener("click", signOut);
  topbarSignOutBtn?.addEventListener("click", signOut);
}

function bindSaveAccountButton() {
  saveAccountBtn?.addEventListener("click", () => {
    window.AchieveMateAuth?.requireAuth({ reason: "save" });
  });
}

function updateAccountStatus() {
  const statusEl = document.getElementById("sidebarAccountStatus");
  if (!statusEl) {
    return;
  }

  statusEl.textContent = isAuthed
    ? "Signed in · synced to cloud"
    : "Not signed in · saved locally";
}

function updateAuthChrome() {
  updateAccountStatus();

  if (isAuthed) {
    saveAccountBtn?.setAttribute("hidden", "");
    signOutBtn?.removeAttribute("hidden");
    topbarSignOutBtn?.removeAttribute("hidden");
    return;
  }

  saveAccountBtn?.removeAttribute("hidden");
  signOutBtn?.setAttribute("hidden", "");
  topbarSignOutBtn?.setAttribute("hidden", "");
}

async function onAuthed(sessionUser, { fromModal = false } = {}) {
  const firstSignIn = !isAuthed;
  isAuthed = true;

  removeAuthModal();
  updateAuthChrome();

  if (firstSignIn) {
    await migrateGuestDataToSupabase(sessionUser);
    document.dispatchEvent(
      new CustomEvent("achievemate:authed", { detail: { user: sessionUser } })
    );
  }

  if (fromModal) {
    resolvePendingAuth(true);
  }
}

function requireAuth({ reason = "save", onSuccess } = {}) {
  if (isAuthed) {
    onSuccess?.();
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    pendingAuthResolve = resolve;
    pendingAuthCallback = onSuccess || null;
    showAuthModal(reason);
  });
}

async function initAuth() {
  bindSignOutButtons();
  bindSaveAccountButton();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session?.user) {
    await onAuthed(session.user);
    return;
  }

  updateAuthChrome();
}

supabase.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_OUT") {
    clearAppDataLocalStorage();
    window.location.reload();
    return;
  }

  if (event === "SIGNED_IN" && session?.user) {
    onAuthed(session.user, { fromModal: Boolean(pendingAuthResolve) });
  }
});

initAuth();

window.AchieveMateAuth = {
  isSignedIn: () => isAuthed,
  requireAuth,
  showAuthModal,
  signOut,
};
