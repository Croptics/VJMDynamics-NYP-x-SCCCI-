/**
 * Image storage management — GET/POST /api/media/images[...]
 *
 * Admin-only bulk view over the app's Cloudinary storage (Settings → Image
 * storage): list every delegate-photo asset actually sitting in Cloudinary,
 * delete a chosen subset, or purge the whole folder in one action. Gated on
 * manageAccounts — same tier as Account control, since this is an
 * account-wide infrastructure action, not routine delegate editing.
 *
 * Every delete here (selected or purge) also unlinks the affected delegates'
 * photoUrl/photoPublicId columns, so the app never keeps pointing at an
 * image that no longer exists in storage — the same cleanup the per-delegate
 * photo routes in server.js already do, just working from the storage side
 * (a Cloudinary publicId) instead of a specific delegate id.
 */

import { Router } from "express";
import { isConfigured, listImages, destroyImages, purgeAllImages, DELEGATE_PHOTO_FOLDER } from "../lib/cloudinary.js";
import { listDelegatesWithPhoto, clearPhotoByPublicId } from "../data.js";
import { requirePermission } from "../lib/auth.js";

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/api/media/images", requirePermission("manageAccounts"), wrap(async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ error: "NOT_CONFIGURED", message: "Cloudinary isn't configured (CLOUDINARY_* in backend/.env)." });
  }
  const [images, withPhoto] = await Promise.all([listImages(), listDelegatesWithPhoto()]);
  const byPublicId = new Map(withPhoto.map((d) => [d.photoPublicId, d]));
  const withOwner = images.map((img) => {
    const owner = byPublicId.get(img.publicId);
    return { ...img, delegateId: owner?.id || null, delegateName: owner?.name || null };
  });
  const totalBytes = images.reduce((sum, i) => sum + (i.bytes || 0), 0);
  res.json({ folder: DELEGATE_PHOTO_FOLDER, total: images.length, totalBytes, images: withOwner });
}));

router.post("/api/media/images/delete", requirePermission("manageAccounts"), wrap(async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ error: "NOT_CONFIGURED", message: "Cloudinary isn't configured (CLOUDINARY_* in backend/.env)." });
  }
  const publicIds = Array.isArray(req.body?.publicIds) ? req.body.publicIds.filter((id) => typeof id === "string" && id) : [];
  if (!publicIds.length) return res.status(400).json({ error: "NO_IMAGES", message: "No images selected." });

  const deleted = await destroyImages(publicIds);
  const unlinked = await clearPhotoByPublicId(deleted);
  res.json({ deletedCount: deleted.length, unlinkedDelegates: unlinked });
}));

router.post("/api/media/images/purge", requirePermission("manageAccounts"), wrap(async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ error: "NOT_CONFIGURED", message: "Cloudinary isn't configured (CLOUDINARY_* in backend/.env)." });
  }
  // A second, explicit confirmation carried in the request body (the UI
  // requires literally typing "DELETE ALL" before this button even becomes
  // clickable) — belt-and-suspenders against a stray/automated call, since
  // this destroys every stored delegate photo in one shot with no undo.
  if (req.body?.confirm !== "DELETE ALL") {
    return res.status(400).json({ error: "NOT_CONFIRMED", message: "Confirmation phrase missing or incorrect." });
  }
  const deleted = await purgeAllImages();
  const unlinked = await clearPhotoByPublicId(deleted);
  res.json({ deletedCount: deleted.length, unlinkedDelegates: unlinked });
}));

export default router;
