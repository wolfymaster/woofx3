package main

import (
	"flag"
	"log"
	"os"

	"github.com/wolfymaster/woofx3-db/db"
	"github.com/wolfymaster/woofx3-db/db/migrate"
)

func main() {
	// Parse command line flags
	cmd := flag.String("cmd", "up", "migration command (up, down)")
	dbURL := flag.String("db", os.Getenv("DATABASE_URL"), "database connection string")
	flag.Parse()

	if *dbURL == "" {
		log.Fatal("Database URL is required. Use -db flag or set DATABASE_URL environment variable")
	}

	// Initialize database connection
	database, err := db.Connect(*dbURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	switch *cmd {
	case "up":
		log.Println("Running migrations...")
		if err := migrate.Migrate(database); err != nil {
			log.Fatalf("Migration failed: %v", err)
		}
		log.Println("Migrations completed successfully")

	case "down":
		log.Println("Rolling back last migration...")
		if err := migrate.Rollback(database); err != nil {
			log.Fatalf("Rollback failed: %v", err)
		}
		log.Println("Rollback completed successfully")

	default:
		log.Fatalf("Unknown command: %s. Use 'up' or 'down'", *cmd)
	}
}
}
