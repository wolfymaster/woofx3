package monitor

import (
	"testing"
	"time"
)

func TestHeartbeatRoundTrip(t *testing.T) {
	for _, ready := range []bool{true, false} {
		payload, err := encodeHeartbeat("db", ready, time.Date(2026, 11, 19, 10, 15, 30, 123000000, time.UTC))
		if err != nil {
			t.Fatalf("encodeHeartbeat(ready=%v): %v", ready, err)
		}
		data, err := decodeHeartbeat(payload)
		if err != nil {
			t.Fatalf("decodeHeartbeat(ready=%v): %v", ready, err)
		}
		if string(data.Application) != "db" || data.Ready != ready {
			t.Errorf("decoded %+v, want application db and ready %v", data, ready)
		}
	}
}

func TestEncodeHeartbeatRefusesAnEmptyApplication(t *testing.T) {
	if _, err := encodeHeartbeat("", true, time.Now()); err == nil {
		t.Fatal("encodeHeartbeat accepted an empty application name")
	}
}

func TestDecodeHeartbeatRefusesWhatIsNotAHeartbeat(t *testing.T) {
	cases := []struct {
		name    string
		payload string
	}{
		{"not json", `ping`},
		{"a bare ping", `{"ping":true}`},
		{"no data", `{"specversion":"1.0","id":"a","type":"com.woofx3.heartbeat","source":"db","subject":"HEARTBEAT","time":"2026-11-19T10:15:30Z"}`},
		{"no id", `{"specversion":"1.0","type":"com.woofx3.heartbeat","source":"db","subject":"HEARTBEAT","time":"2026-11-19T10:15:30Z","data":{"application":"db","ready":true}}`},
		{"a stringly ready", `{"specversion":"1.0","id":"a","type":"com.woofx3.heartbeat","source":"db","subject":"HEARTBEAT","time":"2026-11-19T10:15:30Z","data":{"application":"db","ready":"true"}}`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, err := decodeHeartbeat([]byte(c.payload)); err == nil {
				t.Fatalf("decodeHeartbeat accepted %s", c.payload)
			}
		})
	}
}
