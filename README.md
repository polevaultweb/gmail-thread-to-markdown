# Gmail Thread to Markdown

Chrome extension (MV3) that copies the open Gmail thread to the clipboard as Markdown, or downloads it as a `.md` file.

## Install

1. Go to `chrome://extensions` and turn on Developer mode
2. Click Load unpacked and pick this folder
3. Pin the extension; the shortcut is ⌥⇧M (change it at `chrome://extensions/shortcuts`)

## Use

Open a conversation in Gmail, click the icon, then pick Copy as Markdown or Download .md. Strip quoted replies (on by default, and remembered) removes the quoted history Gmail adds to each reply, plus Outlook-style "From/Sent" blocks, so each message appears only once.

## How it works

- Clicks Gmail's Expand all, then waits up to 5s for every message body to load
- Reads each message straight from the Gmail DOM (`h2.hP` subject, `.gD` sender, `.g3` date, `.g2` recipients, `.a3s` body, `.aV3` attachment names)
- Converts the body HTML to Markdown itself, with no dependencies
- Permissions: `activeTab`, `scripting`, `clipboardWrite`. It only runs when you click it and makes no network requests

## Known limits

- Gmail's class names are undocumented and could change; if output comes back empty, check those selectors first
- Expand all is found by its English label. Other UI languages fall back to clicking collapsed rows, which is less reliable
- Recipients come from the expanded header, so To and Cc are merged
- Inline images appear as `[image: alt]`; attachments are listed by name only
