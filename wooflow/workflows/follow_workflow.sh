#!/bin/bash

# Configuration
API_URL="http://localhost:9000"  # Change this to match your API server address
WORKFLOW_DEF='{
  "id": "follow-workflow",
  "name": "Someone Follows the Stream",
  "description": "Followers",
  "version": 1,
  "active": true,
  "trigger": {
    "type": "event",
    "event": "follow"
  },
  "steps": [  
    {
      "id": "step1",
      "type": "action",
      "name": "someone subscribed",
      "action": "media_alert",
      "parameters": {
            "audioUrl": "https://streamlabs.local.woofx3.tv/pleasure.mp3",
            "mediaUrl": "https://media.tenor.com/LdHGHWDh0Y8AAAPo/look-at-you-i-see-you.mp4",
            "text": "<3  {primary}{userDisplayName}{primary} followed <3",
            "duration": 6
      }
    },
    {
      "id": "step2",
      "type": "action",
      "name": "add time to the timer",
      "action": "update_timer",
      "parameters": {
        "timerId": "49b3fa3b-5eeb-40c3-bdc2-4d0e97192391",
        "valueInSeconds": 60
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
