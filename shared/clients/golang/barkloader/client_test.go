package barkloader

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// newEchoServer starts a websocket server that answers every "invoke"
// request with a "result" response echoing the same id, processed
// sequentially in a single reader/writer loop. It exists to exercise the
// client side under concurrent Invoke() calls, not to model barkloader's
// own concurrency.
func newEchoServer(t *testing.T) (wsURL string, close func()) {
	t.Helper()
	upgrader := websocket.Upgrader{}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()

		for {
			_, message, err := conn.ReadMessage()
			if err != nil {
				return
			}

			var req InvokeRequest
			if err := json.Unmarshal(message, &req); err != nil {
				continue
			}

			data, err := json.Marshal(map[string]interface{}{
				"result": map[string]interface{}{"function": req.Data.Function},
			})
			if err != nil {
				continue
			}
			resp := InvokeResponse{
				Type: "result",
				Id:   req.Id,
				Data: data,
			}
			respJSON, err := json.Marshal(resp)
			if err != nil {
				continue
			}
			if err := conn.WriteMessage(websocket.TextMessage, respJSON); err != nil {
				return
			}
		}
	}))

	wsURL = "ws" + strings.TrimPrefix(server.URL, "http")
	return wsURL, server.Close
}

// TestInvokeConcurrentCallsDoNotRaceOnWrite is a regression test for a
// production crash: "panic: concurrent write to websocket connection".
// gorilla/websocket requires the caller to ensure at most one goroutine
// calls the write methods at a time; Invoke() multiplexes concurrent calls
// over one connection via per-call ids, so without serializing the actual
// wire write in Send(), two concurrent Invoke() calls (e.g. two workflow
// tasks invoking barkloader functions around the same time) raced on
// conn.WriteMessage() and panicked, crashing the whole workflow process.
// Run with `go test -race` to catch a regression of the underlying data
// race even if the panic itself doesn't reproduce on a given run.
func TestInvokeConcurrentCallsDoNotRaceOnWrite(t *testing.T) {
	wsURL, closeServer := newEchoServer(t)
	defer closeServer()

	client := New(Config{WSURL: wsURL})
	if err := client.Connect(); err != nil {
		t.Fatalf("Connect() error = %v", err)
	}
	defer client.Destroy()

	const concurrentInvokes = 25
	var wg sync.WaitGroup
	errs := make([]error, concurrentInvokes)

	for i := 0; i < concurrentInvokes; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := client.Invoke("test:function:echo", map[string]interface{}{"i": i}, "")
			errs[i] = err
		}(i)
	}

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("concurrent Invoke() calls did not complete in time")
	}

	for i, err := range errs {
		if err != nil {
			t.Errorf("Invoke() call %d error = %v", i, err)
		}
	}
}

// TestInvokeDoesNotDeadlockAgainstConnectCycles is a regression test for a
// recursive RLock: Invoke held c.mu.RLock and called IsConnected, which took
// it again. A Connect or Disconnect waiting on the write lock between the two
// reads blocked the inner one forever, wedging the writer too. Run with
// `go test -race`.
//
// An Invoke whose connection is torn down mid-flight waits out its full
// timeout, so the invokers are not awaited: the test passes when the
// Disconnect/Connect cycler completes, which it cannot do while a reader is
// wedged.
func TestInvokeDoesNotDeadlockAgainstConnectCycles(t *testing.T) {
	wsURL, closeServer := newEchoServer(t)
	defer closeServer()

	client := New(Config{WSURL: wsURL})
	if err := client.Connect(); err != nil {
		t.Fatalf("Connect() error = %v", err)
	}
	defer client.Destroy()

	const invokers = 8
	const cycles = 300
	stop := make(chan struct{})
	defer close(stop)

	for i := 0; i < invokers; i++ {
		go func() {
			for {
				select {
				case <-stop:
					return
				default:
				}
				_, _ = client.Invoke("test:function:echo", map[string]interface{}{}, "")
			}
		}()
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < cycles; i++ {
			client.Disconnect()
			_ = client.Connect()
		}
	}()

	select {
	case <-done:
	case <-time.After(20 * time.Second):
		t.Fatal("Disconnect/Connect cycles wedged behind Invoke")
	}
}

func TestInvokeWhenDisconnectedReturnsErrNotConnected(t *testing.T) {
	client := New(Config{WSURL: "ws://127.0.0.1:1"})
	_, err := client.Invoke("test:function:echo", map[string]interface{}{}, "")
	if !errors.Is(err, ErrNotConnected) {
		t.Fatalf("Invoke() error = %v, want ErrNotConnected", err)
	}
}
