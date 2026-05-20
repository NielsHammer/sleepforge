#!/usr/bin/env node
// Quick diagnostic: check YouTube upload/processing status for a video ID
import { getVideoProcessingStatus } from '../src/youtube.js';
import { google } from 'googleapis';
import { authenticate } from '../src/youtube.js';

const [,, videoId, channelName = 'sleepless-astronomer'] = process.argv;
if (!videoId) { console.error('Usage: node check-video-status.js <videoId> [channelName]'); process.exit(1); }

async function main() {
  console.log(`Checking video ${videoId} on channel ${channelName}...`);

  // Verify token / channel identity
  const auth = await authenticate(channelName);
  const youtube = google.youtube({ version: 'v3', auth });
  const chanRes = await youtube.channels.list({ part: ['snippet'], mine: true });
  const chan = chanRes.data.items?.[0];
  console.log(`\nChannel: ${chan?.snippet?.title || '(unknown)'} (id: ${chan?.id})`);

  // Video status
  const status = await getVideoProcessingStatus(videoId, channelName);
  if (!status) {
    console.log(`\nVideo ${videoId} NOT FOUND via this token.`);
  } else {
    console.log(`\nVideo ${videoId}:`);
    console.log(`  uploadStatus:     ${status.uploadStatus}`);
    console.log(`  privacyStatus:    ${status.privacyStatus}`);
    console.log(`  publishAt:        ${status.publishAt || '(none)'}`);
    console.log(`  processingStatus: ${status.processingStatus || '(none)'}`);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
