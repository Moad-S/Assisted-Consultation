// client/src/auth.js
const KEY = "auth";

function decodeJwt(token) {
  try {
    const base64 = token.split(".")[1];
    const json = atob(base64.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export const auth = {
  save(apiResponse) {
    // expects { token, user: { role, ... } }
    const { token, user } = apiResponse || {};
    if (!token || !user?.role) return;
    const payload = decodeJwt(token); // { exp, sub, email, role? }
    const data = {
      token,
      role: user.role,
      // store exp (seconds since epoch) if present
      exp: payload?.exp || null,
      user: { id: user.id, email: user.email, display_name: user.display_name },
    };
    localStorage.setItem(KEY, JSON.stringify(data));
  },

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  clear() {
    localStorage.removeItem(KEY);
  },

  token() {
    return this.load()?.token || null;
  },

  role() {
    return this.load()?.role || null;
  },

  isExpired() {
    const exp = this.load()?.exp;
    if (!exp) return false; // no exp => treat as non-expiring for dev
    const nowSec = Math.floor(Date.now() / 1000);
    return nowSec >= exp;
  },

  isLoggedIn() {
    const t = this.token();
    if (!t) return false;
    if (this.isExpired()) {
      this.clear();
      return false;
    }
    return true;
  },
};
