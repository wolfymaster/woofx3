package nats

import (
	"context"
	"fmt"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

const (
	messagingSystem = "nats"
	// errorTypePanic is the error.type of a handler that panicked.
	errorTypePanic = "panic"
)

// SetMetrics reports how long this client's subscription handlers take, as
// messaging.process.duration. Call it before subscribing; until then handlers
// are not timed. buckets are the histogram's boundaries in seconds.
func (c *Client) SetMetrics(meter metric.Meter, buckets []float64) error {
	histogram, err := meter.Float64Histogram("messaging.process.duration",
		metric.WithDescription("Time a subscription handler took to process one message."),
		metric.WithUnit("s"),
		metric.WithExplicitBucketBoundaries(buckets...))
	if err != nil {
		return fmt.Errorf("creating messaging.process.duration: %w", err)
	}
	c.processDuration = histogram
	return nil
}

// observed runs process and records how long it took, under the subscription
// pattern and never the concrete subject: a pattern like `twitch.>` is one
// series where the subjects it matches are unbounded. NATS handlers return no
// error, so error.type is only set for a handler that panics, which is
// recorded and left to panic on.
func (c *Client) observed(pattern string, process func()) {
	if c.processDuration == nil {
		process()
		return
	}
	start := c.now()
	panicked := true
	defer func() {
		attributes := []attribute.KeyValue{
			attribute.String("messaging.system", messagingSystem),
			attribute.String("messaging.destination.name", pattern),
		}
		if panicked {
			attributes = append(attributes, attribute.String("error.type", errorTypePanic))
		}
		c.processDuration.Record(context.Background(), c.now().Sub(start).Seconds(), metric.WithAttributes(attributes...))
	}()
	process()
	panicked = false
}
