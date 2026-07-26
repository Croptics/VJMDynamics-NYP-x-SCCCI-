/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — User Guide walkthrough video
 *
 *  Single global row (id=1) holding whatever video an admin has uploaded to
 *  replace the "coming soon" placeholder on the Getting Started tab. Not
 *  per-trip/per-account — every user sees the same one video.
 * ============================================================================= */
import { get, run } from "./connection.js";

export async function getGuideVideo() {
  const row = await get(
    `SELECT url, public_id AS "publicId", uploaded_by AS "uploadedBy", uploaded_at AS "uploadedAt"
       FROM guide_video WHERE id = 1`
  );
  return row && row.url ? row : null;
}

export async function setGuideVideo({ url, publicId }, actor) {
  await run(
    `INSERT INTO guide_video (id, url, public_id, uploaded_by, uploaded_at)
     VALUES (1, $1, $2, $3, now())
     ON CONFLICT (id) DO UPDATE SET url = $1, public_id = $2, uploaded_by = $3, uploaded_at = now()`,
    [url, publicId, actor]
  );
  return getGuideVideo();
}

/** Clears the row and returns the previous publicId (caller destroys the Cloudinary asset). */
export async function clearGuideVideo() {
  const existing = await getGuideVideo();
  await run(`DELETE FROM guide_video WHERE id = 1`);
  return existing?.publicId || null;
}

/** Settings → Image storage media manager (2026-07-27) — a delete/purge done
 *  from THAT screen removes the Cloudinary asset directly, bypassing
 *  DELETE /api/guide-video entirely, so this clears the row if it was
 *  pointing at one of the just-deleted publicIds. Returns whether it cleared
 *  anything (caller doesn't need to separately destroy the asset — it's
 *  already gone by the time this runs). */
export async function clearGuideVideoIfMatches(publicIds) {
  const idSet = new Set(publicIds || []);
  const existing = await getGuideVideo();
  if (existing && idSet.has(existing.publicId)) {
    await run(`DELETE FROM guide_video WHERE id = 1`);
    return true;
  }
  return false;
}
