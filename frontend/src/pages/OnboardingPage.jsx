import { useRef, useState, useCallback, useMemo } from "react";
import {
  UploadCloud,
  FileCheck2,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Pencil,
  Trash2,
} from "lucide-react";
import { ConfidenceBadge } from "../components/StatusBadge.jsx";
import { parseDocument } from "../lib/claudeParse.js";
import { useLang } from "../lib/i18n.jsx";

/**
 * Screen 4 — AI Document Parsing & Attendee Onboarding (Vance).
 *
 * Use Case 1 — Automated Attendee Onboarding via AI Document Parsing:
 *   1. Drop / select passport PDFs.
 *   2. Claude (server-side) extracts each passport → preview rows.
 *   3. Low-confidence rows are flagged for manual review (blurry-doc flow).
 *   4. Admin edits if needed, then Confirm & add to the delegate list.
 *
 * Fully self-contained: uses built-in React state and the simulated parser in
 * lib/claudeParse.js, so it runs immediately. Swap USE_SIMULATION off there to
 * hit the real backend.
 */

const TRIPS = [
  { id: "t-1", name: "Beijing study mission · 12–16 Aug 2026" },
  { id: "t-2", name: "Shanghai trade mission · 28 Aug 2026" },
  { id: "t-3", name: "Shenzhen tech tour · 17 Sep 2026" },
];

const STATUS_META = {
  EXTRACTING: { cls: "badge-review", icon: Loader2, label: "Extracting", spin: true },
  NEEDS_REVIEW: { cls: "badge-review", icon: AlertCircle, label: "Review" },
  EXTRACTED: { cls: "badge-present", icon: FileCheck2, label: "Done" },
  FAILED: { cls: "badge-missing", icon: AlertCircle, label: "Failed" },
};

let fileSeq = 0;

