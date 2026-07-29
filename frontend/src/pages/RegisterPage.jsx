/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Admin Dashboard, Auth, Accounts & Permissions
 * ============================================================================= */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardCheck, Eye, EyeOff, AlertCircle, CheckCircle2, Languages, Moon, Sun, Mail } from "lucide-react";
import { apiPost } from "../lib/api.js";
import { useLang } from "../lib/i18n.jsx";
import { useTheme } from "../lib/theme.jsx";

/**
 * Screen — Self-service registration (2026-07-24). "New staff who haven't
 * created an account yet" sign up with email + username + password. This
 * does NOT log the account in — it's created in a "pending" state and
 * cannot sign in (see the status check in backend/routes/auth.js's login
 * route) until an admin approves it on the Account control page. Always
 * creates a "staff" account — self-registration can never mint an admin.
 *
 * Mirrors LoginPage.jsx's layout/style (same brand panel + form panel split)
 * so the two feel like one continuous flow rather than a bolted-on page.
 */
export default function RegisterPage() {
  const navigate = useNavigate();
  const { lang, toggleLang, t } = useLang();
  const { theme, toggleTheme } = useTheme();

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    setError("");
    if (!email.trim() || !username.trim() || !password) {
      setError("Please fill in every field.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await apiPost("/auth/register", { email: email.trim(), username: username.trim(), password });
      setDone(true);
    } catch (e) {
      if (e?.status === 409) {
        setError(e.code === "EMAIL_TAKEN" ? "That email is already registered." : "That username is already taken.");
      } else if (e?.status === 429) {
        setError("Too many attempts. Please wait a few minutes and try again.");
      } else {
        setError(e.message || "Couldn't create that account. Check your details and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter") submit();
  }

  return (
    <div style={S.wrap}>
      <div className="row" style={{ position: "absolute", top: 20, right: 20, gap: 10 }}>
        <button onClick={toggleTheme} className="btn btn-ghost" aria-label={theme === "dark" ? t("Switch to light mode") : t("Switch to dark mode")}>
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button onClick={toggleLang} className="btn btn-ghost">
          <Languages size={16} /> {lang === "en" ? "中文" : "English"}
        </button>
      </div>
      <div className="login-card" style={S.card}>
        <div className="login-panel" style={S.brand}>
          <div className="wordmark" style={{ color: "#fff", fontSize: 30 }}>
            <ClipboardCheck size={30} strokeWidth={2.4} /> MusterGo
          </div>
          <div>
            <h2 style={S.brandH}>{t("No one gets left behind.")}</h2>
            <p style={S.brandP}>{t("Real-time delegation attendance for SCCCI overseas trips.")}</p>
          </div>
          <p style={S.brandFoot}>{t("A Singapore Chinese Chamber of Commerce & Industry initiative")}</p>
        </div>

        <form className="login-panel" style={S.form} onSubmit={(e) => { e.preventDefault(); submit(); }}>
          {done ? (
            <div style={{ textAlign: "center", padding: "24px 0" }}>
              <CheckCircle2 size={36} color="var(--st-present)" style={{ marginBottom: 14 }} />
              <h1 style={{ fontSize: 22 }}>{t("Account created")}</h1>
              <p className="muted" style={{ fontSize: 14, marginTop: 10, lineHeight: 1.6 }}>
                {t("Your account is awaiting admin approval. You'll be able to sign in once an admin approves it on Account control.")}
              </p>
              <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 22 }} onClick={() => navigate("/login")}>
                {t("Back to sign in")}
              </button>
            </div>
          ) : (
            <>
              <h1 style={{ fontSize: 26 }}>{t("Create an account")}</h1>
              <p className="muted" style={{ marginTop: 4, marginBottom: 24, fontSize: 14 }}>
                {t("New staff — sign up, then wait for admin approval before you can sign in.")}
              </p>

              <label className="field-label" htmlFor="email">{t("Email")} <span style={{ color: "var(--scc-red)" }}>*</span></label>
              <div style={{ position: "relative" }}>
                <Mail size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)" }} />
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  className="input"
                  style={{ paddingLeft: 36 }}
                  placeholder="e.g. john.tan@sccci.org.sg"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={onKeyDown}
                />
              </div>

              <label className="field-label" htmlFor="username" style={{ marginTop: 16 }}>{t("Username")} <span style={{ color: "var(--scc-red)" }}>*</span></label>
              <input
                id="username"
                name="username"
                autoComplete="username"
                className="input"
                placeholder="e.g. john_tan"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={onKeyDown}
              />

              <label className="field-label" htmlFor="pw" style={{ marginTop: 16 }}>{t("Password")} <span style={{ color: "var(--scc-red)" }}>*</span></label>
              <div style={{ position: "relative" }}>
                <input
                  id="pw"
                  name="password"
                  autoComplete="new-password"
                  className="input"
                  type={showPw ? "text" : "password"}
                  placeholder="············"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={onKeyDown}
                  style={{ paddingRight: 42 }}
                />
                <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "Hide password" : "Show password"} style={S.eye}>
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t("At least 8 characters, including a letter and a number.")}</p>

              <label className="field-label" htmlFor="confirmPw" style={{ marginTop: 14 }}>{t("Confirm new password")} <span style={{ color: "var(--scc-red)" }}>*</span></label>
              <input
                id="confirmPw"
                name="confirmPassword"
                autoComplete="new-password"
                className="input"
                type={showPw ? "text" : "password"}
                placeholder="············"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={onKeyDown}
              />

              {error && (
                <div style={S.error} role="alert">
                  <AlertCircle size={16} /> {t(error)}
                </div>
              )}

              <button type="submit" className="btn btn-primary btn-block" style={{ marginTop: 20 }} disabled={submitting}>
                {submitting ? t("Saving…") : t("Create account")}
              </button>

              <button
                type="button"
                onClick={() => navigate("/login")}
                style={{ background: "none", border: "none", padding: 0, marginTop: 16, cursor: "pointer", color: "var(--scc-red)", fontSize: 13, fontWeight: 600, textAlign: "center", width: "100%" }}
              >
                {t("Back to sign in")}
              </button>
            </>
          )}
        </form>
      </div>

      <style>{`
        .login-card { display: grid; grid-template-columns: 1fr 1fr; }
        @media (max-width: 720px) {
          .login-card { grid-template-columns: 1fr; }
          .login-panel { padding: 24px !important; }
        }
      `}</style>
    </div>
  );
}

const S = {
  wrap: { minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "var(--bg)" },
  card: {
    width: "min(880px, 100%)",
    maxHeight: "calc(100vh - 48px)",
    background: "var(--surface)",
    borderRadius: "var(--r-lg)",
    overflow: "hidden",
    overflowY: "auto",
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
  error: {
    display: "flex", alignItems: "center", gap: 8,
    marginTop: 14, padding: "10px 12px",
    background: "var(--st-missing-bg)", color: "var(--st-missing)",
    borderRadius: "var(--r-sm)", fontSize: 13, fontWeight: 600,
  },
};
