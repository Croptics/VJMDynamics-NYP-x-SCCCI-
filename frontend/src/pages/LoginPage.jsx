import { useState } from "react";
import { ClipboardCheck, Eye, EyeOff, Fingerprint } from "lucide-react";
import { apiPost } from "../lib/api.js";

/**
 * Screen 1 — Login / Authentication (shared across team; Vance leads).
 * Split layout: SCCCI-Red brand panel + sign-in form. Includes the
 * "Sign in with Workpass" path. `onSignIn` flips app-level auth state.
 */
export default function LoginPage({ onSignIn }) {
  const [staffId, setStaffId] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [keep, setKeep] = useState(true);

  async function handleSignIn() {
    // Try the real backend: POST /api/auth/login -> store JWT for later calls.
    // If the backend isn't running, fall through to demo mode so the app still
    // opens. Any staff ID / password is accepted in this build.
    try {
      const { token } = await apiPost("/auth/login", {
        staffId: staffId || "staff_id_123",
        password,
      });
      if (token) sessionStorage.setItem("mg_token", token);
    } catch {
      /* backend offline - continue in demo mode */
    }
    onSignIn?.();
  }

  return (
    <div style={S.wrap}>
      <div style={S.card}>
        {/* Brand panel */}
        <div style={S.brand}>
          <div className="wordmark" style={{ color: "#fff", fontSize: 30 }}>
            <ClipboardCheck size={30} strokeWidth={2.4} /> MusterGo
          </div>
          <div>
            <h2 style={S.brandH}>No one gets left behind.</h2>
            <p style={S.brandP}>Real-time delegation attendance for SCCCI overseas trips.</p>
          </div>
          <p style={S.brandFoot}>A Singapore Chinese Chamber of Commerce &amp; Industry initiative</p>
        </div>

        {/* Form panel */}
        <div style={S.form}>
          <h1 style={{ fontSize: 26 }}>Sign in</h1>
          <p className="muted" style={{ marginTop: 4, marginBottom: 24, fontSize: 14 }}>
            SCCCI secretariat &amp; on-ground staff
          </p>

          <label className="field-label" htmlFor="staffId">Staff ID</label>
          <input
            id="staffId"
            className="input"
            placeholder="staff_id_123"
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
          />

          <label className="field-label" htmlFor="pw" style={{ marginTop: 16 }}>Password</label>
          <div style={{ position: "relative" }}>
            <input
              id="pw"
              className="input"
              type={showPw ? "text" : "password"}
              placeholder="............"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ paddingRight: 42 }}
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? "Hide password" : "Show password"}
              style={S.eye}
            >
              {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          <div className="row between" style={{ margin: "14px 0 22px" }}>
            <label className="row" style={{ gap: 8, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
              Keep me signed in
            </label>
            <a href="#" style={{ color: "var(--scc-red)", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
              Forgot password?
            </a>
          </div>

          <button className="btn btn-primary btn-block" onClick={handleSignIn}>Sign in</button>
          <button className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={handleSignIn}>
            <Fingerprint size={18} color="var(--scc-red)" /> Sign in with Workpass
          </button>

          <p className="muted" style={{ fontSize: 11, textAlign: "center", marginTop: 16 }}>
            By signing in, you accept the SCCCI data handling policy.
          </p>
        </div>
      </div>
    </div>
  );
}

const S = {
  wrap: { minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "var(--bg)" },
  card: {
    width: "min(880px, 100%)",
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    background: "#fff",
    borderRadius: "var(--r-lg)",
    overflow: "hidden",
    boxShadow: "var(--shadow-lg)",
  },
  brand: {
    background: "var(--scc-red)",
    color: "#fff",
    padding: 40,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    gap: 40,
  },
  brandH: { fontSize: 28, lineHeight: 1.2, fontWeight: 700 },
  brandP: { marginTop: 10, opacity: 0.9, fontSize: 15, lineHeight: 1.5 },
  brandFoot: { fontSize: 12, opacity: 0.8, fontWeight: 600 },
  form: { padding: 40 },
  eye: {
    position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
    background: "none", border: "none", color: "var(--scc-red)", display: "flex",
  },
};
