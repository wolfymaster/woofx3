# Database Migrations

This directory contains database migrations for the woofx3 application.

## Getting Started

### Prerequisites

- Go 1.16 or later
- PostgreSQL database
- Environment variable `DATABASE_URL` set with the connection string
  ```
  postgres://username:password@host:port/dbname?sslmode=disable
  ```

### Installation

1. Install dependencies:
   ```bash
   go mod tidy
   ```

## Usage

### Running Migrations

To run all pending migrations:

```bash
make migrate-up
```

### Rolling Back Migrations

To roll back the last migration:

```bash
make migrate-down
```

### Checking Migration Status

To check the current migration status:

```bash
make migrate-status
```

### Creating a New Migration

To create a new migration file:

```bash
make migrate-create name=description_of_change
```

## Manual Execution

You can also run the migration tool directly:

```bash
# Run migrations
go run cmd/migrate/main.go -cmd up -db "your_database_url"

# Rollback last migration
go run cmd/migrate/main.go -cmd down -db "your_database_url"
```

## Environment Variables

- `DATABASE_URL`: PostgreSQL connection string (default: "postgres://postgres:postgres@localhost:5432/woofx3?sslmode=disable")
- `JWT_SECRET`: Secret key for JWT tokens
- `JWT_EXPIRATION`: JWT token expiration duration (default: 24h)
- `CLIENT_JWT_SECRET`: Secret key for client JWT tokens
- `CLIENT_JWT_EXPIRATION`: Client JWT token expiration duration (default: 720h)

## Migration Best Practices

1. Always create a new migration for schema changes
2. Write idempotent migrations that can be run multiple times
3. Include both `Up` and `Down` migrations
4. Test migrations in a development environment before running in production
5. Backup your database before running migrations in production

## Troubleshooting

### Common Issues

- **Connection refused**: Ensure the database is running and the connection string is correct
- **Permission denied**: Check database user permissions
- **Duplicate migration**: Each migration ID must be unique

### Viewing Migration Logs

Check the application logs for detailed error messages during migration.
