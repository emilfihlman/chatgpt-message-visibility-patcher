#!/bin/sh
# SPDX-License-Identifier: MIT
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
if [ "$(id -u)" != 0 ]; then
  printf '%s\n' 'Run sudo sh ./install.sh [--mode messages|all] to install, or sudo sh ./install.sh --remove-hook to disable automatic reapplication.' >&2
  exit 1
fi
hook=/etc/apt/apt.conf.d/99-chatgpt-message-visibility
case "${1:-}" in
  --remove-hook)
    if [ "$#" != 1 ]; then exit 1; fi
    rm -f -- "$hook"
    printf '%s\n' 'APT hook removed. The existing patch and backups are retained.'
    exit 0
    ;;
  '') ;;
  --mode)
    if [ "$#" != 2 ]; then
      printf '%s\n' 'Usage: sudo sh ./install.sh [--mode messages|all | --remove-hook]' >&2
      exit 1
    fi
    case "$2" in
      messages|all) ;;
      *) printf '%s\n' 'Mode must be messages or all.' >&2; exit 1 ;;
    esac
    ;;
  *) printf '%s\n' 'Usage: sudo sh ./install.sh [--mode messages|all | --remove-hook]' >&2; exit 1 ;;
esac
source_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
install -d -o root -g root -m 0755 /usr/local/lib/chatgpt-message-visibility/vendor/acorn /usr/local/bin /etc/apt/apt.conf.d
install -o root -g root -m 0644 "$source_directory/patch-message-visibility.mjs" /usr/local/lib/chatgpt-message-visibility/patch-message-visibility.mjs
install -o root -g root -m 0644 "$source_directory/LICENSE" "$source_directory/LICENSE-CC0" /usr/local/lib/chatgpt-message-visibility/
install -o root -g root -m 0644 "$source_directory/vendor/acorn/acorn.mjs" "$source_directory/vendor/acorn/LICENSE" /usr/local/lib/chatgpt-message-visibility/vendor/acorn/
install -o root -g root -m 0755 "$source_directory/chatgpt-message-visibility" /usr/local/bin/chatgpt-message-visibility
# Apply before registering automatic runs. The launcher saves the mode only on
# success; without --mode it keeps the previous choice (initially messages).
/usr/local/bin/chatgpt-message-visibility --apply "$@"
hook_temp=$(mktemp /etc/apt/apt.conf.d/.chatgpt-message-visibility.XXXXXX)
trap 'rm -f -- "$hook_temp"' EXIT HUP INT TERM
printf '%s\n' 'DPkg::Post-Invoke { "/usr/local/bin/chatgpt-message-visibility --apt-hook || true"; };' > "$hook_temp"
chown root:root "$hook_temp"
chmod 0644 "$hook_temp"
mv -f -- "$hook_temp" "$hook"
trap - EXIT HUP INT TERM
printf '%s\n' 'Installed chatgpt-message-visibility and automatic APT reapplication.'
