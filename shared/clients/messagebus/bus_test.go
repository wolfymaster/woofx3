package messagebus

import (
        "context"
        "log/slog"
        "sync"
        "testing"
        "time"
)

func TestMemoryBus_PublishSubscribe(t *testing.T) {
        bus, err := New(context.Background(), Config{
                Backend: BackendMemory,
                Logger:  slog.Default(),
        })
        if err != nil {
                t.Fatalf("failed to create bus: %v", err)
        }
        defer bus.Close()

        var mu sync.Mutex
        var messages []string

        // Subscribe to workflow events
        sub, err := bus.Subscribe("workflow.started", func(msg *Msg) {
                mu.Lock()
                messages = append(messages, string(msg.Data))
                mu.Unlock()
        })
        if err != nil {
                t.Fatalf("failed to subscribe: %v", err)
        }
        defer sub.Unsubscribe()

        // Publish a message
        data := []byte("test workflow started")
        if err := bus.Publish("workflow.started", data); err != nil {
                t.Fatalf("failed to publish: %v", err)
        }

        // Wait for message delivery
        time.Sleep(10 * time.Millisecond)

        mu.Lock()
        if len(messages) != 1 || messages[0] != string(data) {
                t.Errorf("expected 1 message with content %q, got %v", string(data), messages)
        }
        mu.Unlock()
}

func TestMemoryBus_WildcardMatching(t *testing.T) {
        bus := &memoryBus{}

        tests := []struct {
                pattern string
                subject string
                matches bool
        }{
                // Exact matches
                {"workflow.started", "workflow.started", true},
                {"workflow.started", "workflow.stopped", false},

                // Single wildcard "*"
                {"workflow.*", "workflow.started", true},
                {"workflow.*", "workflow.stopped", true},
                {"workflow.*", "workflow.started.now", false},
                {"*.started", "workflow.started", true},
                {"*.started", "task.started", true},
                {"*.started", "workflow.started.now", false},

                // Multi-level wildcard ">" - must match at least one token
                {"workflow.>", "workflow.started", true},
                {"workflow.>", "workflow.started.now", true},
                {"workflow.>", "workflow.started.now.here", true},
                {"workflow.>", "task.started", false},
                {"workflow.>", "workflow", false},  // ">" must match at least one token
                {"a.>", "a", false},               // ">" must match at least one token

                // Mixed patterns
                {"workflow.*.started", "workflow.task.started", true},
                {"workflow.*.started", "workflow.job.started", true},
                {"workflow.*.started", "workflow.task.stopped", false},

                // Edge cases
                {">", "anything", true},
                {">", "anything.deep.nested", true},
                {"*", "single", true},
                {"*", "two.tokens", false},
        }

        for _, tt := range tests {
                t.Run(tt.pattern+"_"+tt.subject, func(t *testing.T) {
                        result := bus.matchesSubject(tt.pattern, tt.subject)
                        if result != tt.matches {
                                t.Errorf("matchesSubject(%q, %q) = %v, want %v", tt.pattern, tt.subject, result, tt.matches)
                        }
                })
        }
}

func TestMemoryBus_MultipleSubscribers(t *testing.T) {
        bus, err := New(context.Background(), Config{
                Backend: BackendMemory,
                Logger:  slog.Default(),
        })
        if err != nil {
                t.Fatalf("failed to create bus: %v", err)
        }
        defer bus.Close()

        var mu sync.Mutex
        var count1, count2, count3 int

        // Multiple subscribers to different patterns
        sub1, _ := bus.Subscribe("workflow.>", func(msg *Msg) {
                mu.Lock()
                count1++
                mu.Unlock()
        })
        defer sub1.Unsubscribe()

        sub2, _ := bus.Subscribe("workflow.started", func(msg *Msg) {
                mu.Lock()
                count2++
                mu.Unlock()
        })
        defer sub2.Unsubscribe()

        sub3, _ := bus.Subscribe("task.*", func(msg *Msg) {
                mu.Lock()
                count3++
                mu.Unlock()
        })
        defer sub3.Unsubscribe()

        // Publish messages
        bus.Publish("workflow.started", []byte("started"))
        bus.Publish("workflow.stopped", []byte("stopped"))
        bus.Publish("task.created", []byte("created"))

        // Wait for message delivery
        time.Sleep(10 * time.Millisecond)

        mu.Lock()
        // sub1 should receive workflow.started and workflow.stopped (2 messages)
        if count1 != 2 {
                t.Errorf("expected count1=2, got %d", count1)
        }
        // sub2 should receive only workflow.started (1 message)
        if count2 != 1 {
                t.Errorf("expected count2=1, got %d", count2)
        }
        // sub3 should receive only task.created (1 message)
        if count3 != 1 {
                t.Errorf("expected count3=1, got %d", count3)
        }
        mu.Unlock()
}

func TestMemoryBus_Unsubscribe(t *testing.T) {
        bus, err := New(context.Background(), Config{
                Backend: BackendMemory,
                Logger:  slog.Default(),
        })
        if err != nil {
                t.Fatalf("failed to create bus: %v", err)
        }
        defer bus.Close()

        var mu sync.Mutex
        var count int

        sub, err := bus.Subscribe("test.>", func(msg *Msg) {
                mu.Lock()
                count++
                mu.Unlock()
        })
        if err != nil {
                t.Fatalf("failed to subscribe: %v", err)
        }

        // Publish before unsubscribe
        bus.Publish("test.message", []byte("data"))
        time.Sleep(10 * time.Millisecond)

        // Unsubscribe
        sub.Unsubscribe()

        // Publish after unsubscribe
        bus.Publish("test.message", []byte("data"))
        time.Sleep(10 * time.Millisecond)

        mu.Lock()
        // Should only receive the first message
        if count != 1 {
                t.Errorf("expected count=1, got %d", count)
        }
        mu.Unlock()
}