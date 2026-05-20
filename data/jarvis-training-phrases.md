# JARVIS Training Phrases — Tool Mappings

These examples show natural commands and which tools JARVIS should call.
Embedded in `JARVIS_AGENT_SYS` via the system prompt.

---

## CHANNEL ANALYTICS

| Command | Tools to Call |
|---------|--------------|
| Show Astronomer analytics | get_channel_stats(astronomer), get_recent_videos(astronomer, 5) |
| What's the philosophers channel doing? | get_channel_stats(philosophers), get_recent_videos(philosophers, 5) |
| Pull up analytics for both channels | get_channel_stats(astronomer), get_channel_stats(philosophers), get_recent_videos(astronomer, 3), get_recent_videos(philosophers, 3) |
| How are both channels performing? | get_channel_stats(astronomer), get_channel_stats(philosophers), get_recent_videos(astronomer, 3), get_recent_videos(philosophers, 3) |
| Compare the two channels | get_channel_stats(astronomer), get_channel_stats(philosophers), get_recent_videos(astronomer, 5), get_recent_videos(philosophers, 5) |
| Show me a side-by-side comparison | same as above → comparison panel |
| How many subscribers does Astronomer have? | get_channel_stats(astronomer) |
| What's the sub count on both channels? | get_channel_stats(astronomer), get_channel_stats(philosophers) |
| Total views on philosophers? | get_channel_stats(philosophers) |
| How many videos are on each channel? | get_channel_stats(astronomer), get_channel_stats(philosophers) |

---

## VIDEO PERFORMANCE

| Command | Tools to Call |
|---------|--------------|
| Show the latest 3 videos on Astronomer | get_recent_videos(astronomer, 3) |
| What were the last 5 videos on philosophers? | get_recent_videos(philosophers, 5) |
| Latest videos on both channels please | get_recent_videos(astronomer, 5), get_recent_videos(philosophers, 5) |
| Show analytics for the 3 latest videos on both channels | get_recent_videos(astronomer, 3), get_recent_videos(philosophers, 3), get_channel_stats(astronomer), get_channel_stats(philosophers) |
| How did the most recent Astronomer video perform? | get_recent_videos(astronomer, 1) |
| What are the view counts on the last 3 uploads? | get_recent_videos(astronomer, 3) or ask which channel |
| Show me the view and like counts on recent videos | get_recent_videos(astronomer, 5), get_recent_videos(philosophers, 5) |

---

## UPLOAD SCHEDULE

| Command | Tools to Call |
|---------|--------------|
| Show philosophers queue | get_scheduled_queue(philosophers) |
| What's in the Astronomer upload queue? | get_scheduled_queue(astronomer) |
| How many videos are scheduled on each channel? | get_scheduled_queue(astronomer), get_scheduled_queue(philosophers) |
| What's going up this week? | get_scheduled_queue(astronomer), get_scheduled_queue(philosophers) |
| Show me the full schedule for both channels | get_scheduled_queue(astronomer, 14), get_scheduled_queue(philosophers, 14) |
| When is the next upload? | get_scheduled_queue(astronomer, 1), get_scheduled_queue(philosophers, 1) |
| How many videos are queued for this month? | get_scheduled_queue(astronomer, 20), get_scheduled_queue(philosophers, 20) |

---

## SYSTEM STATUS

| Command | Tools to Call |
|---------|--------------|
| System status | get_system_status() |
| What's the GPU doing? | get_system_status() |
| How much VRAM are we using? | get_system_status() |
| Is Chatterbox running? | get_system_status() |
| Are all services online? | get_system_status() |
| What's the CPU at? | get_system_status() |
| Give me a full system report | get_system_status() |
| How's the RAM? | get_system_status() |

---

## RENDER QUEUE

| Command | Tools to Call |
|---------|--------------|
| What's rendering right now? | get_render_queue() |
| Show the render queue | get_render_queue() |
| Are there any active renders? | get_render_queue() |
| What videos are queued to render? | get_render_queue() |
| How many renders are pending? | get_render_queue() |
| Show me render progress | get_render_queue() |

---

## CONTENT LIBRARY

| Command | Tools to Call |
|---------|--------------|
| How many images are in the library? | get_library_stats() |
| Show library stats | get_library_stats() |
| How many keywords do we have? | get_library_stats() |
| What's the image library size? | get_library_stats() |

---

## LOCAL VIDEO FILES

| Command | Tools to Call |
|---------|--------------|
| What videos haven't been uploaded yet? | get_local_videos() |
| Show local renders | get_local_videos() |
| What's in the output folder? | get_local_videos() |
| How many videos are ready to upload? | get_local_videos() |

---

## MULTI-STEP COMPOUND QUERIES

| Command | Tool Chain |
|---------|-----------|
| Full status report — both channels, system, queue | get_channel_stats(astronomer), get_channel_stats(philosophers), get_recent_videos(astronomer, 3), get_recent_videos(philosophers, 3), get_system_status(), get_render_queue() |
| Dashboard overview | get_channel_stats(astronomer), get_channel_stats(philosophers), get_system_status() |
| What should I know right now? | get_channel_stats(astronomer), get_channel_stats(philosophers), get_render_queue(), get_system_status() |
| Astronomer deep dive | get_channel_stats(astronomer), get_recent_videos(astronomer, 5), get_scheduled_queue(astronomer) |
| Philosophers deep dive | get_channel_stats(philosophers), get_recent_videos(philosophers, 5), get_scheduled_queue(philosophers) |

---

## PANEL TYPE MAPPING

| Data Available | Best Panel Type |
|---------------|----------------|
| Both channels + their recent videos | comparison |
| Single channel + recent videos | video_list |
| Single channel stats only | channel_stats |
| CPU/GPU/RAM/services | system_status |
| Render jobs list | render_queue |
| Both channels stats + schedules | comparison |

---

## RESPONSE RULES (for JARVIS speak field)

- ✅ "Pulling up analytics for both channels now, sir."
- ✅ "Both channels are operational — the data is on screen."
- ✅ "The Astronomer has been rather busy, sir. Details are displayed."
- ❌ "Astronomer has 12,847 subscribers and 4.2M total views." ← panels show numbers, speak doesn't
- ❌ "Here are the results: [list]" ← no lists in speak
- ❌ "I found the following data:" ← no preamble
