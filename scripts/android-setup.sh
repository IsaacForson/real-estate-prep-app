#!/usr/bin/env bash
# One-shot Android toolchain + release bundle for Play Console internal testing.
#   1) scripts/android-setup.sh licenses   # interactive: accept Google's SDK licenses (a human must do this)
#   2) scripts/android-setup.sh sdk        # installs platform-tools, platform 35, build-tools 35
#   3) scripts/android-setup.sh bundle     # nuxt generate → cap sync → gradlew bundleRelease (signed with android/keystore/upload.jks)
set -euo pipefail
cd "$(dirname "$0")/.."
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
# Capacitor 8's Android library compiles with Java 21.
export JAVA_HOME="${JAVA_HOME:-$( [ -d /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ] && echo /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home || /usr/libexec/java_home -v 21 2>/dev/null || true)}"
export PATH="$JAVA_HOME/bin:$PATH"
mkdir -p "$ANDROID_HOME"
case "${1:-}" in
  licenses) sdkmanager --sdk_root="$ANDROID_HOME" --licenses ;;
  sdk) sdkmanager --sdk_root="$ANDROID_HOME" "platform-tools" "platforms;android-36" "build-tools;36.0.0" ;;
  bundle)
    set -a; source .env; set +a
    pnpm --filter @rep/app content:manifest
    CAPACITOR_BUILD=1 pnpm --filter @rep/app generate
    pnpm --filter @rep/app exec cap sync android
    cd apps/app/android
    echo "sdk.dir=$ANDROID_HOME" > local.properties
    ./gradlew bundleRelease \
      -Pandroid.injected.signing.store.file="$PWD/keystore/upload.jks" \
      -Pandroid.injected.signing.store.password="$ANDROID_KEYSTORE_PASSWORD" \
      -Pandroid.injected.signing.key.alias=upload \
      -Pandroid.injected.signing.key.password="$ANDROID_KEYSTORE_PASSWORD"
    echo "AAB: apps/app/android/app/build/outputs/bundle/release/app-release.aab" ;;
  *) echo "usage: $0 licenses|sdk|bundle"; exit 1 ;;
esac
