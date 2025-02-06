package main

import (
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/exec"
	"sync"
	"time"
)

const (
	videoSocket = "/tmp/video.sock"
	audioSocket = "/tmp/audio.sock"
)

// StreamProcessor manages the pipeline
type StreamProcessor struct {
	streamURL    string
	videoHandler func([]byte)
	audioHandler func([]byte)
	stopChan     chan struct{}
	wg           sync.WaitGroup
}

func NewStreamProcessor(url string, videoHandler, audioHandler func([]byte)) *StreamProcessor {
	return &StreamProcessor{
		streamURL:    url,
		videoHandler: videoHandler,
		audioHandler: audioHandler,
		stopChan:     make(chan struct{}),
	}
}

func (sp *StreamProcessor) Start() error {
	// Cleanup any existing sockets
	os.Remove(videoSocket)
	os.Remove(audioSocket)

	// create the channel for listeners
	ready := make(chan struct{})

	// Start socket listeners before starting the pipeline
	if err := sp.startSocketListeners(ready); err != nil {
		return fmt.Errorf("failed to start socket listeners: %v", err)
	}

	// do not pass go, do not collect $100, until listeners have started
	<-ready

	// Start the streaming pipeline
	return sp.startPipeline()
}

func (sp *StreamProcessor) Stop() {
	close(sp.stopChan)
	sp.wg.Wait()
	os.Remove(videoSocket)
	os.Remove(audioSocket)
}

func (sp *StreamProcessor) startSocketListeners(ready chan struct{}) error {
	defer close(ready)

	// Start video socket listener
	if err := sp.startListener(videoSocket, sp.videoHandler); err != nil {
		return fmt.Errorf("failed to start video listener: %v", err)
	}

	// Start audio socket listener
	if err := sp.startListener(audioSocket, sp.audioHandler); err != nil {
		return fmt.Errorf("failed to start audio listener: %v", err)
	}

	return nil
}

func (sp *StreamProcessor) startListener(socketPath string, handler func([]byte)) error {
	log.Printf("starting listener for %s", socketPath)

	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		log.Printf("listener error: %v", err)
		return err
	}

	sp.wg.Add(1)
	go func() {
		defer sp.wg.Done()
		defer listener.Close()

		for {
			listener.(*net.UnixListener).SetDeadline(time.Now().Add(time.Second))
			select {
			case <-sp.stopChan:
				return
			default:
				conn, err := listener.Accept()
				if err != nil {
					if opErr, ok := err.(*net.OpError); ok && opErr.Timeout() {
						// This is just a timeout, continue the loop
						continue
					}
					log.Printf("Accept error on %s: %v", socketPath, err)
					continue
				}

				go sp.handleConnection(conn, handler)
			}
		}
	}()

	return nil
}

func (sp *StreamProcessor) handleConnection(conn net.Conn, handler func([]byte)) {
	defer conn.Close()

	buffer := make([]byte, 32*1024) // 32KB buffer
	for {
		// log.Print("looping")
		select {
		case <-sp.stopChan:
			return
		default:
			n, err := conn.Read(buffer)
			if err != nil {
				log.Printf("err: %v", err)
				if err != io.EOF {
					log.Printf("Read error: %v", err)
				}
				return
			}

			// Copy buffer to avoid race conditions
			data := make([]byte, n)
			copy(data, buffer[:n])
			handler(data)
		}
	}
}

func (sp *StreamProcessor) startPipeline() error {
	// Start streamlink process
	streamlink := exec.Command("streamlink",
		sp.streamURL,
		"best",
		"-O") // Output to stdout

	// Start ffmpeg process
	ffmpeg := exec.Command("ffmpeg",
		"-i", "pipe:0", // Read from stdin
		"-c:v", "libx264", // Video codec
		"-f", "h264", // Video format
		fmt.Sprintf("unix:%s", videoSocket), // Video output
		"-c:a", "pcm_s16le",                 // Audio codec
		"-f", "s16le", // Audio format
		"-ar", "16000", // sample rate 16KHz
		"-ac", "1", // 1 channel (mono)
		fmt.Sprintf("unix:%s", audioSocket)) // Audio output

	// Connect streamlink's stdout to ffmpeg's stdin
	var pipeError error
	ffmpeg.Stdin, pipeError = streamlink.StdoutPipe()
	if pipeError != nil {
		log.Fatalf("err %v", pipeError)
	}

	// Start the processes
	if err := ffmpeg.Start(); err != nil {
		return fmt.Errorf("failed to start ffmpeg: %v", err)
	}

	if err := streamlink.Start(); err != nil {
		ffmpeg.Process.Kill()
		return fmt.Errorf("failed to start streamlink: %v", err)
	}

	// Wait for processes in goroutine
	go func() {
		streamlink.Wait()
		ffmpeg.Wait()
	}()

	return nil
}
