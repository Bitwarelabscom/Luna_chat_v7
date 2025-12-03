#!/bin/bash

# Luna Chat Android - Keystore Generation Script
# This script generates a release keystore for signing APKs

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
KEYSTORE_DIR="$PROJECT_DIR/keystore"
KEYSTORE_FILE="$KEYSTORE_DIR/luna-release.jks"

# Create keystore directory if it doesn't exist
mkdir -p "$KEYSTORE_DIR"

# Check if keystore already exists
if [ -f "$KEYSTORE_FILE" ]; then
    echo "Keystore already exists at: $KEYSTORE_FILE"
    echo "Delete it first if you want to regenerate."
    exit 1
fi

echo "================================================"
echo "Luna Chat - Release Keystore Generator"
echo "================================================"
echo ""
echo "This will create a keystore for signing release APKs."
echo "Keep your keystore and passwords safe - you cannot recover them!"
echo ""

# Prompt for keystore details
read -p "Keystore password (min 6 chars): " -s STORE_PASS
echo ""
read -p "Confirm keystore password: " -s STORE_PASS_CONFIRM
echo ""

if [ "$STORE_PASS" != "$STORE_PASS_CONFIRM" ]; then
    echo "Error: Passwords do not match"
    exit 1
fi

if [ ${#STORE_PASS} -lt 6 ]; then
    echo "Error: Password must be at least 6 characters"
    exit 1
fi

read -p "Key alias [luna-chat]: " KEY_ALIAS
KEY_ALIAS="${KEY_ALIAS:-luna-chat}"

read -p "Key password (press Enter to use keystore password): " -s KEY_PASS
echo ""
KEY_PASS="${KEY_PASS:-$STORE_PASS}"

echo ""
echo "Certificate details (press Enter for defaults):"
read -p "Your name [Luna Chat]: " CN
CN="${CN:-Luna Chat}"

read -p "Organization unit [Development]: " OU
OU="${OU:-Development}"

read -p "Organization [Bitware Labs]: " O
O="${O:-Bitware Labs}"

read -p "City []: " L

read -p "State/Province []: " ST

read -p "Country code (2 letters) [US]: " C
C="${C:-US}"

# Build the dname string
DNAME="CN=$CN, OU=$OU, O=$O"
[ -n "$L" ] && DNAME="$DNAME, L=$L"
[ -n "$ST" ] && DNAME="$DNAME, ST=$ST"
DNAME="$DNAME, C=$C"

echo ""
echo "Generating keystore..."

keytool -genkeypair \
    -v \
    -keystore "$KEYSTORE_FILE" \
    -alias "$KEY_ALIAS" \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -storepass "$STORE_PASS" \
    -keypass "$KEY_PASS" \
    -dname "$DNAME"

echo ""
echo "================================================"
echo "Keystore generated successfully!"
echo "================================================"
echo ""
echo "Keystore file: $KEYSTORE_FILE"
echo "Key alias: $KEY_ALIAS"
echo ""
echo "To build a signed release APK, set these environment variables:"
echo ""
echo "  export KEYSTORE_PATH=\"$KEYSTORE_FILE\""
echo "  export KEYSTORE_PASSWORD=\"<your-keystore-password>\""
echo "  export KEY_ALIAS=\"$KEY_ALIAS\""
echo "  export KEY_PASSWORD=\"<your-key-password>\""
echo ""
echo "Then run: ./gradlew assembleProductionRelease"
echo ""
echo "IMPORTANT: Add /keystore/ to your .gitignore!"
echo ""

# Create .gitignore for keystore directory
cat > "$KEYSTORE_DIR/.gitignore" << 'EOF'
# Ignore all keystore files
*.jks
*.keystore
*.p12
EOF

echo "Created $KEYSTORE_DIR/.gitignore"
