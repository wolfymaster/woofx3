package main

import (
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/joho/godotenv"
	"github.com/wolfymaster/wolfyttv-stream/src/gladia"
)

type Args struct {
	url string
}

func main() {
	// load envvars
	godotenv.Load("../.env")

	gladia_api_key := os.Getenv("GLADIA_API_KEY")

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

	// Handle messages in a goroutine
	go func() {
		for msg := range msgChan {
			// Handle received messages
			log.Printf("Received message: %v\n", msg)
		}
	}()

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
