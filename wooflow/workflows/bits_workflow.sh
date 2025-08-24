#!/bin/bash

# Configuration
API_URL="http://localhost:9000"  # Change this to match your API server address
WORKFLOW_DEF='{
  "id": "bits-workflow",
  "name": "Someone Cheers Bits",
  "description": "Bits",
  "version": 1,
  "active": true,
  "trigger": {
    "type": "event",
    "event": "bits",
    "condition": {
      "amount": {
        "gte": 1
      }
    }
  },
  "steps": [
    {
      "id": "step1",
      "type": "action",
      "name": "Trigger confetti",
      "action": "media_alert",
      "parameters": {
          "mediaUrl": ["https://streamlabs.local.woofx3.tv/bit_overlay.json", "https://streamlabs.local.woofx3.tv/confetti2.gif"],
          "audioUrl": "https://streamlabs.local.woofx3.tv/goinsane-pinkpony.mp3",
          "duration": 10,
          "options": [{ "view": { "fullScreen": true, "positionAbsolute": true }, "animation": { "path": ["assets", 0, "layers", 0, "t", "d", "k", 0, "s", "t"], "value": "{amount} BITS" } }, { "view": { "fullScreen": true, "positionAbsolute": true } }]
      }
    }
  ]
}'

# Add workflow definition
echo "Adding workflow definition..."
curl -X POST \
  -H "Content-Type: application/json" \
  -d "$WORKFLOW_DEF" \
  "$API_URL/v1/workflow-definitions"

echo -e "\nDone!" 
