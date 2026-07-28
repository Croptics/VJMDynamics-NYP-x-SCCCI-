/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Trip Announcements
 *
 *  Admin-posted critical updates, scoped per trip (e.g. "Departure moved to
 *  7am", "Coach 3 relocated to Gate B"). Visible to every signed-in Staff/
 *  Admin viewing that trip — the same "can this account see the Dashboard/
 *  mobile Home" gate everything else already uses; only POSTING/EDITING/
 *  DELETING is admin-only, enforced in routes/announcements.js.
 * ============================================================================= */
import { all, get, run } from "./connection.js";

/** `images`/`videos` (2026-07-27, "multiple image upload option" /
 *  "give me... video upload also") — each a JSONB array of {url, publicId}
 *  objects, newest-appended-last. The ORIGINAL single-image "imageUrl"/
 *  "imagePublicId" columns stay untouched and are never written by new
 *  posts — they're read-only now, purely so announcements created before
 *  this feature still render their one photo (see AnnouncementCard's
 *  fallback in AnnouncementsPage.jsx). New/edited posts live entirely in
 *  `images`/`videos`. */
export async function createAnnouncement({ tripId, itineraryItemId, title, message, images, videos }, actor) {
  const row = await get(
    `INSERT INTO announcements (trip_id, itinerary_item_id, title, message, created_by, images, videos)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
     RETURNING id, trip_id AS "tripId", itinerary_item_id AS "itineraryItemId", title, message,
               created_by AS "createdBy", created_at AS "createdAt", "imageUrl", images, videos`,
    [tripId || null, itineraryItemId || null, title, message, actor, JSON.stringify(images || []), JSON.stringify(videos || [])]
  );
  return row;
}

/** Most recent first within each itinerary-stop group — the page itself
 *  handles grouping by itineraryItemId (null = general/trip-wide notice).
 *  LEFT JOINs itinerary_items so the page can render "Day 2 · Great Wall
 *  visit · 09:00" directly without a second fetch to match ids against. */
export async function listAnnouncements(tripId) {
  if (!tripId) return [];
  return all(
    `SELECT a.id, a.trip_id AS "tripId", a.itinerary_item_id AS "itineraryItemId", a.title, a.message,
            a.created_by AS "createdBy", a.created_at AS "createdAt", a."imageUrl", a.images, a.videos,
            i.day_number AS "itineraryDayNumber", i.title AS "itineraryTitle",
            TO_CHAR(i.start_time, 'HH24:MI') AS "itineraryTime"
     FROM announcements a
     LEFT JOIN itinerary_items i ON i.id = a.itinerary_item_id
     WHERE a.trip_id = $1
     ORDER BY a.created_at DESC`,
    [tripId]
  );
}

/** Edits title/message/itinerary tag (2026-07-27, "give me the option to edit
 *  the announcement") — image/video ADD/REMOVE goes through
 *  setAnnouncementImages/setAnnouncementVideos below instead, since those are
 *  separate Cloudinary-touching operations the route needs to sequence
 *  around uploads/deletes. */
export async function updateAnnouncement(id, { title, message, itineraryItemId }, actor) {
  const row = await get(
    `UPDATE announcements SET title = $1, message = $2, itinerary_item_id = $3
     WHERE id = $4
     RETURNING id, trip_id AS "tripId", itinerary_item_id AS "itineraryItemId", title, message,
               created_by AS "createdBy", created_at AS "createdAt", "imageUrl", images, videos`,
    [title, message, itineraryItemId || null, id]
  );
  return row || { error: "NOT_FOUND" };
}

export async function getAnnouncementImages(id) {
  const row = await get(`SELECT images FROM announcements WHERE id = $1`, [id]);
  return row?.images || [];
}

/** Overwrites the whole images array — the route computes the final set
 *  (existing minus removed, plus newly uploaded) in JS rather than doing
 *  add/remove as separate SQL ops, since the array's small (a handful of
 *  photos per announcement) and this keeps the logic in one obvious place. */
export async function setAnnouncementImages(id, images) {
  const row = await get(
    `UPDATE announcements SET images = $1::jsonb WHERE id = $2 RETURNING images`,
    [JSON.stringify(images || []), id]
  );
  return row?.images || [];
}

export async function getAnnouncementVideos(id) {
  const row = await get(`SELECT videos FROM announcements WHERE id = $1`, [id]);
  return row?.videos || [];
}

/** Mirrors setAnnouncementImages() — same reasoning, just the videos array. */
export async function setAnnouncementVideos(id, videos) {
  const row = await get(
    `UPDATE announcements SET videos = $1::jsonb WHERE id = $2 RETURNING videos`,
    [JSON.stringify(videos || []), id]
  );
  return row?.videos || [];
}

/** Settings → Image storage media manager (2026-07-27, "give me the option
 *  to delete announcement image/video upload") — a delete/purge done from
 *  THAT screen removes the Cloudinary asset directly, bypassing the normal
 *  edit-announcement flow entirely, so this reconciles every announcement's
 *  images/videos arrays (and the legacy single imageUrl/imagePublicId
 *  columns) afterward, the same way clearPhotoByPublicId() does for
 *  delegates. Returns how many announcements were actually touched. */
export async function unlinkMediaByPublicId(publicIds) {
  const idSet = new Set(publicIds || []);
  if (!idSet.size) return 0;
  const rows = await all(`SELECT id, "imagePublicId", images, videos FROM announcements`);
  let touched = 0;
  for (const row of rows) {
    const images = row.images || [];
    const videos = row.videos || [];
    const keptImages = images.filter((i) => !idSet.has(i.publicId));
    const keptVideos = videos.filter((v) => !idSet.has(v.publicId));
    const clearLegacy = row.imagePublicId && idSet.has(row.imagePublicId);
    if (keptImages.length === images.length && keptVideos.length === videos.length && !clearLegacy) continue;
    await run(
      `UPDATE announcements SET images = $1::jsonb, videos = $2::jsonb${clearLegacy ? `, "imageUrl" = NULL, "imagePublicId" = NULL` : ""} WHERE id = $3`,
      [JSON.stringify(keptImages), JSON.stringify(keptVideos), row.id]
    );
    touched++;
  }
  return touched;
}

/** Returns every Cloudinary publicId this announcement ever held, split by
 *  resource type since images/videos are destroyed via different Cloudinary
 *  API calls (legacy single "imagePublicId" counts as an image) — mirrors
 *  clearAccountPhoto()'s return shape in db/accounts.js, just pluralised. */
export async function deleteAnnouncement(id) {
  const existing = await get(`SELECT "imagePublicId", images, videos FROM announcements WHERE id = $1`, [id]);
  if (!existing) return { error: "NOT_FOUND" };
  await run(`DELETE FROM announcements WHERE id = $1`, [id]);
  const imagePublicIds = [
    ...(existing.imagePublicId ? [existing.imagePublicId] : []),
    ...(existing.images || []).map((i) => i.publicId).filter(Boolean),
  ];
  const videoPublicIds = (existing.videos || []).map((v) => v.publicId).filter(Boolean);
  return { ok: true, imagePublicIds, videoPublicIds };
}
