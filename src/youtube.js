/**
 * SleepForge YouTube module
 *
 * authenticate(channelName)   — load/refresh OAuth token, throw if not yet added
 * uploadVideo(opts)           — upload mp4, returns videoId
 * uploadThumbnail(...)        — attach custom thumbnail
 * getVideoStats(videoId, ...) — views, likes, watch time, CTR, retention
 *
 * Tokens are stored per channel in assets/youtube-tokens/<channelName>.json
 * Credentials come from .youtube-credentials.json (desktop OAuth2 app)
 */

import { google } from "googleapis";
import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, "..");

const CREDS_PATH = path.join(ROOT, ".youtube-credentials.json");
const TOKENS_DIR = path.join(ROOT, "assets", "youtube-tokens");

export const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];

// Port for the local OAuth redirect server
export const OAUTH_PORT = 8080;

// ─── INTERNAL HELPERS ────────────────────────────────────────────────────────

function loadCreds() {
  if (!fs.existsSync(CREDS_PATH)) {
    throw new Error(`Missing ${CREDS_PATH} — place your Google OAuth2 credentials there.`);
  }
  const raw = JSON.parse(fs.readFileSync(CREDS_PATH, "utf-8"));
  return raw.installed || raw.web;
}

function tokenPath(channelName) {
  return path.join(TOKENS_DIR, `${channelName}.json`);
}

// ─── getOAuth2Client ─────────────────────────────────────────────────────────
// Returns a configured OAuth2 client (no credentials loaded yet).
// Exported so youtube-add-channel.js can reuse it.

export function getOAuth2Client() {
  const creds = loadCreds();
  // Google accepts http://localhost:<any port> when http://localhost is registered
  return new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    `http://localhost:${OAUTH_PORT}`
  );
}

// ─── authenticate ─────────────────────────────────────────────────────────────
// Loads saved token for channelName, refreshes if expired.
// Throws if no token found (run youtube-add-channel.js first).

export async function authenticate(channelName) {
  const tp = tokenPath(channelName);
  if (!fs.existsSync(tp)) {
    throw new Error(
      `No token for channel "${channelName}".\n` +
      `Run: node scripts/youtube-add-channel.js`
    );
  }

  const oauth2Client = getOAuth2Client();
  const saved = JSON.parse(fs.readFileSync(tp, "utf-8"));
  oauth2Client.setCredentials(saved);

  // Auto-refresh if token is expired or within 5 min of expiry
  if (saved.expiry_date && saved.expiry_date < Date.now() + 300_000) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      fs.mkdirSync(TOKENS_DIR, { recursive: true });
      fs.writeFileSync(tp, JSON.stringify(credentials, null, 2));
      oauth2Client.setCredentials(credentials);
    } catch (err) {
      throw new Error(`Token refresh failed for "${channelName}": ${err.message}`);
    }
  }

  return oauth2Client;
}

// ─── uploadVideo ──────────────────────────────────────────────────────────────
// opts: { channelName, videoPath, title, description, tags[], thumbnailPath?,
//         scheduledAt? (Date|ISO string), privacyStatus? }
// Returns: YouTube video ID (string)

export async function uploadVideo({
  channelName,
  videoPath,
  title,
  description,
  tags = [],
  thumbnailPath = null,
  scheduledAt   = null,
  privacyStatus = "private",
}) {
  const auth    = await authenticate(channelName);
  const youtube = google.youtube({ version: "v3", auth });

  const fileSize = fs.statSync(videoPath).size;
  const sizeMb   = (fileSize / 1024 / 1024).toFixed(1);
  console.log(`  Uploading ${sizeMb} MB to YouTube...`);

  // Scheduled upload: privacyStatus must be "private" with a publishAt date
  const status = scheduledAt
    ? { privacyStatus: "private", publishAt: new Date(scheduledAt).toISOString(), selfDeclaredMadeForKids: false }
    : { privacyStatus, selfDeclaredMadeForKids: false };

  let lastPct = -1;
  const res = await youtube.videos.insert(
    {
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title,
          description,
          tags,
          categoryId: "27",      // Education
          defaultLanguage: "en",
        },
        status,
      },
      media: {
        mimeType: "video/mp4",
        body: fs.createReadStream(videoPath),
      },
    },
    {
      onUploadProgress: (evt) => {
        const pct = Math.round((evt.bytesRead / fileSize) * 100);
        if (pct !== lastPct && pct % 10 === 0) {
          process.stdout.write(`\r  Upload progress: ${pct}%  `);
          lastPct = pct;
        }
      },
    }
  );
  console.log("\r  Upload complete.          ");

  const videoId = res.data.id;
  console.log(`  Video ID: ${videoId}`);
  if (scheduledAt) {
    console.log(`  Scheduled: ${new Date(scheduledAt).toLocaleString()}`);
  }

  // Attach thumbnail if provided
  if (thumbnailPath && fs.existsSync(thumbnailPath)) {
    await uploadThumbnail(videoId, thumbnailPath, channelName);
  }

  return videoId;
}

