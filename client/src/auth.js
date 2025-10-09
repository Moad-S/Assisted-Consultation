export const auth = {
  save({ token, user }) {
    localStorage.setItem("token", token);
    localStorage.setItem("role", user.role);
    localStorage.setItem("email", user.email);
  },
  token() {
    return localStorage.getItem("token");
  },
  role() {
    return localStorage.getItem("role");
  },
  clear() {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    localStorage.removeItem("email");
  },
};
