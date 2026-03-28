# Examples

## Simple Action Workflow

Logs a message when someone cheers any amount of bits.

```json
{
  "id": "cheer-logger",
  "name": "Cheer Logger",
  "description": "Logs all cheer events",
  "trigger": {
    "type": "event",
    "eventType": "cheer.user.twitch"
  },
  "tasks": [
    {
      "id": "log-cheer",
      "type": "action",
      "parameters": {
        "action": "print",
        "message": "${trigger.data.userName} cheered ${trigger.data.amount} bits"
      }
    }
  ]
}
```

## Conditional Branching

Sends different messages based on cheer amount.

```json
{
  "id": "cheer-tiers",
  "name": "Cheer Tier Rewards",
  "trigger": {
    "type": "event",
    "eventType": "cheer.user.twitch",
    "conditions": [
      { "field": "${trigger.data.amount}", "operator": "gte", "value": 100 }
    ]
  },
  "tasks": [
    {
      "id": "check-tier",
      "type": "condition",
      "conditions": [
        { "field": "${trigger.data.amount}", "operator": "gte", "value": 500 }
      ],
      "onTrue": ["vip-reward"],
      "onFalse": ["standard-reward"]
    },
    {
      "id": "vip-reward",
      "type": "action",
      "dependsOn": ["check-tier"],
      "parameters": {
        "action": "function",
        "functionName": "sendChatMessage",
        "params": ["VIP CHEER! ${trigger.data.userName} dropped ${trigger.data.amount} bits!"]
      }
    },
    {
      "id": "standard-reward",
      "type": "action",
      "dependsOn": ["check-tier"],
      "parameters": {
        "action": "function",
        "functionName": "sendChatMessage",
        "params": ["Thanks for the ${trigger.data.amount} bits, ${trigger.data.userName}!"]
      }
    }
  ]
}
```

## Wait for Aggregation

Waits for a cumulative bit total within a time window, then triggers a special event.

```json
{
  "id": "bit-goal",
  "name": "Bit Goal Tracker",
  "trigger": {
    "type": "event",
    "eventType": "cheer.user.twitch"
  },
  "tasks": [
    {
      "id": "accumulate-bits",
      "type": "wait",
      "wait": {
        "type": "aggregation",
        "eventType": "cheer.user.twitch",
        "aggregation": {
          "strategy": "sum",
          "field": "data.amount",
          "threshold": 10000,
          "timeWindow": "1h"
        },
        "timeout": "2h",
        "onTimeout": "continue"
      }
    },
    {
      "id": "announce-goal",
      "type": "action",
      "dependsOn": ["accumulate-bits"],
      "parameters": {
        "action": "function",
        "functionName": "sendChatMessage",
        "params": ["BIT GOAL REACHED! 10,000 bits collected!"]
      }
    }
  ],
  "options": {
    "timeout": "3h"
  }
}
```

## Nested Sub-Workflow

A parent workflow triggers a sub-workflow and waits for it to complete.

```json
{
  "id": "new-subscriber-flow",
  "name": "New Subscriber Welcome",
  "trigger": {
    "type": "event",
    "eventType": "subscription.user.twitch"
  },
  "tasks": [
    {
      "id": "welcome-message",
      "type": "action",
      "parameters": {
        "action": "function",
        "functionName": "sendChatMessage",
        "params": ["Welcome ${trigger.data.userName}!"]
      }
    },
    {
      "id": "run-onboarding",
      "type": "workflow",
      "dependsOn": ["welcome-message"],
      "workflow": {
        "workflowId": "subscriber-onboarding",
        "waitUntilCompletion": true,
        "eventData": {
          "userId": "${trigger.data.userId}",
          "userName": "${trigger.data.userName}",
          "tier": "${trigger.data.tier}"
        },
        "timeout": "5m"
      }
    },
    {
      "id": "log-complete",
      "type": "log",
      "dependsOn": ["run-onboarding"],
      "parameters": {
        "message": "Onboarding complete for ${trigger.data.userName}"
      }
    }
  ]
}
```

## Publishing Events

Workflow that publishes a custom event to the message bus.

```json
{
  "id": "stream-online-notify",
  "name": "Stream Online Notification",
  "trigger": {
    "type": "event",
    "eventType": "online.channel.twitch"
  },
  "tasks": [
    {
      "id": "publish-notification",
      "type": "action",
      "parameters": {
        "action": "publish_event",
        "eventType": "stream.started.notification",
        "data": {
          "channel": "${trigger.data.broadcasterName}",
          "startedAt": "${trigger.time}"
        }
      },
      "exports": {
        "notificationId": "eventId"
      }
    },
    {
      "id": "log-published",
      "type": "log",
      "dependsOn": ["publish-notification"],
      "parameters": {
        "message": "Published notification ${publish-notification.notificationId}"
      }
    }
  ]
}
```

## Guard Conditions on Tasks

Using conditions as guards to conditionally skip tasks (not branching).

```json
{
  "id": "follow-reward",
  "name": "Follow Reward",
  "trigger": {
    "type": "event",
    "eventType": "follow.user.twitch"
  },
  "tasks": [
    {
      "id": "send-welcome",
      "type": "action",
      "parameters": {
        "action": "function",
        "functionName": "sendChatMessage",
        "params": ["Welcome ${trigger.data.userName}!"]
      }
    },
    {
      "id": "send-vip-welcome",
      "type": "action",
      "dependsOn": ["send-welcome"],
      "condition": {
        "field": "${trigger.data.isVIP}",
        "operator": "eq",
        "value": true
      },
      "parameters": {
        "action": "function",
        "functionName": "sendChatMessage",
        "params": ["Special VIP welcome to ${trigger.data.userName}!"]
      }
    }
  ]
}
```

The `send-vip-welcome` task is skipped entirely if `isVIP` is not `true`. The workflow continues to completion regardless.
