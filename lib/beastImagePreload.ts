type PreloadEntry = {
  image: HTMLImageElement;
  ready: boolean;
  promise: Promise<boolean>;
};

// Retain only a small recent set, not all 100 collection images.
const MAX_RECENT_IMAGES = 6;
const images = new Map<string, PreloadEntry>();

export function isBeastImageReady(path: string): boolean {
  return images.get(path)?.ready === true;
}

/** Warm the browser cache and decode one selected image without delaying unlocks. */
export function preloadBeastImage(path: string): Promise<boolean> {
  if (typeof window === "undefined" || typeof Image === "undefined") {
    return Promise.resolve(false);
  }
  const cached = images.get(path);
  if (cached) return cached.promise;

  const image = new Image();
  image.decoding = "async";
  image.fetchPriority = "high";
  let finish: (ready: boolean) => void = () => {};
  const promise = new Promise<boolean>((resolve) => { finish = resolve; });
  const entry: PreloadEntry = { image, ready: false, promise };
  images.set(path, entry);
  if (images.size > MAX_RECENT_IMAGES) {
    const oldest = images.keys().next().value;
    if (oldest !== undefined) images.delete(oldest);
  }

  let completed = false;
  const settle = (ready: boolean) => {
    if (completed) return;
    completed = true;
    clearTimeout(timeout);
    image.onload = null;
    image.onerror = null;
    entry.ready = ready;
    // Failed requests may be retried; do not retain a permanently failed promise.
    if (!ready && images.get(path) === entry) images.delete(path);
    finish(ready);
  };
  const loaded = async () => {
    if (!image.naturalWidth) { settle(false); return; }
    try {
      if (typeof image.decode === "function") await image.decode();
    } catch {
      // Some older WebViews reject decode even though the image is displayable.
    }
    settle(image.naturalWidth > 0);
  };
  const timeout = setTimeout(() => settle(false), 10000);
  image.onload = () => { void loaded(); };
  image.onerror = () => settle(false);
  image.src = path;
  if (image.complete && image.naturalWidth > 0) void loaded();
  return promise;
}
