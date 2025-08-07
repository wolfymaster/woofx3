#!/bin/bash

# Configuration
API_URL="http://localhost:9000"  # Change this to match your API server address
WORKFLOW_DEF='{
  "id": "gifted-subscription-workflow",
  "name": "Someone Gifted Subs",
  "description": "Gifted Subscription",
  "version": 1,
  "active": true,
  "trigger": {
    "type": "event",
    "event": "gifited_subscription"
  },
  "steps": [
    {
      "id": "step1",
      "type": "action",
      "name": "someone gifted subscription",
      "action": "media_alert",
      "parameters": {
            "audioUrl": "https://streamlabs.local.woofx3.tv/allinthistogether.mp3",
            "mediaUrl": "https://media.tenor.com/MojW2yr1vFoAAAPo/money-money-money.mp4",
            "text": "$$ {primary}${gifterDisplayName}{primary} gifted {primary}${amount}{primary} ${suborsubs} $$"
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
