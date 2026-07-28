/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — delegate profile photo storage
 *
 *  Thin wrapper around the Cloudinary SDK. Requires CLOUDINARY_CLOUD_NAME,
 *  CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET in backend/.env (see
 *  .env.example) — sign up at cloudinary.com, the dashboard shows all three.
 * ============================================================================= */
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export function isConfigured() {
  return !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

/**
 * Upload an image buffer. `resource_type: "image"` makes Cloudinary itself
 * decode and validate the bytes are a real image — it rejects anything that
 * merely claims to be an image (e.g. a renamed non-image file), which is the
 * actual content-type check, not just trusting the client's declared MIME
 * type. Returns { url, publicId } (publicId is kept so the asset can be
 * destroyed later on replace/delete).
 *
 * `url` is Cloudinary's delivery URL (not the raw upload result) with
 * fetch_format/quality: "auto" — Cloudinary picks the best format per
 * browser (WebP/AVIF where supported) and compresses appropriately, so
 * every place that renders a delegate's photo gets this for free.
 */
export function uploadImage(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image", overwrite: false },
      (err, result) => {
        if (err) return reject(err);
        const url = cloudinary.url(result.public_id, {
          resource_type: "image",
          secure: true,
          fetch_format: "auto",
          quality: "auto",
        });
        resolve({ url, publicId: result.public_id });
      }
    );
    stream.end(buffer);
  });
}

/** Best-effort delete — swallow errors so an already-gone asset (or a
 *  transient Cloudinary hiccup) never blocks the caller's own DB update. */
export async function destroyImage(publicId) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
  } catch {
    /* ignore — not worth failing the request over a cleanup step */
  }
}

/* ---- Media manager (Settings → Image storage) ----------------------------
 * Everything below backs the admin-only bulk image management UI: list every
 * asset actually sitting in Cloudinary storage, delete a chosen subset, or
 * purge the whole folder. Uses the Admin API (cloudinary.api.*), a different
 * surface from the Upload API (cloudinary.uploader.*) used above — the Admin
 * API is what can list/bulk-delete, but needs the same api_key/api_secret
 * already configured, so isConfigured() covers it too. */

// Every image this app has ever uploaded lives under this one folder — see
// server.js's uploadImage(req.file.buffer, "mustergo/delegates") call, the
// only uploadImage() call site in the codebase. Scoping every list/delete
// call to this prefix means "purge all" can never touch an asset outside
// what this app itself put there, even if the Cloudinary account is shared.
export const DELEGATE_PHOTO_FOLDER = "mustergo/delegates";

/** List every image asset in the app's folder, newest first. Cloudinary caps
 *  a single Admin API page at 500 resources — fine for a delegate-photo
 *  folder in practice, and listing loops via next_cursor if it's ever not. */
export async function listImages(folder = DELEGATE_PHOTO_FOLDER) {
  const out = [];
  let nextCursor;
  do {
    const res = await cloudinary.api.resources({
      type: "upload", resource_type: "image", prefix: folder + "/",
      max_results: 500, next_cursor: nextCursor,
    });
    for (const r of res.resources || []) {
      out.push({
        publicId: r.public_id,
        url: cloudinary.url(r.public_id, { resource_type: "image", secure: true, fetch_format: "auto", quality: "auto" }),
        thumbUrl: cloudinary.url(r.public_id, { resource_type: "image", secure: true, width: 120, height: 120, crop: "fill", gravity: "auto", fetch_format: "auto", quality: "auto" }),
        bytes: r.bytes, width: r.width, height: r.height, createdAt: r.created_at,
      });
    }
    nextCursor = res.next_cursor;
  } while (nextCursor);
  out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return out;
}

/** Bulk delete specific assets. Cloudinary's delete_resources caps at 100
 *  public_ids per call, so this chunks larger selections. Returns the set of
 *  publicIds Cloudinary actually confirmed deleted (a caller can diff against
 *  what was requested to see if anything was already gone/failed). */
export async function destroyImages(publicIds) {
  const ids = [...new Set(publicIds || [])].filter(Boolean);
  const deleted = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const res = await cloudinary.api.delete_resources(chunk, { resource_type: "image" });
    for (const [id, status] of Object.entries(res.deleted || {})) {
      if (status === "deleted" || status === "not_found") deleted.push(id);
    }
  }
  return deleted;
}

/** Purge every image in the app's folder. Two-step (list then bulk-delete by
 *  the exact ids just listed) rather than Cloudinary's delete_resources_by_
 *  prefix, so the caller gets back the precise list of what was removed to
 *  reconcile against the delegates table (clear photoUrl/photoPublicId for
 *  any delegate whose photo just got destroyed this way). */
export async function purgeAllImages(folder = DELEGATE_PHOTO_FOLDER) {
  const images = await listImages(folder);
  const deleted = await destroyImages(images.map((i) => i.publicId));
  return deleted;
}
