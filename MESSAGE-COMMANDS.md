# Message commands

Type `/invite` in a Messages conversation and press Enter or Send. Zenro handles
the command locally; it is never posted to the conversation.

The command retrieves the latest 50 nonempty text lines, including multiline
messages, from that conversation. One quota-limited OpenRouter request identifies
the most recent meeting discussion and its latest agreed details. Times use the
message timestamps and the user's local timezone, including the configured
late-night tomorrow rule. Missing details are left for review rather than invented.

Guest email resolution prefers the conversation, then an exact normalized-name
match in Contacts. Matching ignores case, equivalent Unicode, and extra spaces;
it does not fuzzy-match names or guess between ambiguous contacts. If there is
still no email, the composer receives this unsent draft:

> May I have your email for a meeting invite?

Otherwise, the calendar editor opens with an editable proposal. The final
**Create and send invitation** action creates the event and notifies the listed
calendar guests. Preparing or cancelling does not create an event or send a message.

Settings → Calendars contains:

- Default calendar, used by `/invite` and **New event** in Calendars.
- Online meeting service: Google Meet or Zoom.
- A Zoom personal meeting room link when Zoom is selected.

Physical meetings use their agreed location. Online meetings keep any existing
agreed HTTPS meeting link. Otherwise Google Meet creates a new conference on a
Google calendar, or Zoom uses the saved personal room link. A new Zoom meeting
is not generated through the Zoom API. Calendar providers send invitations via
their native event APIs; no separate email is composed by Zenro.

The settings are encrypted per user on the server and survive restarts. Existing
event copies and edits retain their calendar; choosing a calendar for one event
does not silently change the saved default.

## Contact capture and command menu

Type `/` as the first character of a message to open the command picker. Filter by
continuing to type, use Up/Down to select, and Enter to insert the selected command.
Press Enter again (or Send) to run it. Escape dismisses the picker. A complete
command such as `/add` can also be run directly with Enter.

`/add` reads the most recent 100 nonempty conversation lines. One quota-limited
OpenRouter call extracts contact details with supporting message IDs. Names match
Contacts exactly after Unicode, case and whitespace normalization. Existing people
receive additional values; unmatched names become new contacts. Ambiguous names
are skipped and reported. Repeated imports preserve distinct values without
replacing old details. Unsupported or invented values are rejected.

The additions are encrypted, saved in Zenro, merged with all contact sources on
refresh, and available to `/invite`. Provider address books are not modified.
The command is never sent into the conversation. Any text typed while the command
is running is preserved. Results show new/updated counts and ambiguity warnings.

## Slash requests throughout Zenro

Typing `/` at the start of an app input opens Chat with the originating tab,
input field, and selected item attached as context. Finish and submit the request
in Chat. Its command picker supports Up/Down, Enter, and Escape. The original
input stays unchanged, and an existing Chat draft can be restored when cancelling.
Origin metadata is saved with chat history separately from the visible request.

Messages keeps its native `/add` and `/invite` commands. Other slash requests
submitted in Messages go to Chat with the selected conversation attached, rather
than being sent to the contact. Native agent terminal commands remain in the CLI.
