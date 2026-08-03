/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — User Guide's "Scanner & kiosk" tab
 *
 *  Extracted from UserGuidePage.jsx (2026-08-02 modularization pass).
 * ============================================================================= */
import { ScanFace, ShieldCheck, ScanLine, Mic } from "lucide-react";
import { Tip } from "./FlowChart.jsx";

export function ScannerTab({ t }) {
  return (
    <div className="card" style={{ marginTop: 16, padding: 22 }}>
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>{t("Scanning delegates in")}</h2>
      <p className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
        {t("Three different scanner surfaces exist for three different situations — here's when to use which.")}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Tip icon={ScanFace} title={t("Face + QR scan (desktop)")}>
          {t("The entrance-kiosk scanner for a laptop at a fixed check-in point. Face and QR modes side by side, with a live boarded/missing tally for whichever coach is selected.")}
        </Tip>
        <Tip icon={ScanLine} title={t("Mobile scanner")}>
          {t("The same Face/QR/Manual scanner, laid out for a phone — reached from within the logged-in mobile app when a staff member wants to scan on the move rather than from a fixed kiosk laptop.")}
        </Tip>
        <Tip icon={ShieldCheck} title={t("The passwordless entrance kiosk")}>
          {t("A shared device (tablet/laptop at a door) can run the kiosk scanner with NO login at all — reached from the Login page's \"Quick Scanner Access\" link. It's tightly locked down: no sidebar, no other pages, and its access token can only ever check delegates in — nothing else in the app is reachable from it.")}
        </Tip>
        <Tip icon={Mic} title={t("Low-light fallback")}>
          {t("If the camera feed gets too dark to reliably read faces, the scanner automatically (or via the \"Simulate low light\" button) switches to an audio passphrase instead — nobody has to fumble with settings mid-event.")}
        </Tip>
      </div>
    </div>
  );
}
