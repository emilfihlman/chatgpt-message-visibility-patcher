# ChatGPT Desktop message visibility patch

Keeps assistant and user messages visible when a completed turn's activity is
collapsed in the Linux desktop app. The renderer currently classifies assistant
messages and some user messages as collapsible activity. The patch keeps these
authored messages in the persistent group; duplicate text may remain visible.

[renderer-classifier.patch](renderer-classifier.patch) shows the one-expression
change used by the default `messages` mode. An optional `all` mode keeps turn
activity and tool groups expanded too, and dims content that would normally be
collapsed. Both modes are implemented in [the patcher](patch-message-visibility.mjs).

## Install

For the Debian/APT package named `chatgpt`. Download and extract this repository,
or clone it, then run from its directory:

```sh
sudo sh ./install.sh --mode all
chatgpt-message-visibility --check
```

Choose `--mode messages` instead to keep only authored messages persistent while
retaining the app's activity collapsing. With no mode argument, the installer
keeps your previous selection; the first installation defaults to `messages`.

Fully quit and restart ChatGPT to load the change. A window reload is insufficient:
Electron can retain the old ASAR directory and file offsets in memory. The
installer finds the installed package and
its bundled Node.js runtime, with `/usr/bin/node` as a fallback. No npm install is
needed. It backs up the original archive and installs an APT hook that reapplies
your selected mode after compatible package updates, including renamed renderer
assets. `--check` reports the installed mode and whether this build supports
`all`.

The `all` mode recognizes the relevant syntax and data flow inside the turn and
group renderers instead of requiring their entire functions to match a specific
build. It preserves the app's current hooks, summaries, review controls, and
rendering logic. Renamed variables, changed memo-cache slots, and unrelated
function changes no longer invalidate the whole renderer match. Unknown or
ambiguous collapse logic is still left untouched; future builds can still need
an updated patcher.

If automatic reapplication fails, the helper saves a bounded diagnostic locally.
`--check` displays that warning on stderr alongside its normal JSON stdout,
including the package version and selected mode. Updating the patcher and
successfully applying it clears the warning. APT itself can still finish.
Direct `dpkg -i` installations require running the helper manually:

```sh
sudo /usr/local/bin/chatgpt-message-visibility --apply
```

## Change modes

After installing the latest patcher, switch modes with:

```sh
sudo /usr/local/bin/chatgpt-message-visibility --apply --mode all
# Or retain activity collapsing while keeping authored messages visible:
sudo /usr/local/bin/chatgpt-message-visibility --apply --mode messages
```

Restart ChatGPT after switching. The choice is saved for manual reapplication and
APT updates. Switching modes starts from the matching original backup.

In `all` mode, turn and shared activity-group controls change the dimming state
while their content stays visible. Content that the original collapse state
would hide is dimmed, while its links and controls remain usable. The app's
original expand/collapse labels remain. Nested groups can appear slightly dimmer. Existing
tool-detail filtering and scrollable areas still apply; unrelated disclosures
elsewhere in the app are unaffected.

## Regression checks

Run the synthetic tests without an installed ChatGPT package or npm dependencies:

```sh
node --test tests/patcher.test.mjs
sh test-launcher.sh
```

These cover classifier matching, misleading strings/comments, archive integrity,
unrelated file preservation, exact-backup restoration, mode switching, and
automatic-hook failure reporting. Test fixtures contain no app bundles or
conversation data.

Validated against installed build **26.915.31945** and the original archive from
**26.901.51231**: unrelated packed files remain byte-for-byte identical and both
new and previously published patches restore their exact original backups.
Browser checks of the extracted current turn, classifier, partition, state, and
group functions reproduce the original hiding and verify patched visibility,
ordering, dimming, and DOM/input/focus preservation. These component checks use
synthetic leaf renderers and providers; they do not constitute a complete desktop
end-to-end test.

## Why the September update broke the old patch

The previous `all` implementation recognized the complete renderer functions
from build **26.901.51231**. Later builds changed the turn's input from raw items
to prebuilt units, added review-related controls, and changed compiler-generated
memoization. The APT hook ran, but the old matcher refused the new function, so
the freshly installed app retained its original message-hiding behavior.
The message-only classifier still matched. The updated structural edits avoid
replacing those evolving renderer functions.

## Undo

Disable automatic reapplication, restore the matching original backup, then
restart ChatGPT:

```sh
sudo sh ./install.sh --remove-hook
sudo /usr/local/bin/chatgpt-message-visibility --restore
```

This leaves the helper and backups available. Backups sit beside `app.asar` and
are retained across upgrades.

The patch only affects messages already delivered to the desktop renderer. It
does not recover deleted messages or fix the mobile app. The bundled Acorn
parser checks JavaScript structure before patching and requires its included
[MIT license](vendor/acorn/LICENSE).

All original work on this project was done with **GPT-6 Astra Ultra**.

## License

| Material | License |
| --- | --- |
| Original one-line visibility change: the added expression in `renderer-classifier.patch`, also generated by the patcher | [MIT](LICENSE) **OR** [CC0-1.0](LICENSE-CC0), at your option |
| Our installer, launcher, patcher code (including the expanded renderer in `all` mode), and documentation | [MIT](LICENSE), with the additional option above for the visibility expression |
| Bundled Acorn parser | Its own [MIT license and copyright notice](vendor/acorn/LICENSE) |
| Existing app code shown as patch context or removed lines | Original rights retained; excluded from this project's license grants |

CC0-1.0 is the public-domain dedication option for our original one-line
contribution, with a fallback license if the waiver is ineffective. These grants
cover our original contributions only.
