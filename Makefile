.PHONY: migrate-up migrate-down

# Database connection string (can be overridden with environment variable)
DB_URL ?= postgres://postgres:postgres@localhost:5432/woofx3?sslmode=disable

# Build the migration tool
build-migrate:
	@echo "Building migration tool..."
	@go build -o bin/migrate ./db/cmd/migrate

# Run migrations
migrate-up: build-migrate
	@echo "Running migrations..."
	@./bin/migrate -db "$(DB_URL)" -cmd up

# Rollback the last migration
migrate-down: build-migrate
	@echo "Rolling back last migration..."
	@./bin/migrate -db "$(DB_URL)" -cmd down

# Show database status
migrate-status: build-migrate
	@echo "Migration status:"
	@./bin/migrate -db "$(DB_URL)" -cmd status

# Create a new migration file
migrate-create:
	@if [ -z "$(name)" ]; then \
		echo "Error: migration name is required. Usage: make migrate-create name=description_of_change"; \
		exit 1; \
	fi
	@migrate create -ext sql -dir db/migrations $(name)
