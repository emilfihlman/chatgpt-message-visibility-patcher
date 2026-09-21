#!/bin/sh
# SPDX-License-Identifier: MIT
# Exercise the installed launcher with isolated paths and a fake package/runtime.
set -eu
source_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT HUP INT TERM
export PATCHER_TEST_ROOT="$fixture"
mkdir -p "$fixture/bin" "$fixture/lib/chatgpt-message-visibility" "$fixture/lock" "$fixture/apt"
sed -e "s|PATH=/usr/sbin:/usr/bin:/sbin:/bin|PATH=$fixture/bin:/usr/sbin:/usr/bin:/sbin:/bin|" \
  -e "s|/usr/local/bin|$fixture/bin|g" \
  -e "s|/usr/local/lib|$fixture/lib|g" \
  -e "s|/run/lock|$fixture/lock|g" \
  "$source_directory/chatgpt-message-visibility" > "$fixture/bin/chatgpt-message-visibility"
sed -e "s|PATH=/usr/sbin:/usr/bin:/sbin:/bin|PATH=$fixture/bin:/usr/sbin:/usr/bin:/sbin:/bin|" \
  -e "s|/usr/local/lib|$fixture/lib|g" \
  -e "s|/etc/apt/apt.conf.d|$fixture/apt|g" \
  "$source_directory/install.sh" > "$fixture/install.sh"
cat > "$fixture/bin/id" <<'EOF'
#!/bin/sh
if [ -f "$PATCHER_TEST_ROOT/nonroot" ]; then printf '1000\n'; else printf '0\n'; fi
EOF
cat > "$fixture/bin/chown" <<'EOF'
#!/bin/sh
exit 0
EOF
cat > "$fixture/bin/dpkg-query" <<'EOF'
#!/bin/sh
case "$1:$2" in
  '-W:-f=${db:Status-Status}')
    if [ -f "$PATCHER_TEST_ROOT/removed" ]; then printf 'not-installed\n'; else printf 'installed\n'; fi ;;
  '-W:-f=${Version}') printf 'test-version\n' ;;
  '-L:chatgpt') printf '%s/runtime/resources/cua_node/bin/node\n' "$PATCHER_TEST_ROOT" ;;
  *) exit 1 ;;
esac
EOF
mkdir -p "$fixture/runtime/resources/cua_node/bin"
cat > "$fixture/runtime/resources/cua_node/bin/node" <<'EOF'
#!/bin/sh
shift
if [ "$1" = --apply ] && [ -f "$PATCHER_TEST_ROOT/fail" ]; then
  printf 'chatgpt-message-visibility: Test unsupported renderer.\n' >&2
  exit 1
fi
printf '%s\n' '{"status":"patched","mode":"all","result":"Already patched in all mode; no changes."}'
EOF
chmod +x "$fixture/bin/"* "$fixture/runtime/resources/cua_node/bin/node"
launcher="$fixture/bin/chatgpt-message-visibility"
status_file="$fixture/lib/chatgpt-message-visibility/last-hook-failure"
printf 'all\n' > "$fixture/lib/chatgpt-message-visibility/mode"
touch "$fixture/fail"
"$launcher" --apt-hook > "$fixture/stdout" 2> "$fixture/stderr"
test -s "$status_file"
grep -q 'selected mode all' "$status_file"
grep -q 'ChatGPT test-version' "$status_file"
grep -q 'Test unsupported renderer' "$status_file"
grep -q 'APT can continue' "$fixture/stderr"
test "$(wc -c < "$status_file")" -lt 9000

# A regular user's check keeps JSON on stdout and exposes the saved failure.
touch "$fixture/nonroot"
"$launcher" --check > "$fixture/stdout" 2> "$fixture/stderr"
grep -q '"status":"patched"' "$fixture/stdout"
grep -q 'Automatic reapplication failed' "$fixture/stderr"
rm "$fixture/nonroot" "$fixture/fail"

# An explicit archive is independent and must not erase the installed status.
"$launcher" --apply "$fixture/example.asar" > "$fixture/stdout" 2> "$fixture/stderr"
test -s "$status_file"
"$launcher" --check "$fixture/example.asar" > "$fixture/stdout" 2> "$fixture/stderr"
test ! -s "$fixture/stderr"

# A successful manual application clears the failure and saves the selection.
"$launcher" --apply --mode messages > "$fixture/stdout" 2> "$fixture/stderr"
test ! -e "$status_file"
test "$(cat "$fixture/lib/chatgpt-message-visibility/mode")" = messages
"$launcher" --check > "$fixture/stdout" 2> "$fixture/stderr"
test ! -s "$fixture/stderr"

# Successful hooks also clear failures and remain quiet when already applied.
touch "$fixture/fail"
"$launcher" --apt-hook > "$fixture/stdout" 2> "$fixture/stderr"
grep -q 'selected mode messages' "$status_file"
rm "$fixture/fail"
"$launcher" --apt-hook > "$fixture/stdout" 2> "$fixture/stderr"
test ! -e "$status_file"
test ! -s "$fixture/stdout"
test ! -s "$fixture/stderr"

# Package removal skips application; disabling the hook removes old diagnostics.
touch "$fixture/removed" "$fixture/fail"
"$launcher" --apt-hook > "$fixture/stdout" 2> "$fixture/stderr"
test ! -e "$status_file"
touch "$status_file" "$fixture/apt/99-chatgpt-message-visibility"
sh "$fixture/install.sh" --remove-hook > "$fixture/stdout" 2> "$fixture/stderr"
test ! -e "$status_file"
test ! -e "$fixture/apt/99-chatgpt-message-visibility"
test -e "$launcher"
printf '%s\n' 'Launcher hook status tests passed.'
