package main

import "sync"

// recentDeliveryCapacity is how many events recentDeliveries remembers. Copies
// of one event arrive together, one per overlapping subscription, so the
// window only needs to outlast how far one subscription's handler can fall
// behind another's.
const recentDeliveryCapacity = 8192

// recentDeliveries recognises a second copy of an event that the bus
// delivered more than once.
//
// The event registrar holds one bus subscription per distinct pattern, and
// the bus hands a message to every subscription it matches: an event on
// `message.user.twitch` arrives twice when one workflow listens on that
// subject and another on `message.user.*`. The engine matches each copy
// against every workflow, so without this each copy would dispatch both
// workflows again.
//
// The key is the CloudEvents (source, id), which a publisher must keep unique
// per event: a new event reusing a remembered pair is taken for a copy and
// dropped. The memory is a window of the last recentDeliveryCapacity events,
// so a copy from a subscription lagging another by more than that window is
// not recognised and runs its workflows a second time.
//
// Safe for concurrent use: the bus runs each subscription's handler on its
// own goroutine, so the copies race and exactly one of them must win.
type recentDeliveries struct {
	mu   sync.Mutex
	seen map[string]struct{}
	// ring holds the remembered keys oldest first from next, so that the
	// oldest is forgotten when a new one arrives at capacity.
	ring []string
	next int
}

func newRecentDeliveries(capacity int) *recentDeliveries {
	if capacity <= 0 {
		panic("recentDeliveries needs a positive capacity")
	}
	return &recentDeliveries{
		seen: make(map[string]struct{}, capacity),
		ring: make([]string, capacity),
	}
}

// first reports whether this is the first delivery of the event, and
// remembers it.
func (r *recentDeliveries) first(source, id string) bool {
	key := source + "\x00" + id
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, dup := r.seen[key]; dup {
		return false
	}
	if evicted := r.ring[r.next]; evicted != "" {
		delete(r.seen, evicted)
	}
	r.ring[r.next] = key
	r.next = (r.next + 1) % len(r.ring)
	r.seen[key] = struct{}{}
	return true
}
