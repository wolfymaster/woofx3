package runtime

import "time"

type Backoff struct {
	current time.Duration
	min     time.Duration
	max     time.Duration
	factor  float64
}

func NewBackoff() *Backoff {
	return &Backoff{
		current: 1 * time.Second,
		min:     1 * time.Second,
		max:     60 * time.Second,
		factor:  2.0,
	}
}

func (b *Backoff) Next() time.Duration {
	next := time.Duration(float64(b.current) * b.factor)
	if next > b.max {
		b.current = b.min
		return b.min
	}
	b.current = next
	return b.current
}

func (b *Backoff) Reset() {
	b.current = b.min
}

func (b *Backoff) Current() time.Duration {
	return b.current
}
