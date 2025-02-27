module github.com/wolfymaster/wolfyttv-db

go 1.23.3

require (
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/pgx/v5 v5.7.2 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	github.com/joho/godotenv v1.5.1 // indirect
	github.com/twitchtv/twirp v8.1.3+incompatible // indirect
	golang.org/x/crypto v0.31.0 // indirect
	golang.org/x/sync v0.10.0 // indirect
	golang.org/x/text v0.21.0 // indirect
	google.golang.org/protobuf v1.36.1 // indirect

	github.com/wolfymaster/wolfyttv/coredb v0.0.0
)

replace github.com/wolfymaster/wolfyttv/coredb => ../buf/gen/github.com/wolfymaster/wolfyttv/coredb
