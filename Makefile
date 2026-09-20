.PHONY: migrate-up migrate-down format format-check

# The migration tool is a main package at db/database/migrate, which lives
# inside the db Go module rather than the repo root - hence the cd.
#
# It resolves its own target from WOOFX3_DATABASE_URL (environment, then .env,
# then databaseUrl in .woofx3.json), so DB_URL is only an override for pointing
# at a different database. It is deliberately empty by default and passed
# conditionally: supplying -db unconditionally overrides that resolution and
# sends every migration at whatever the default happens to be.
DB_URL ?=
migrate_db_flag = $(if $(DB_URL),-db "$(DB_URL)")

# Apply every migration the target database has not already recorded.
#
# Migrations are Go functions under db/database/migrate/migrations/{postgres,
# sqlite}, each registered in that dialect's all.go. To add one, write the
# function and append it to both lists in the same position: the two dialects
# share one migration history, and gormigrate identifies applied migrations by
# the ID in the file, not by filename.
migrate-up:
	@cd db && go run ./database/migrate -cmd up $(migrate_db_flag)

# Roll back only the most recently applied migration.
migrate-down:
	@cd db && go run ./database/migrate -cmd down $(migrate_db_flag)

# Format every hand-written source file (generated and vendored code excluded)
format:
	@./scripts/format.sh

# Fail if any hand-written source file would be reformatted
format-check:
	@./scripts/format.sh --check