// ─── uploadThumbnail ─────────────────────────────────────────────────────────

export async function uploadThumbnail(videoId, thumbnailPath, channelName) {
  const auth    = await authenticate(channelName);
  const youtube = google.youtube({ version: "v3", auth });

  const ext      = path.extname(thumbnailPath).toLowerCase();
  const mimeType = ext === ".png" ? "image/png" : "image/jpeg";

  await youtube.thumbnails.set({
    videoId,
    media: {
      mimeType,
      body: fs.createReadStream(thumbnailPath),
    },
  });
  console.log(`  Thumbnail uploaded: ${path.basename(thumbnailPath)}`);
}

// ─── getVideoProcessingStatus ────────────────────────────────────────────────
// Returns { uploadStatus, privacyStatus, publishAt, processingStatus } or null.
// uploadStatus values: 'deleted' | 'failed' | 'processed' | 'rejected' | 'uploaded'
// processingStatus values: 'processing' | 'succeeded' | 'failed' | 'terminated'

export async function getVideoProcessingStatus(videoId, channelName) {
  const auth    = await authenticate(channelName);
  const youtube = google.youtube({ version: "v3", auth });
  const res = await youtube.videos.list({
    part: ["status", "processingDetails"],
    id:   [videoId],
  });
  const item = res.data.items?.[0];
  if (!item) return null;
  return {
    uploadStatus:      item.status?.uploadStatus,
    privacyStatus:     item.status?.privacyStatus,
    publishAt:         item.status?.publishAt || null,
    processingStatus:  item.processingDetails?.processingStatus || null,
  };
}

// ─── getVideoStats ────────────────────────────────────────────────────────────
// Returns: { views, likes, watch_time_minutes, ctr, retention_avg_pct }
// Analytics fields may be null if the video is too new (data lag ~24-48h).

export async function getVideoStats(videoId, channelName) {
  const auth    = await authenticate(channelName);
  const youtube = google.youtube({ version: "v3", auth });

  // Basic stats (available immediately)
  const statsRes = await youtube.videos.list({
    part: ["statistics"],
    id: [videoId],
  });
  const stats = statsRes.data.items?.[0]?.statistics || {};

  // Analytics stats — watch time, CTR, retention (24-48h data lag)
  let watch_time_minutes = null;
  let ctr                = null;
  let retention_avg_pct  = null;

  try {
    const analytics = google.youtubeAnalytics({ version: "v2", auth });
    const today     = new Date().toISOString().split("T")[0];
    const epoch     = "2020-01-01";

    const aRes = await analytics.reports.query({
      ids:        "channel==MINE",
      startDate:  epoch,
      endDate:    today,
      metrics:    "estimatedMinutesWatched,cardClickRate,averageViewPercentage",
      dimensions: "video",
      filters:    `video==${videoId}`,
    });

    const row = aRes.data.rows?.[0];
    if (row) {
      watch_time_minutes = row[1];
      ctr                = row[2];
      retention_avg_pct  = row[3];
    }
  } catch {
    // Analytics API not enabled, or data not yet available — return nulls
  }

  return {
    views:              parseInt(stats.viewCount  || 0),
    likes:              parseInt(stats.likeCount  || 0),
    watch_time_minutes,
    ctr,
    retention_avg_pct,
  };
}
