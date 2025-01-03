package main

import (
	"context"
	"log"
	"net/http"
	"os"

	coredb "github.com/wolfymaster/wolfyttv-db/services/coredb"
)

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL is not set")
	}

	ctx := context.Background()
	err := coredb.InitializeDB(ctx, dsn)
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	server := &coredb.RPC{}
	twirpHandler := coredb.NewCoreDBServiceServer(server)

	http.ListenAndServe(":8080", twirpHandler)
}
