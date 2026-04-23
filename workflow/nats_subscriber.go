package main

import (
	natsclient "github.com/wolfymaster/woofx3/clients/nats"
	"github.com/wolfymaster/woofx3/workflow/internal/triggers"
)

// natsSubscriber adapts natsclient.Client to triggers.Subscriber. The adapter
// exists in workflow/ (not the triggers package) so triggers stays independent
// of natsclient and testable with a pure in-memory subscriber.
type natsSubscriber struct {
	client *natsclient.Client
}

func newNatsSubscriber(client *natsclient.Client) *natsSubscriber {
	return &natsSubscriber{client: client}
}

func (n *natsSubscriber) Subscribe(subject string, handler func(payload []byte, subject string)) (triggers.Subscription, error) {
	sub, err := n.client.Subscribe(subject, func(msg natsclient.Msg) {
		handler(msg.Data(), msg.Subject())
	})
	if err != nil {
		return nil, err
	}
	// natsclient.Subscription has Unsubscribe() error, which structurally
	// satisfies triggers.Subscription, so no handle-level adapter is needed.
	return sub, nil
}
