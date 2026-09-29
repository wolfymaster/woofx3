package nats

import (
	"bufio"
	"fmt"
	"io"
	"log/slog"
	"net"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// echoServer speaks just enough of the NATS protocol for request/reply: every
// published message is delivered straight back to its reply subject. It counts
// the connections it accepts, which is what these tests are about.
type echoServer struct {
	listener net.Listener
	accepted atomic.Int32
	mu       sync.Mutex
	conns    []net.Conn
}

func startEchoServer(t *testing.T) *echoServer {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	s := &echoServer{listener: listener}
	go s.accept()
	t.Cleanup(func() {
		_ = listener.Close()
		s.dropAll()
	})
	return s
}

func (s *echoServer) url() string {
	return "nats://" + s.listener.Addr().String()
}

func (s *echoServer) accept() {
	for {
		conn, err := s.listener.Accept()
		if err != nil {
			return
		}
		s.accepted.Add(1)
		s.mu.Lock()
		s.conns = append(s.conns, conn)
		s.mu.Unlock()
		go s.serve(conn)
	}
}

// dropAll closes every client connection, as a server restart would.
func (s *echoServer) dropAll() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, conn := range s.conns {
		_ = conn.Close()
	}
	s.conns = nil
}

func (s *echoServer) serve(conn net.Conn) {
	defer conn.Close()
	var writeMu sync.Mutex
	write := func(text string) {
		writeMu.Lock()
		defer writeMu.Unlock()
		_, _ = io.WriteString(conn, text)
	}
	write(`INFO {"server_id":"echo","version":"2.10.0","proto":1,"headers":false,"max_payload":1048576}` + "\r\n")

	reader := bufio.NewReader(conn)
	// subject pattern -> sid; inbox subscriptions end in `.*`.
	subs := map[string]string{}
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return
		}
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) == 0 {
			continue
		}
		switch strings.ToUpper(fields[0]) {
		case "PING":
			write("PONG\r\n")
		case "SUB":
			subs[fields[1]] = fields[len(fields)-1]
		case "PUB":
			size, _ := strconv.Atoi(fields[len(fields)-1])
			payload := make([]byte, size+2)
			if _, err := io.ReadFull(reader, payload); err != nil {
				return
			}
			if len(fields) != 4 {
				continue
			}
			reply := fields[2]
			sid, ok := subs[reply]
			if !ok {
				prefix := reply[:strings.LastIndex(reply, ".")+1]
				sid, ok = subs[prefix+"*"]
			}
			if ok {
				write(fmt.Sprintf("MSG %s %s %d\r\n%s", reply, sid, size, payload))
			}
		}
	}
}

func newTestClient(url string) *Client {
	return NewClient(Config{URL: url, Name: "test"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func requestConcurrently(t *testing.T, client *Client, callers int) {
	t.Helper()
	var wg sync.WaitGroup
	errs := make(chan error, callers)
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			want := fmt.Sprintf("hello %d", i)
			reply, err := client.Request("echo", []byte(want), 5*time.Second)
			if err != nil {
				errs <- err
				return
			}
			if string(reply) != want {
				errs <- fmt.Errorf("reply %q, want %q", reply, want)
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
}

// Callers racing to make the first request share one connection. Run with
// -race: the connection field is read and written under the client's lock.
func TestConcurrentRequestsShareOneConnection(t *testing.T) {
	server := startEchoServer(t)
	client := newTestClient(server.url())
	t.Cleanup(func() { _ = client.Close() })

	requestConcurrently(t, client, 20)

	if got := server.accepted.Load(); got != 1 {
		t.Errorf("server accepted %d connections, want 1", got)
	}
}

// A request made while the connection is reconnecting waits for that
// reconnect rather than dialling a second connection beside it.
func TestRequestsDuringReconnectDoNotDialAgain(t *testing.T) {
	server := startEchoServer(t)
	client := newTestClient(server.url())
	t.Cleanup(func() { _ = client.Close() })

	requestConcurrently(t, client, 1)
	server.dropAll()
	deadline := time.Now().Add(2 * time.Second)
	for client.AsNATS().IsConnected() {
		if time.Now().After(deadline) {
			t.Fatal("client never noticed the dropped connection")
		}
		time.Sleep(5 * time.Millisecond)
	}

	requestConcurrently(t, client, 10)

	// The first connection, and the one reconnect nats.go makes itself.
	if got := server.accepted.Load(); got != 2 {
		t.Errorf("server accepted %d connections, want 2", got)
	}
}
