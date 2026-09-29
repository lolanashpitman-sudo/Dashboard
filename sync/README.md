# Morning Board calendar + Canvas sync (cloud)

`calendar-sync.mjs` runs inside the 6 AM cloud Routine "Lola's Morning Board refresh".
It reads two feeds from environment variables and fills the board's Today panel and the
To do · Canvas list. No Mac needed.

| Variable | Value |
|---|---|
| `CANVAS_FEED_URL` | Canvas → Calendar → **Calendar Feed** link |
| `ICLOUD_CALENDAR_URLS` | iCloud public calendar link(s), comma-separated (`webcal://p…-caldav.icloud.com/published/2/…`) |

The environment's network access must allow your Canvas host (e.g. `tulane.instructure.com`)
and `*.icloud.com`.

The links are secrets. They live only in the environment settings; the script never prints them.

Test locally: `CANVAS_FEED_URL=… ICLOUD_CALENDAR_URLS=… node sync/calendar-sync.mjs [YYYY-MM-DD]`
