package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"github.com/wolfymaster/wolfyttv-stream/src/gladia"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nkeys"
)

type Args struct {
	url string
}

var client *nats.Conn

func main() {
	// load envvars
	godotenv.Load("../.env")

	gladia_api_key := os.Getenv("GLADIA_API_KEY")
	userJWT := os.Getenv("NATS_USER_JWT")
	nkeySeed := os.Getenv("NATS_NKEY_SEED")

	// parse arg input
	args := parseArgs()
	log.Printf("Processing stream from: %s\n", args.url)

	// handle video callback
	videoHandler := func(data []byte) {
		file, err := os.OpenFile("video.h264", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			log.Printf("Error opening video file: %v", err)
			return
		}
		defer file.Close()
		file.Write(data)
	}

	// Create a new gladia client
	config := gladia.Config{
		APIKey:     gladia_api_key,
		SampleRate: 16000,
		BitDepth:   16,
		Channels:   1,
		Encoding:   "wav/pcm",
	}
	gladiaClient := gladia.NewClient(config)

	// Initiate gladia session
	session, err := gladiaClient.InitiateSession()
	if err != nil {
		log.Fatalf("Error initiating gladia session: %v", err)
	}

	// Create message channel
	msgChan := make(chan gladia.WebSocketMessage)

	// Connect websocket
	ws, err := gladiaClient.ConnectWebSocket(session.URL, msgChan)
	if err != nil {
		log.Fatalf("Error connecting websocket: %v", err)
	}
	defer ws.Close()

	// Handle errors in a goroutine
	go func() {
		for err := range ws.Errors() {
			log.Printf("Websocket error: %v", err)
		}
	}()

	// handle audio callback
	audioHandler := func(data []byte) {
		file, err := os.OpenFile("audio.aac", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			log.Printf("Error opening audio file: %v", err)
			return
		}
		defer file.Close()
		file.Write(data)

		if err := ws.SendAudio(data); err != nil {
			log.Printf("Error sending audio: %v", err)
		}
	}

	nats_client, err := setupNATS(userJWT, nkeySeed)
	if err != nil {
		log.Fatalf("Failed to connect to nats: %v", err)
	}

	// Handle messages in a goroutine
	go handleMessages(msgChan, nats_client)

	// setup new stream processor
	processor := NewStreamProcessor(args.url, videoHandler, audioHandler)

	// Setup graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	if err := processor.Start(); err != nil {
		log.Fatalf("Failed to start processor: %v", err)
	}

	log.Println("Press Ctrl+C to stop")

	// wait for signal
	<-sigChan

	// shutdown
	log.Println("Shutting down...")
	processor.Stop()
}

// Parse CLI arguments
func parseArgs() Args {
	url := flag.String("url", "", "Stream URL (required)")
	flag.Parse()

	if *url == "" {
		flag.Usage()
		log.Fatal("--url flag is required")
	}

	return Args{
		url: *url,
	}
}

func setupNATS(userJWT string, nkeySeed string) (*nats.Conn, error) {
	if client != nil {
		return client, nil
	}

	if userJWT == "" || nkeySeed == "" {
		return nil, fmt.Errorf("missing NATS credentials in environment")
	}

	// Create a KeyPair from the seed
	kp, err := nkeys.FromSeed([]byte(nkeySeed))
	if err != nil {
		return nil, fmt.Errorf("failed to create keypair: %w", err)
	}
	defer kp.Wipe() // Always wipe the keypair when done

	// Setup authentication options
	opts := []nats.Option{
		nats.UserJWT(func() (string, error) {
			return userJWT, nil
		}, func(nonce []byte) ([]byte, error) {
			sig, err := kp.Sign(nonce)
			if err != nil {
				return nil, err
			}
			return sig, nil
		}),
		nats.Name("NATS Service"),
		nats.Timeout(5 * time.Second),
		nats.RetryOnFailedConnect(true),
		nats.MaxReconnects(-1), // Infinite reconnects
		nats.DisconnectErrHandler(func(nc *nats.Conn, err error) {
			log.Printf("Got disconnected! Reason: %q\n", err)
		}),
		nats.ReconnectHandler(func(nc *nats.Conn) {
			log.Printf("Got reconnected to %v!\n", nc.ConnectedUrl())
		}),
		nats.ClosedHandler(func(nc *nats.Conn) {
			log.Printf("Connection closed. Reason: %q\n", nc.LastError())
		}),
	}

	// Connect to NATS
	nc, err := nats.Connect("tls://connect.ngs.global", opts...)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to NATS: %w", err)
	}

	client = nc
	return client, nil
}

func handleMessages(msgChan <-chan gladia.WebSocketMessage, nc *nats.Conn) {
	for msg := range msgChan {
		// Handle received messages

		// parse the incoming message
		parsed := msg.Message()

		log.Printf("Received message: %v\n", parsed)

		// identify if parsed message contains the wake word "mods"
		match := SearchString(parsed, "mod")

		if match.Found {
			payload := map[string]interface{}{
				"command": "moderate",
				"args": map[string]interface{}{
					"message": parsed,
				},
			}
			data, err := json.Marshal(payload)
			if err != nil {
				log.Fatal("it did not marshal")
			}
			err = nc.Publish("twitchapi", data)
			if err != nil {
				log.Fatal("it broke", err)
			}
			log.Printf("Received message: %v\n", msg)
		}
	}
}
