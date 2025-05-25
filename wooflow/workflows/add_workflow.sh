#!/bin/bash

# Configuration
API_URL="http://localhost:9000"  # Change this to match your API server address
WORKFLOW_DEF='{
  "id": "bits-subs-celebration",
  "name": "Bits and Subs Celebration",
  "description": "Celebrates bits donations followed by sub events",
  "version": 1,
  "active": true,
  "trigger": {
    "type": "event",
    "event": "bits",
    "condition": {
      "amount": {
        "gte": 100
      }
    }
  },
  "steps": [
    {
      "id": "step1",
      "type": "action",
      "name": "Initial Bits Celebration",
      "action": "play_sound",
      "parameters": { 
        "sound": "celebration.mp3",
        "volume": 0.8
      },
      "exports": {
        "initialBitsAmount": "amount"
      }
    },
    {
      "id": "step2",
      "type": "wait",
      "name": "Wait for More Bits",
      "dependsOn": ["step1"],
      "waitFor": {
        "type": "aggregation",
        "aggregation": {
          "type": "sum",
          "eventType": "bits",
          "field": "amount",
          "threshold": 500,
          "timeWindow": "5m"
        }
      },
      "exports": {
        "totalBitsAmount": "aggregationResult.value"
      }
    },
    {
      "id": "step3",
      "type": "action",
      "name": "Display Bits Total",
      "dependsOn": ["step2"],
      "action": "display_message",
      "parameters": { 
        "message": "${variables.totalBitsAmount} bits donated in 5 minutes! Thank you!",
        "duration": 10,
        "style": "celebration"
      }
    },
    {
      "id": "step4",
      "type": "wait",
      "name": "Wait for Subs",
      "dependsOn": ["step3"],
      "waitFor": {
        "type": "event",
        "eventType": "subscription",
        "condition": {
          "tier": {
            "gte": 1
          }
        }
      },
      "exports": {
        "subTier": "tier",
        "subUser": "username"
      }
    },
    {
      "id": "step5",
      "type": "action",
      "name": "Final Celebration",
      "dependsOn": ["step4"],
      "action": "run_effect",
      "parameters": { 
        "effect": "fireworks",
        "message": "Amazing! ${variables.subUser} subscribed at tier ${variables.subTier} after ${variables.totalBitsAmount} bits!"
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