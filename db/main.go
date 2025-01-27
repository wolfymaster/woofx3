package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"github.com/joho/godotenv"

	coredb "github.com/wolfymaster/wolfyttv-db/services/coredb"
)

func main() {
	godotenv.Load("../.env")

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


	port := os.Getenv("DATABASE_PROXY_PORT")
	if port == "" {
		log.Fatalf("DATABASE_PROXY_PORT is not set")
	}

	err = http.ListenAndServe(":" + port, twirpHandler)
	if err != nil {
		log.Fatal(err)
	 }
}
