import 'dotenv/config';
import { uploadThumbnail } from '../src/youtube.js';

const VIDEO_ID = 'nQIjOBAWMHY';
const CHANNEL  = 'sleepless-astronomer';
const THUMB    = 'output/voyager-1-the-farthest-human-made-object-and-what-it-te/thumbnails/rethumb-v1-2026-05-19T23-24-13/thumbnail.png';

console.log('Uploading V1 "STILL TALKING" to', VIDEO_ID);
await uploadThumbnail(VIDEO_ID, THUMB, CHANNEL);
console.log('✅ Done — https://studio.youtube.com/video/' + VIDEO_ID + '/edit');
