#!/bin/bash

# Configuration
API_URL="http://localhost:9000"  # Change this to match your API server address
WORKFLOW_DEF='{
  "id": "user-generated-workflow-1",
  "name": "Wolfys Example Workflow",
  "description": "Example Workflow",
  "version": 1,
  "active": true,
  "trigger": {
    "type": "event",
    "event": "bits",
    "condition": {
      "amount": {
        "gte": 500
      }
    }
  },
  "steps": [  
    {
      "id": "step1",
      "type": "action",
      "name": "someone subscribed",
      "action": "media_alert",
      "parameters": {
        "mediaUrl": "https://media.tenor.com/bj2uMQRTdSEAAAPo/dog-husky.mp4",
        "text": "<3 {primary}${userDisplayName}{primary} subscribed <3"
      }
    },
    {
      "id": "step2",
      "type": "wait",
      "name": "wait for 100 bits",
      "waitFor": {
        "type": "aggregation",
        "aggregation": {
          "type": "sum",
          "eventType": "bits",
          "field": "amount",
          "threshold": 100,
          "timeWindow": "1m"
        }
      }
    },
    {
      "id": "step3",
      "type": "action",
      "name": "We did it",
      "action": "media_alert",
      "parameters": { 
        "audioUrl": "https://streamlabs.local.woofx3.tv/wedidit.mp3",
			  "mediaUrl": "https://streamlabs.local.woofx3.tv/confetti.gif",
			  "duration": 10,
			  "options": {
          "view": {
					  "fullScreen": true
				  }
			  }
      },
      "exports": {
        "audioUrl": "audioUrl"
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
