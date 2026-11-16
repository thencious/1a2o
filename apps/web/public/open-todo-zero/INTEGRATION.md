# Open Todo Zero in 1a2o

Vendored from [thencious/open-todo-zero](https://github.com/thencious/open-todo-zero), commit `eefb400630da278296f1ee6990a1dae7a8daadb2` (MIT).

The original checklist, Markdown editor, priorities, reordering, deadlines, and browser/ntfy notification implementation are retained. `host.js` connects the embedded app to authenticated 1a2o server actions, encrypted local snapshots, shared OpenRouter quotas and usage attribution, and main-tab keyboard navigation. `host.css` matches 1a2o's neutral dark background.

Local changes in `app.js` add snapshot saves and managed AI button labels. `openrouter.js` uses the host connection when embedded, preserving the upstream model order, time context and response parsing. The deadline tool now also returns calendar timing in the same call; task automation and AI language rules are managed under Tools > Rules > Tasks. `index.html` supplies the host script and authenticated bootstrap marker. No API key is sent to the browser. AI runs on the same explicit confirmation/update triggers as upstream.

Task storage is shared across 1a2o's mail accounts and separate from the original hosted checklist. Existing hosted snapshots can be imported once by the installation owner; this does not create ongoing cross-site synchronization. Local backups contain personal data and belong outside the public assets directory.

The optional hosted Worker is not deployed by this integration. Browser alerts need the task tab open; already scheduled ntfy alerts can arrive after closing. See `THIRD_PARTY_NOTICES.md` for bundled editor and sanitizer licenses.

Task sections scroll independently. Completed starts compact, and the horizontal boundaries support pointer dragging and Up/Down keys (Shift for larger steps, Home/End for limits). Section sizes are stored as device preferences and restored when filters or viewport dimensions change.

Timed tasks create timed events, and date-only tasks create all-day events in the selected default task calendar. Calendar writes always check existing calendars and saved tasks on the affected days. Possible duplicates require a user choice; writes reuse persistent request IDs across retries. Existing event notes, attendees and locations are preserved on confirmed updates.

ntfy configuration and access tokens are stored in encrypted local integration settings. The existing background service checks task alerts independently of the Tasks tab, queues notifications within the scheduling window, and cancels/replaces changed reminders. Already queued alerts can arrive after the computer turns off; farther alerts require the local service to be running when they enter the window.

The vertical task list/editor separator supports dragging and Left/Right keys, with the chosen width saved on the device. The mobile layout retains its inline editor.
