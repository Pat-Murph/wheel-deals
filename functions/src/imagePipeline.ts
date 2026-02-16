import * as admin from "firebase-admin";
import { onObjectFinalized } from "firebase-functions/v2/storage";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import sharp from "sharp";

const MAX_DIMENSION = 1600;
const THUMB_SIZE = 400;

function isImage(contentType?: string) {
  return !!contentType && contentType.startsWith("image/");
}

export const processMerchantImage = onObjectFinalized(
  {
    // Optional: pick your region (match your Firestore/Storage region if you know it)
    region: "us-west1",

    // Only trigger for uploads in this "folder"
    // merchant_uploads/{uid}/{filename}
     // leave undefined to use default bucket
  },
  async (event) => {
    const object = event.data;
    const filePath = object.name;
    if (!filePath) return;

    // Only process merchant uploads
    if (!filePath.startsWith("merchant_uploads/")) return;

    const contentType = object.contentType || "";
    if (!isImage(contentType)) return;

    // Avoid loops: don't process our generated outputs
    if (filePath.startsWith("merchant_images/") || filePath.startsWith("merchant_thumbs/")) return;

    const bucket = admin.storage().bucket(object.bucket);
    const baseName = path.basename(filePath);

    // Temp file paths
    const tempOriginal = path.join(os.tmpdir(), baseName);
    const tempOptimized = path.join(os.tmpdir(), `opt_${baseName}.jpg`);
    const tempThumb = path.join(os.tmpdir(), `thumb_${baseName}.jpg`);

    // Download original
    await bucket.file(filePath).download({ destination: tempOriginal });

    // Optimized image (max 1600px)
    await sharp(tempOriginal)
      .rotate()
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(tempOptimized);

    // Thumbnail (400x400)
    await sharp(tempOriginal)
      .rotate()
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: "cover" })
      .jpeg({ quality: 75, mozjpeg: true })
      .toFile(tempThumb);

    // Upload results
    await bucket.upload(tempOptimized, {
      destination: `merchant_images/${baseName}.jpg`,
      metadata: {
        contentType: "image/jpeg",
        cacheControl: "public, max-age=31536000, immutable",
      },
    });

    await bucket.upload(tempThumb, {
      destination: `merchant_thumbs/${baseName}.jpg`,
      metadata: {
        contentType: "image/jpeg",
        cacheControl: "public, max-age=31536000, immutable",
      },
    });

    // Cleanup
    try { fs.unlinkSync(tempOriginal); } catch {}
    try { fs.unlinkSync(tempOptimized); } catch {}
    try { fs.unlinkSync(tempThumb); } catch {}

    console.log("✅ Processed:", filePath);
  }
);
