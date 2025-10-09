import { auth } from "../auth";
export default function PatientHome() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>Patient Area</h1>
      <p>Welcome, {localStorage.getItem("email")}.</p>
      <p>Protected route for patients only.</p>
      <button
        onClick={() => {
          auth.clear();
          location.href = "/login/patient";
        }}
      >
        Logout
      </button>
    </main>
  );
}
