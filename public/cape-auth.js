/**
 * Client-side Firebase Authentication (Google & Apple Sign-In) for
 * Cape May Dispatch (`cape-dispatch` Firebase project).
 * Loaded as an external module on /login, /account, /auth/google, and /auth/apple
 * so BROWSER_CSP remains free of 'unsafe-inline' in script-src.
 */
const statusEl = document.getElementById('auth-status');
const nextUrl = document.body?.dataset?.next || '/';
const autoProvider = document.body?.dataset?.autoProvider || '';

function setStatus(message, kind = 'error') {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = `status-msg ${kind}`;
}

async function exchangeIdToken(idToken) {
  setStatus('Verifying your Cape May Dispatch account…', 'ok');
  const res = await fetch('/api/auth/firebase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ id_token: idToken }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Sign-in failed (${res.status})`);
  }
  setStatus(`Signed in as ${data.user?.displayName || data.user?.username}. Redirecting…`, 'ok');
  window.location.assign(nextUrl);
}

async function initFirebaseAuth() {
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        if (window.firebase?.apps?.length) {
          await window.firebase.auth().signOut().catch(() => {});
        }
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
        window.location.assign('/login');
      } catch (err) {
        setStatus(err.message || 'Sign-out failed');
      }
    });
  }

  const deleteBtn = document.getElementById('btn-delete-account');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      const confirmed = window.confirm(
        'Permanently delete your Cape May Dispatch account? This action cannot be undone.',
      );
      if (!confirmed) return;
      try {
        const res = await fetch('/api/auth/delete-account', {
          method: 'POST',
          credentials: 'same-origin',
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Could not delete account');
        }
        if (window.firebase?.apps?.length) {
          await window.firebase.auth().signOut().catch(() => {});
        }
        setStatus('Your account has been permanently deleted.', 'ok');
        setTimeout(() => window.location.assign('/login'), 1200);
      } catch (err) {
        setStatus(err.message || 'Account deletion failed');
      }
    });
  }

  const googleBtn = document.getElementById('btn-google');
  const appleBtn = document.getElementById('btn-apple');
  if (!googleBtn && !appleBtn) return;

  let cfg;
  try {
    const res = await fetch('/api/auth/firebase-config', { credentials: 'same-origin' });
    cfg = await res.json();
  } catch {
    setStatus('Unable to load sign-in configuration. Please try again.');
    return;
  }

  if (!cfg?.enabled || !cfg?.apiKey) {
    setStatus(
      'Firebase Web API key (FIREBASE_WEB_API_KEY) is not configured on this server yet.',
      'error',
    );
    return;
  }

  if (!window.firebase) {
    setStatus('Firebase Auth SDK failed to load. Check your connection.', 'error');
    return;
  }

  if (!window.firebase.apps.length) {
    window.firebase.initializeApp({
      apiKey: cfg.apiKey,
      authDomain: cfg.authDomain || `${cfg.projectId}.firebaseapp.com`,
      projectId: cfg.projectId || 'cape-dispatch',
      ...(cfg.appId ? { appId: cfg.appId } : {}),
    });
  }

  const auth = window.firebase.auth();

  // Complete redirect sign-in if returning from Google/Apple redirect
  try {
    const redirectResult = await auth.getRedirectResult();
    if (redirectResult?.user) {
      const token = await redirectResult.user.getIdToken();
      await exchangeIdToken(token);
      return;
    }
  } catch (err) {
    if (err?.message) setStatus(err.message, 'error');
  }

  async function startProviderSignIn(kind) {
    try {
      setStatus(`Connecting to ${kind === 'apple' ? 'Apple' : 'Google'}…`, 'ok');
      let provider;
      if (kind === 'apple') {
        provider = new window.firebase.auth.OAuthProvider('apple.com');
        provider.addScope('email');
        provider.addScope('name');
      } else {
        provider = new window.firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
      }
      try {
        const result = await auth.signInWithPopup(provider);
        if (result?.user) {
          const token = await result.user.getIdToken();
          await exchangeIdToken(token);
        }
      } catch (popupErr) {
        if (
          popupErr?.code === 'auth/popup-blocked' ||
          popupErr?.code === 'auth/operation-not-supported-in-this-environment'
        ) {
          await auth.signInWithRedirect(provider);
          return;
        }
        throw popupErr;
      }
    } catch (err) {
      setStatus(err?.message || 'Sign-in was cancelled or failed.', 'error');
    }
  }

  if (googleBtn) {
    googleBtn.addEventListener('click', () => startProviderSignIn('google'));
  }
  if (appleBtn) {
    appleBtn.addEventListener('click', () => startProviderSignIn('apple'));
  }

  if (autoProvider === 'google' || autoProvider === 'apple') {
    startProviderSignIn(autoProvider);
  }
}

initFirebaseAuth();
