#!/bin/bash

# Configuration
API_URL="http://localhost:9000"  # Change this to match your API server address
WORKFLOW_DEF='{
  "id": "subscription-workflow",
  "name": "Someone Subs",
  "description": "Subscription",
  "version": 1,
  "active": true,
  "trigger": {
    "type": "event",
    "event": "subscription"
  },
  "steps": [
    {
      "id": "step1",
      "type": "action",
      "name": "someone subscribed",
      "action": "media_alert",
      "parameters": {
            "audioUrl": "https://streamlabs.local.woofx3.tv/wolf-hype.mp3",
            "mediaUrl": "https://media.tenor.com/bj2uMQRTdSEAAAPo/dog-husky.mp4",
            "text": "<3  {primary}${userDisplayName}{primary} subscribed <3"
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
