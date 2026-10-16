import { supabase } from './supabase-client.js';

const $ = (id) => document.getElementById(id);

function setMessage(elementId, message, type = 'status') {
  const el = $(elementId);
  if (!el) return;
  el.textContent = message;
  el.dataset.type = type;
}

function isAdminUser(user) {
  return Boolean(user && user.app_metadata?.role === 'admin');
}

async function verifyAdminRole(user) {
  return isAdminUser(user);
}

async function getAdminUser() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return isAdminUser(data.session?.user) ? data.session.user : null;
}

function setAdminVisible(visible) {
  const loginArea = $('loginArea');
  const adminArea = $('adminArea');
  if (loginArea) loginArea.classList.toggle('hidden', visible);
  if (adminArea) adminArea.classList.toggle('hidden', !visible);
}

async function signInAdmin(event) {
  event.preventDefault();
  if (!supabase) {
    setMessage('loginMessage', 'Supabase is not configured. Add your project URL and publishable key in js/supabase/config/config.js.', 'error');
    return;
  }

  const button = event.currentTarget.querySelector('button[type="submit"]');
  const email = $('adminEmail').value.trim();
  const password = $('adminPassword').value;

  if (!email || !password) {
    setMessage('loginMessage', 'Email and password are required.', 'error');
    return;
  }

  button.disabled = true;
  setMessage('loginMessage', 'Signing in…');

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    const isAuthorized = await verifyAdminRole(data.user);
    if (!isAuthorized) {
      const { error: signOutError } = await supabase.auth.signOut();
      setAdminVisible(false);
      if (signOutError) throw signOutError;
      throw new Error('This account is not authorized for admin access.');
    }

    $('adminPassword').value = '';
    setMessage('loginMessage', 'Login successful.', 'success');
    setAdminVisible(true);
    if (window.refreshAdminDashboard) {
      await window.refreshAdminDashboard();
    }
  } catch (error) {
    console.error('Admin sign-in failed:', error);
    setMessage('loginMessage', `Login failed: ${error.message || 'Please try again.'}`, 'error');
  } finally {
    button.disabled = false;
  }
}

async function signOutAdmin() {
  if (!supabase) return;
  const button = $('logoutButton');
  if (button) button.disabled = true;

  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setAdminVisible(false);
    setMessage('loginMessage', 'Logout successful.', 'success');
  } catch (error) {
    console.error('Admin sign-out failed:', error);
    setMessage('adminMessage', `Logout failed: ${error.message || 'Please try again.'}`, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

async function initializeAdminAuth() {
  if (!supabase) {
    setAdminVisible(false);
    return;
  }

  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      throw error;
    }

    if (!data?.session?.user) {
      setAdminVisible(false);
      return;
    }

    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) throw refreshError;
    const user = refreshed.session?.user;

    if (isAdminUser(user)) {
      setAdminVisible(true);
      if (window.refreshAdminDashboard) {
        await window.refreshAdminDashboard();
      }
      return;
    }

    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) throw signOutError;
    setMessage('loginMessage', 'This account is not authorized for admin access.', 'error');
  } catch (error) {
    console.error('Admin session check failed:', error);
    setMessage('loginMessage', `Session check failed: ${error.message || 'Please sign in again.'}`, 'error');
  }

  setAdminVisible(false);
}

function bindAuthEvents() {
  const loginForm = $('adminLogin');
  if (loginForm) {
    loginForm.addEventListener('submit', signInAdmin);
  }

  const logoutButton = $('logoutButton');
  if (logoutButton) {
    logoutButton.addEventListener('click', signOutAdmin);
  }

  if (supabase) {
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setAdminVisible(false);
      } else if (event === 'TOKEN_REFRESHED') {
        const authorized = isAdminUser(session?.user);
        setAdminVisible(authorized);
        if (authorized) {
          setTimeout(() => window.refreshAdminDashboard?.(), 0);
        }
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  bindAuthEvents();
});

window.KHAN_FF_AUTH = {
  isAdminUser,
  getAdminUser,
  signInAdmin,
  signOutAdmin,
  initializeAdminAuth,
  verifyAdminRole,
};
