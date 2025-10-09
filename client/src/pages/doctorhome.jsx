import { auth } from "../auth";
export default function DoctorHome() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>Doctor Area</h1>
      <p>Welcome, {localStorage.getItem("email")}.</p>
      <p>Protected route for doctors only.</p>
      <button
        onClick={() => {
          auth.clear();
          location.href = "/login/doctor";
        }}
      >
        Logout
      </button>
    </main>
  );
}
