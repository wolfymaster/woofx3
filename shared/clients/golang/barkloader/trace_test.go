package barkloader

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

func TestInvokeContextCarriesTheCallersTrace(t *testing.T) {
	previousProvider, previousPropagator := otel.GetTracerProvider(), otel.GetTextMapPropagator()
	otel.SetTracerProvider(sdktrace.NewTracerProvider())
	otel.SetTextMapPropagator(propagation.TraceContext{})
	t.Cleanup(func() {
		otel.SetTracerProvider(previousProvider)
		otel.SetTextMapPropagator(previousPropagator)
	})

	requests := make(chan InvokeRequest, 2)
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }() // test server teardown; the close error carries no signal
		for {
			_, message, err := conn.ReadMessage()
			if err != nil {
				return
			}
			var req InvokeRequest
			if err := json.Unmarshal(message, &req); err != nil {
				return
			}
			requests <- req
			reply, _ := json.Marshal(InvokeResponse{Type: "result", Id: req.Id, Data: json.RawMessage(`{"result":{"ok":true}}`)})
			if err := conn.WriteMessage(websocket.TextMessage, reply); err != nil {
				return
			}
		}
	}))
	defer server.Close()

	client := New(Config{WSURL: "ws" + strings.TrimPrefix(server.URL, "http")})
	if err := client.Connect(); err != nil {
		t.Fatalf("Connect: %v", err)
	}
	defer client.Destroy()

	ctx, caller := otel.Tracer("test").Start(context.Background(), "step")
	defer caller.End()
	if _, err := client.InvokeContext(ctx, "f", map[string]interface{}{}, ""); err != nil {
		t.Fatalf("InvokeContext: %v", err)
	}
	sent := <-requests
	extracted := otel.GetTextMapPropagator().Extract(context.Background(), propagation.MapCarrier{"traceparent": sent.Data.Traceparent})
	if got := trace.SpanContextFromContext(extracted).TraceID(); got != caller.SpanContext().TraceID() {
		t.Fatalf("barkloader saw trace %s, want %s", got, caller.SpanContext().TraceID())
	}

	if _, err := client.InvokeContext(context.Background(), "f", map[string]interface{}{}, ""); err != nil {
		t.Fatalf("Invoke: %v", err)
	}
	if sent := <-requests; sent.Data.Traceparent != "" {
		t.Fatalf("a call with no trace context sent traceparent %q", sent.Data.Traceparent)
	}
}
