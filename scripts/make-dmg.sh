#!/bin/bash
# Creates a branded DMG installer from the built .app bundle.
# Approach: hdiutil creates a UDRW image, AppleScript configures the
# Finder window (background, icon positions, bounds), then converts to
# the final compressed UDZO. This is the same mechanism Tauri and
# create-dmg use — the only one modern Finder reliably renders.
#
# Usage: make-dmg.sh <app-bundle> <output-dmg> <background-png> <version>
set -euo pipefail

APP_BUNDLE="$1"
OUTPUT="$2"
BG_PNG="$3"
VERSION="$4"

[ -d "$APP_BUNDLE" ] || { echo "ERROR: app bundle not found: $APP_BUNDLE"; exit 1; }
[ -f "$BG_PNG" ] || { echo "ERROR: background not found: $BG_PNG"; exit 1; }

VOL_NAME="BrushLLM Video Studio ${VERSION}"
APP_NAME="$(basename "$APP_BUNDLE")"
TEMP_DMG="${OUTPUT%.dmg}-udrw.dmg"

# --- size: app + 8 MB slack ---
SIZE_KB=$(du -sk "$APP_BUNDLE" | cut -f1)
SIZE_KB=$((SIZE_KB + 8192))

# --- create read-write image ---
rm -f "$TEMP_DMG"
hdiutil create -size "${SIZE_KB}k" -volname "$VOL_NAME" -fs "HFS+" "$TEMP_DMG" -ov > /dev/null
echo "created UDRW: $TEMP_DMG"

# --- attach and populate ---
MOUNT=$(hdiutil attach -readwrite -noverify -noautoopen "$TEMP_DMG" | grep -o '/Volumes/.*' | tail -1)
[ -d "$MOUNT" ] || { echo "ERROR: mount failed"; rm -f "$TEMP_DMG"; exit 1; }
echo "mounted: $MOUNT"

cp -R "$APP_BUNDLE" "$MOUNT/"
ln -sf /Applications "$MOUNT/Applications"
mkdir -p "$MOUNT/.background"
cp "$BG_PNG" "$MOUNT/.background/dmg-background.png"

# Finder needs a moment to index the new volume
sleep 2

# --- configure the Finder window via AppleScript ---
BG_POSIX="$MOUNT/.background/dmg-background.png"

# 1. open the volume and set window properties
osascript -e "
tell application \"Finder\"
  open disk \"${VOL_NAME}\"
  tell window 1
    set current view to icon view
    set toolbar visible to false
    set statusbar visible to false
    set bounds to {240, 180, 900, 628}
    set icon size of icon view options to 96
    set arrangement of icon view options to not arranged
  end tell
end tell
" 2>&1 || echo "WARN: window setup failed"

sleep 2

# 2. set background picture
osascript -e "
tell application \"Finder\"
  set bgFile to (POSIX file \"${BG_POSIX}\") as alias
  set background picture of icon view options of window 1 to bgFile
end tell
" 2>&1 || echo "WARN: background setup failed"

sleep 1

# 3. position icons (matching WeChat reference proportions)
osascript -e "
tell application \"Finder\"
  set position of item \"${APP_NAME}\" of disk \"${VOL_NAME}\" to {180, 220}
  set position of item \"Applications\" of disk \"${VOL_NAME}\" to {480, 220}
end tell
" 2>&1 || echo "WARN: icon positioning failed"

sleep 2

# --- eject and compress ---
hdiutil eject "$MOUNT" > /dev/null
hdiutil convert "$TEMP_DMG" -format UDZO -o "$OUTPUT" -ov > /dev/null
rm -f "$TEMP_DMG"

echo "DMG created: $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"
