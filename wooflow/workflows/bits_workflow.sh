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
    "event": "bits"
  },
  "steps": [
    {
      "id": "step_trigger_100_bit_workflow",
      "type": "workflow_trigger",
      "name": "Trigger 100 bits",
      "workflow": "workflow_1",
      "condition": {
        "trigger.amount": {
            "eq": 100
        }
      }      
    },
    {
      "id": "step_trigger_500_bit_workflow",
      "type": "workflow_trigger",
      "name": "Trigger 500 bits",
      "workflow": "workflow_2",
      "condition": {
        "trigger.amount": {
            "eq": 500
        }
      },   
    },

    {
        "id": "workflow_1",
        "type": "workflow",
        "name": "100 bits workflow",
        "steps": [
            {
                "id": "step_100_bits",
                "type": "action",
                "name": "100 bits",
                "action": "media_alert",
                "parameters": {
                    "audioUrl": "https://streamlabs.local.woofx3.tv/pleasure.mp3"
                }      
            }
        ]
    },

    {
        "id": "workflow_2",
        "type": "workflow",
        "name": "500 bits workflow",
        "steps": [
            {
                "id": "step_500_bits",
                "type": "action",
                "name": "500 bits",
                "action": "media_alert",
                "parameters": {
                    "audioUrl": "https://streamlabs.local.woofx3.tv/pleasure.mp3"
                }  
            }
        ]
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
