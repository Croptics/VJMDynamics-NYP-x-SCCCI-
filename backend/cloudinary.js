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
