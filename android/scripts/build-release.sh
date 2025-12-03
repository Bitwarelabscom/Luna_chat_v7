#!/bin/bash

# Luna Chat Android - Release Build Script
# Builds signed release APKs for distribution

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$PROJECT_DIR/release-builds"

cd "$PROJECT_DIR"

echo "================================================"
echo "Luna Chat - Release Build"
echo "================================================"
echo ""

# Check for required environment variables
if [ -z "$KEYSTORE_PATH" ] || [ -z "$KEYSTORE_PASSWORD" ] || [ -z "$KEY_ALIAS" ] || [ -z "$KEY_PASSWORD" ]; then
    echo "Error: Missing required environment variables for signing."
    echo ""
    echo "Required variables:"
    echo "  KEYSTORE_PATH      - Path to your .jks keystore file"
    echo "  KEYSTORE_PASSWORD  - Password for the keystore"
    echo "  KEY_ALIAS          - Key alias in the keystore"
    echo "  KEY_PASSWORD       - Password for the key"
    echo ""
    echo "Example:"
    echo "  export KEYSTORE_PATH=\"./keystore/luna-release.jks\""
    echo "  export KEYSTORE_PASSWORD=\"your-password\""
    echo "  export KEY_ALIAS=\"luna-chat\""
    echo "  export KEY_PASSWORD=\"your-password\""
    echo ""
    echo "Run ./scripts/generate-keystore.sh to create a keystore."
    exit 1
fi

# Verify keystore exists
if [ ! -f "$KEYSTORE_PATH" ]; then
    echo "Error: Keystore not found at: $KEYSTORE_PATH"
    exit 1
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Clean previous builds
echo "Cleaning previous builds..."
./gradlew clean

# Build production release APK
echo ""
echo "Building production release APK..."
./gradlew assembleProductionRelease

# Copy APK to output directory
APK_PATH="$PROJECT_DIR/app/build/outputs/apk/production/release/app-production-release.apk"
if [ -f "$APK_PATH" ]; then
    VERSION=$(grep 'versionName' app/build.gradle.kts | head -1 | sed 's/.*"\(.*\)".*/\1/')
    DATE=$(date +%Y%m%d)
    OUTPUT_NAME="luna-chat-v${VERSION}-${DATE}.apk"

    cp "$APK_PATH" "$OUTPUT_DIR/$OUTPUT_NAME"

    echo ""
    echo "================================================"
    echo "Build completed successfully!"
    echo "================================================"
    echo ""
    echo "APK location: $OUTPUT_DIR/$OUTPUT_NAME"
    echo "Size: $(du -h "$OUTPUT_DIR/$OUTPUT_NAME" | cut -f1)"
    echo ""

    # Generate SHA256 checksum
    sha256sum "$OUTPUT_DIR/$OUTPUT_NAME" > "$OUTPUT_DIR/$OUTPUT_NAME.sha256"
    echo "Checksum: $OUTPUT_DIR/$OUTPUT_NAME.sha256"
else
    echo "Error: APK not found at expected location"
    echo "Expected: $APK_PATH"
    exit 1
fi
