package runtime

import (
	"log"
	"time"
)

type Backoff struct {
	current time.Duration
	min     time.Duration
	max     time.Duration
	factor  float64
	logger  *log.Logger
}

var NewBackoff = func() *Backoff {
	return &Backoff{
		current: 1 * time.Second,
		min:     1 * time.Second,
		max:     60 * time.Second,
		factor:  2.0,
		logger:  log.Default(),
	}
}

func (b *Backoff) Next() time.Duration {
	next := time.Duration(float64(b.current) * b.factor)
	if next > b.max {
		b.current = b.min
		if b.logger != nil {
			b.logger.Printf("[Backoff] Reset to min delay: %v\n", b.current)
		}
		return b.min
	}
	b.current = next
	if b.logger != nil {
		b.logger.Printf("[Backoff] Next delay: %v\n", b.current)
	}
	return b.current
}

func (b *Backoff) Reset() {
	b.current = b.min
	if b.logger != nil {
		b.logger.Printf("[Backoff] Reset to min delay: %v\n", b.current)
	}
}

func (b *Backoff) Current() time.Duration {
	return b.current
}