export default function OnboardingPage() {
  const { t } = useLang();
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [tripId, setTripId] = useState("");
  const [files, setFiles] = useState([]); // {id,name,status,totalCount,extractedCount,reviewCount}
  const [rows, setRows] = useState([]); // extracted delegate rows
  const [editAll, setEditAll] = useState(false);

  const reviewNeeded = useMemo(() => rows.filter((r) => r.needsReview).length, [rows]);

  /* ---- file intake ----------------------------------------------------- */
  const ingest = useCallback(
    async (fileList) => {
      const incoming = Array.from(fileList).slice(0, 20); // max 20 files
      for (const file of incoming) {
        const id = `f-${++fileSeq}`;
        setFiles((prev) => [
          ...prev,
          { id, name: file.name, status: "EXTRACTING", totalCount: 0, extractedCount: 0, reviewCount: 0 },
        ]);

        try {
          const { rows: parsed, totalCount } = await parseDocument(file, { tripId });
          const review = parsed.filter((r) => r.needsReview).length;
          setRows((prev) => [
            ...prev,
            ...parsed.map((r) => ({ ...r, _id: `${id}-${r.id}` })),
          ]);
          setFiles((prev) =>
            prev.map((f) =>
              f.id === id
                ? {
                    ...f,
                    status: review > 0 ? "NEEDS_REVIEW" : "EXTRACTED",
                    totalCount,
                    extractedCount: parsed.length,
                    reviewCount: review,
                  }
                : f
            )
          );
        } catch {
          setFiles((prev) =>
            prev.map((f) => (f.id === id ? { ...f, status: "FAILED" } : f))
          );
        }
      }
    },
    [tripId]
  );

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) ingest(e.dataTransfer.files);
  };

  /* ---- row editing ----------------------------------------------------- */
  const updateRow = (rid, field, value) =>
    setRows((prev) =>
      prev.map((r) =>
        r._id === rid
          ? { ...r, [field]: value, needsReview: false } // editing resolves the flag
          : r
      )
    );

  const removeRow = (rid) => setRows((prev) => prev.filter((r) => r._id !== rid));

  /* ---- confirm --------------------------------------------------------- */
  const confirmAndAdd = async () => {
    // Production: POST /api/documents/:id/confirm or /trips/:id/delegates/bulk
    // Demo: clear the preview to simulate a successful commit.
    alert(`Added ${rows.length} delegates to the trip.`);
    setRows([]);
    setFiles((prev) => prev.map((f) => ({ ...f, status: "EXTRACTED" })));
  };

  /* --------------------------------------------------------------------- */
  return (
    <div className="page">
      <div className="page-eyebrow">{t("Onboarding")}</div>
      <h1 className="page-title">{t("Document parsing")}</h1>
      <p className="page-sub">{t("Drop passport PDFs — AI extracts and populates the delegate list.")}</p>

      {/* Upload + file list */}
      <div className="card" style={{ padding: 24, marginTop: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 24 }}>
          {/* Dropzone */}
          <div>
            <div
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              style={{
                border: `1.5px dashed ${dragOver ? "var(--scc-red)" : "var(--line)"}`,
                background: dragOver ? "var(--scc-red-tint)" : "var(--surface-2)",
                borderRadius: "var(--r-md)",
                padding: "40px 24px",
                textAlign: "center",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              <UploadCloud size={34} color="var(--ink-3)" />
              <p style={{ margin: "12px 0 4px", fontWeight: 600 }}>
                {t("Drop files or click to upload")}
              </p>
              <p className="muted" style={{ fontSize: 13 }}>
                {t("PDF or scanned image · Max 20 files · 10 MB each")}
              </p>
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,image/*"
                multiple
                hidden
                onChange={(e) => e.target.files?.length && ingest(e.target.files)}
              />
            </div>

            <label className="field-label" style={{ marginTop: 16 }}>{t("Assign to trip")}</label>
            <select className="select" value={tripId} onChange={(e) => setTripId(e.target.value)}>
              <option value="">{t("Select a trip…")}</option>
              {TRIPS.map((trip) => (
                <option key={trip.id} value={trip.id}>{trip.name}</option>
              ))}
            </select>
          </div>

          {/* File status list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {files.length === 0 && (
              <div className="muted" style={{ fontSize: 13, paddingTop: 8 }}>
                {t("Uploaded files appear here with their extraction status.")}
              </div>
            )}
            {files.map((f) => {
              const meta = STATUS_META[f.status];
              const Icon = meta.icon;
              return (
                <div
                  key={f.id}
                  className="card"
                  style={{
                    padding: 14,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    borderColor: f.status === "NEEDS_REVIEW" ? "var(--st-review)" : "var(--line)",
                  }}
                >
                  <Icon
                    size={20}
                    className={meta.spin ? "spin" : ""}
                    color={`var(--st-${f.status === "EXTRACTED" ? "present" : f.status === "FAILED" ? "missing" : "review"})`}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.name}
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {f.status === "EXTRACTING"
                        ? `Extracting · ${f.extractedCount}/${f.totalCount || "…"} done`
                        : f.status === "NEEDS_REVIEW"
                        ? `${f.totalCount} passports · ${f.reviewCount} need review`
                        : f.status === "FAILED"
                        ? "Could not read — enter details manually"
                        : `${f.totalCount} passports · all extracted`}
                    </div>
                  </div>
                  <span className={"badge " + meta.cls}>
                    {f.status === "EXTRACTED" ? `${f.extractedCount}/${f.totalCount}` : meta.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Recently extracted table */}
      {rows.length > 0 && (
        <div className="card" style={{ marginTop: 20, overflow: "hidden" }}>
          <div className="row between" style={{ padding: "18px 20px", borderBottom: "1px solid var(--line)" }}>
            <div>
              <h2 style={{ fontSize: 16 }}>{t("Recently extracted")}</h2>
              <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                {t("Review and confirm before adding to the delegate list")}
                {reviewNeeded > 0 && (
                  <span style={{ color: "var(--st-review)", fontWeight: 600 }}>
                    {" "}· {reviewNeeded} need manual review
                  </span>
                )}
              </p>
            </div>
            <div className="row" style={{ gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => setEditAll((v) => !v)}>
                <Pencil size={15} /> {editAll ? t("Done editing") : t("Edit all")}
              </button>
              <button className="btn btn-primary" onClick={confirmAndAdd}>
                <CheckCircle2 size={16} /> {t("Confirm & add")} {rows.length}
              </button>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{t("Name")}</th>
                  <th>{t("Passport")}</th>
                  <th>{t("Nationality")}</th>
                  <th>{t("Expiry")}</th>
                  <th>{t("Confidence")}</th>
                  <th style={{ width: 44 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const editing = editAll || r.needsReview;
                  const flagged = r.needsReview;
                  const initials = r.fullName.split(" ").map((s) => s[0]).slice(0, 2).join("");
                  return (
                    <tr key={r._id} style={flagged ? { background: "var(--st-review-bg)" } : undefined}>
                      <td>
                        <div className="row" style={{ gap: 10 }}>
                          <span
                            className="avatar"
                            style={flagged ? { background: "var(--st-review-bg)", color: "var(--st-review)" } : undefined}
                          >
                            {initials}
                          </span>
                          {editing ? (
                            <input
                              className="input"
                              style={{ padding: "6px 8px", maxWidth: 180 }}
                              value={r.fullName}
                              onChange={(e) => updateRow(r._id, "fullName", e.target.value)}
                            />
                          ) : (
                            <span style={{ fontWeight: 500 }}>{r.fullName}</span>
                          )}
                        </div>
                      </td>
                      <td className="mono">
                        {editing ? (
                          <input
                            className="input"
                            style={{ padding: "6px 8px", maxWidth: 140 }}
                            value={r.passportNumber || ""}
                            placeholder="e.g. S1234567A"
                            onChange={(e) => updateRow(r._id, "passportNumber", e.target.value)}
                          />
                        ) : (
                          <span style={flagged ? { color: "var(--st-review)" } : undefined}>
                            {r.passportNumber} {flagged && "?"}
                          </span>
                        )}
                      </td>
                      <td>
                        {editing ? (
                          <input
                            className="input"
                            style={{ padding: "6px 8px", maxWidth: 120 }}
                            value={r.nationality || ""}
                            onChange={(e) => updateRow(r._id, "nationality", e.target.value)}
                          />
                        ) : (
                          r.nationality
                        )}
                      </td>
                      <td className="mono">
                        {editing ? (
                          <input
                            className="input"
                            type="date"
                            style={{ padding: "6px 8px", maxWidth: 150 }}
                            value={r.passportExpiry || ""}
                            onChange={(e) => updateRow(r._id, "passportExpiry", e.target.value)}
                          />
                        ) : r.passportExpiry ? (
                          new Date(r.passportExpiry).toLocaleDateString("en-GB", {
                            day: "2-digit", month: "short", year: "numeric",
                          })
                        ) : (
                          <span style={{ color: "var(--st-review)" }}>—</span>
                        )}
                      </td>
                      <td><ConfidenceBadge value={r.confidence} /></td>
                      <td>
                        <button
                          onClick={() => removeRow(r._id)}
                          aria-label={`Remove ${r.fullName}`}
                          style={{ background: "none", border: "none", color: "var(--ink-3)", display: "flex" }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* tiny inline keyframe for the extracting spinner */}
      <style>{`.spin{animation:mg-spin 0.9s linear infinite}@keyframes mg-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
