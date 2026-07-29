/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Delegate widgets
 * ============================================================================= */
/**
 * "Use my current location" for the Missing-location prompts (mobile
 * bottom-sheet and desktop edit modal) — reads the DEVICE's own GPS/browser
 * location as a stand-in for "where I am right now, marking this delegate
 * missing", not a live track of the delegate themselves (this app has no
 * delegate-side location reporting — see DelegateLocationMap.jsx). Requires
 * the browser's Geolocation permission; the caller is expected to show a
 * "turn on GPS/location" message on PERMISSION_DENIED (see ERROR_MESSAGE_KEY
 * below for a ready-made string per error type).
 */

/** Maps a GeolocationPositionError code to a translatable message key the
 *  caller can pass through t(). PERMISSION_DENIED gets its own clearer copy
 *  since that's the one the user can actually fix themselves (browser/OS
 *  settings) — the others are transient/environmental. */
export function geolocationErrorMessage(err) {
  if (err?.code === 1 /* PERMISSION_DENIED */) {
    return "Location access is off. Turn on GPS/location permission for this site in your browser or device settings, then try again.";
  }
  if (err?.code === 2 /* POSITION_UNAVAILABLE */) {
    return "Couldn't get a location fix. Try again somewhere with a clearer GPS signal.";
  }
  if (err?.code === 3 /* TIMEOUT */) {
    return "Location took too long to respond. Try again.";
  }
  return "Couldn't get your location. Please type it in manually.";
}

/** Reverse-geocodes {lat, lng} into a human-readable place name via
 *  OpenStreetMap's Nominatim (2026-07-25 — switched from Google's Geocoding
 *  API, which needs billing enabled on the Google Cloud project; Nominatim
 *  is free, no API key, no billing, ever). Best-effort: returns null on any
 *  failure (network error, no result) so the caller falls back to plain
 *  coordinates rather than blocking on this.
 *
 *  Nominatim's usage policy (no API key = shared public server) asks for:
 *  a real identifying User-Agent/Referer (the browser sends Referer
 *  automatically) and no more than ~1 request/second — both trivially true
 *  for an occasional "use my current location" click by field staff. If
 *  this app's request volume ever grows a lot, self-hosting Nominatim or
 *  switching to a paid provider would be the next step, but that's not
 *  needed at this app's scale. */
async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&addressdetails=0`,
      { headers: { Accept: "application/json" } }
    );
    const data = await res.json();
    return data?.display_name || null;
  } catch {
    return null;
  }
}

/**
 * Resolves the device's current location as a display string suitable for
 * the "Last known location" field — a real place name when reverse
 * geocoding succeeds, otherwise plain "lat, lng" coordinates (which the
 * Google/AMap embeds in DelegateLocationMap.jsx can both still resolve as a
 * map query even without a name). Rejects with the raw GeolocationPositionError
 * (or a synthetic {code: 0} on unsupported browsers) — pass it to
 * geolocationErrorMessage() for display.
 */
export function getCurrentLocationString() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject({ code: 0 });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude.toFixed(5);
        const lng = pos.coords.longitude.toFixed(5);
        const name = await reverseGeocode(lat, lng);
        resolve(name || `${lat}, ${lng}`);
      },
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}
