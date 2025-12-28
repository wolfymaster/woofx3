package runtime

import (
	"context"
	"sync"

	"github.com/wolfymaster/woofx3/clients/cloudevents"
	natsclient "github.com/wolfymaster/woofx3/clients/nats"
)

type HeartbeatFunc func(ctx context.Context) error
type HealthCheckFunc func(ctx context.Context, services ServicesRegistry) (bool, error)

type NATSClient interface {
	Publish(subject string, data []byte) error
	Subscribe(subject string, handler natsclient.Handler) (natsclient.Subscription, error)
}

func CreateNATSHeartbeat(bus NATSClient, appName, subject string, readyFn func() bool) HeartbeatFunc {
	if subject == "" {
		subject = "HEARTBEAT"
	}

	return func(ctx context.Context) error {
		ready := true
		if readyFn != nil {
			ready = readyFn()
		}

		event := cloudevents.NewHeartbeatEvent(appName, ready)
		data, err := cloudevents.Encode(event)
		if err != nil {
			return err
		}

		return bus.Publish(subject, data)
	}
}

func CreateNATSHealthCheck(bus NATSClient, subject string) HealthCheckFunc {
	if subject == "" {
		subject = "HEARTBEAT"
	}

	readyByApp := make(map[string]bool)
	var mu sync.RWMutex
	subscribed := false

	return func(ctx context.Context, services ServicesRegistry) (bool, error) {
		if !subscribed {
			_, err := bus.Subscribe(subject, func(msg natsclient.Msg) {
				var event cloudevents.BaseEvent[cloudevents.HeartbeatData]
				if err := msg.JSON(&event); err != nil {
					return
				}

				mu.Lock()
				readyByApp[event.Data.Application] = event.Data.Ready
				mu.Unlock()
			})

			if err != nil {
				return false, err
			}

			subscribed = true
		}

		mu.RLock()
		defer mu.RUnlock()

		for _, svc := range services {
			if svc.Healthcheck() {
				if !readyByApp[svc.Name()] {
					return false, nil
				}
			}
		}

		return true, nil
	}
}
