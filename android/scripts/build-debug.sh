#!/bin/bash

# Luna Chat Android - Debug Build Script
# Builds debug APK for testing

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "================================================"
echo "Luna Chat - Debug Build"
echo "================================================"
echo ""

# Build development debug APK
echo "Building development debug APK..."
./gradlew assembleDevelopmentDebug

APK_PATH="$PROJECT_DIR/app/build/outputs/apk/development/debug/app-development-debug.apk"
if [ -f "$APK_PATH" ]; then
    echo ""
    echo "================================================"
    echo "Build completed successfully!"
    echo "================================================"
    echo ""
    echo "APK location: $APK_PATH"
    echo "Size: $(du -h "$APK_PATH" | cut -f1)"
    echo ""
    echo "Install on connected device:"
    echo "  adb install -r \"$APK_PATH\""
else
    echo "Error: APK not found"
    exit 1
fi
