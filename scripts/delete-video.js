// One-shot: delete a YouTube video by ID
import 'dotenv/config';
import { authenticate } from '../src/youtube.js';
import { google } from 'googleapis';

const [,, videoId, channelName = 'sleepless-astronomer'] = process.argv;
if (!videoId) { console.error('Usage: node delete-video.js <videoId> [channelName]'); process.exit(1); }

const auth    = await authenticate(channelName);
const youtube = google.youtube({ version: 'v3', auth });

await youtube.videos.delete({ id: videoId });
console.log(`Deleted: ${videoId}`);
