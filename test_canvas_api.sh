#!/bin/bash
# Canvas API Test Script

BASE_URL="http://localhost:3001"
TOKEN="your_jwt_token_here"  # Replace with actual token

echo "=== Testing Canvas API ==="
echo

# Test 1: Get quick actions (should return empty array initially)
echo "1. Getting quick actions..."
curl -s -X GET "${BASE_URL}/api/canvas/quick-actions" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" | jq '.'
echo

# Test 2: Create a quick action
echo "2. Creating a quick action..."
curl -s -X POST "${BASE_URL}/api/canvas/quick-actions" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Add Comments",
    "prompt": "Add detailed comments to explain the code",
    "includeReflections": false,
    "includePrefix": true,
    "includeRecentHistory": false
  }' | jq '.'
echo

# Test 3: Get reflections (should return empty array initially)
echo "3. Getting reflections..."
curl -s -X GET "${BASE_URL}/api/canvas/reflections" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" | jq '.'
echo

# Test 4: Add a reflection
echo "4. Adding a style rule reflection..."
curl -s -X POST "${BASE_URL}/api/canvas/reflections" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "style_rule",
    "value": "Always use TypeScript strict mode"
  }' | jq '.'
echo

echo "=== Canvas API Tests Complete ==="
