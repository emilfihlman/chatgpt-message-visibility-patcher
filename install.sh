#!/bin/sh
# SPDX-License-Identifier: MIT
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
if [ "$(id -u)" != 0 ]; then
  printf '%s\n' 'Run sudo ./install.sh to install, or sudo ./install.sh --remove-hook to disable automatic reapplication.' >&2
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
  *) printf '%s\n' 'Usage: sudo ./install.sh [--remove-hook]' >&2; exit 1 ;;
esac
source_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
install -d -o root -g root -m 0755 /usr/local/lib/chatgpt-message-visibility/vendor/acorn /usr/local/bin /etc/apt/apt.conf.d
install -o root -g root -m 0644 "$source_directory/patch-message-visibility.mjs" /usr/local/lib/chatgpt-message-visibility/patch-message-visibility.mjs
install -o root -g root -m 0644 "$source_directory/LICENSE" "$source_directory/UNLICENSE" /usr/local/lib/chatgpt-message-visibility/
install -o root -g root -m 0644 "$source_directory/vendor/acorn/acorn.mjs" "$source_directory/vendor/acorn/LICENSE" /usr/local/lib/chatgpt-message-visibility/vendor/acorn/
install -o root -g root -m 0755 "$source_directory/chatgpt-message-visibility" /usr/local/bin/chatgpt-message-visibility
# Confirm this package is supported and apply before registering automatic runs.
/usr/local/bin/chatgpt-message-visibility --apply
hook_temp=$(mktemp /etc/apt/apt.conf.d/.chatgpt-message-visibility.XXXXXX)
trap 'rm -f -- "$hook_temp"' EXIT HUP INT TERM
printf '%s\n' 'DPkg::Post-Invoke { "/usr/local/bin/chatgpt-message-visibility --apt-hook || true"; };' > "$hook_temp"
chown root:root "$hook_temp"
chmod 0644 "$hook_temp"
mv -f -- "$hook_temp" "$hook"
trap - EXIT HUP INT TERM
printf '%s\n' 'Installed chatgpt-message-visibility and automatic APT reapplication.'
