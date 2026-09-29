# Morning Board: 6 AM calendar + Canvas sync (Mac)

The board lives at https://claude.ai/artifact/Xoom6tnzpMY2nNvAb3Dpu5.

Two jobs keep it fresh:

| Time (New Orleans) | Where | What it updates |
|---|---|---|
| 5:50 AM | Cloud Routine "Lola's Morning Board refresh" | Headlines, weather, outfit, For today, Listen/Read/Do, job statuses |
| 6:00 AM | Scheduled task in the Claude desktop app on your Mac | Today's events, Next up, and the Canvas to-do list (plus fresh Pinterest photos) |

The Mac task only runs while the Claude desktop app is open and the Mac is awake.

## One-time setup

1. Download `morning-calendar.js` (sent to you in chat, or from `mac/` in this repo) to your Mac's Downloads folder.
2. Open the **Claude desktop app** on your Mac and start a new task.
3. Paste the whole block below and send it. Replace `PASTE_YOUR_CANVAS_FEED_LINK` with your link from
   Canvas → Calendar → **Calendar Feed** first.
4. When the task is created, click **Run now** once and approve the prompts (Calendar access, `osascript`,
   publishing the artifact). After that it runs by itself at 6:00 AM.
5. Keep the app open overnight. Optional: have the Mac wake at 5:55 AM every day by running this in Terminal:
   `sudo pmset repeat wakeorpoweron MTWRFSU 05:55:00`

```text
Create a scheduled task called "Morning Board calendar sync" that runs every day at 6:00 AM my time.

Setup (do this now, once):
- Copy ~/Downloads/morning-calendar.js into the scheduled task's own folder (keep the name morning-calendar.js).
- In that saved copy, replace PASTE_YOUR_CANVAS_CALENDAR_FEED_LINK_HERE with: PASTE_YOUR_CANVAS_FEED_LINK
- Treat that Canvas link like a password: keep it only in that local script. Never put it on the page,
  in the task prompt, in a summary, or in any output.
- Run it once with: osascript -l JavaScript "<path>/morning-calendar.js"
  and approve Calendar access if macOS asks.

Each run:
1. Run the script with osascript -l JavaScript. It prints JSON: {synced, events, next, todo}.
   Validate it by parsing it (osascript -l JavaScript can JSON.parse; python3 may not be installed).
2. Read the artifact https://claude.ai/artifact/Xoom6tnzpMY2nNvAb3Dpu5 with the Artifact tool, then read
   path "index.html" to get the saved page. Keep everything from "<title>" up to the final "</body></html>"
   (drop the wrapper the service adds).
3. In the JSON inside <script id="board-data" type="application/json">, replace only:
   - schedule = {synced, events, next} from the script
   - todo = todo from the script
   Leave every other field (news, fashion, culture, mood, covers, jobs, affirmation, dates) exactly as it is:
   the cloud refresh at 5:50 AM already updated them. If "updated" is not today's date, the cloud run
   didn't happen, so also set updated/dateLabel to today and write a fresh "For today" line.
   Escape "</" as "<\/" when writing the JSON back, and validate it by parsing it again.
4. Optional: refresh Pinterest photos from https://www.pinterest.com/lolanashpitman/<board>.rss
   (swap /236x/ for /474x/, look at every image before using it, resize with sips -Z 800) and save them over
   pins/p1.jpg … p6.jpg, pins/wear.jpg and pins/eat.jpg; keep mood.photos board names and links matching.
5. Republish with the Artifact tool to the same url, passing any new image files in "files". Don't pass an
   icon. If the publish reports a conflict, re-read the artifact, re-apply only schedule/todo (and pins),
   and publish again.
6. Finish with a 3-line summary: events today, to-do items, anything that failed. Never print the Canvas link.
```

## What the script reads

- **Apple Calendar**: every calendar on the Mac, through EventKit, so repeating events show up. A calendar
  whose name contains "Canvas" is skipped because the feed is read directly.
- **Canvas feed**: assignments and due dates become the **To do · Canvas** list (checkboxes on the page are
  remembered in your browser). Other Canvas events, like class sessions, go into Today / Next up.
- Range: today plus the next 7 days.
