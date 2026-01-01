module github.com/wolfymaster/woofx3/db

go 1.24.0

require (
	github.com/casbin/casbin/v2 v2.122.0
	github.com/casbin/gorm-adapter/v3 v3.36.0
	github.com/cloudevents/sdk-go/v2 v2.16.2
	github.com/dgraph-io/badger/v3 v3.2103.5
	github.com/gogo/protobuf v1.3.2
	github.com/google/uuid v1.6.0
	github.com/joho/godotenv v1.5.1
	github.com/nats-io/nats.go v1.48.0
	github.com/twitchtv/twirp v8.1.3+incompatible
	github.com/wolfymaster/woofx3/clients/nats v0.0.0
	google.golang.org/protobuf v1.36.8
	gorm.io/driver/postgres v1.5.11
	gorm.io/gorm v1.26.1
)

require (
	github.com/bmatcuk/doublestar/v4 v4.6.1 // indirect
	github.com/casbin/govaluate v1.3.0 // indirect
	github.com/cespare/xxhash v1.1.0 // indirect
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/dgraph-io/ristretto v0.1.1 // indirect
	github.com/dustin/go-humanize v1.0.1 // indirect
	github.com/glebarez/go-sqlite v1.20.3 // indirect
	github.com/glebarez/sqlite v1.7.0 // indirect
	github.com/go-gormigrate/gormigrate/v2 v2.1.5 // indirect
	github.com/go-sql-driver/mysql v1.7.0 // indirect
	github.com/golang-jwt/jwt/v5 v5.3.0 // indirect
	github.com/golang-sql/civil v0.0.0-20220223132316-b832511892a9 // indirect
	github.com/golang-sql/sqlexp v0.1.0 // indirect
	github.com/golang/glog v1.2.5 // indirect
	github.com/golang/groupcache v0.0.0-20190702054246-869f871628b6 // indirect
	github.com/golang/protobuf v1.5.4 // indirect
	github.com/golang/snappy v0.0.3 // indirect
	github.com/google/flatbuffers v1.12.1 // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/pgx/v5 v5.7.2 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	github.com/jinzhu/inflection v1.0.0 // indirect
	github.com/jinzhu/now v1.1.5 // indirect
	github.com/json-iterator/go v1.1.12 // indirect
	github.com/klauspost/compress v1.18.0 // indirect
	github.com/mattn/go-isatty v0.0.17 // indirect
	github.com/microsoft/go-mssqldb v1.6.0 // indirect
	github.com/modern-go/concurrent v0.0.0-20180306012644-bacd9c7ef1dd // indirect
	github.com/modern-go/reflect2 v1.0.2 // indirect
	github.com/nats-io/nkeys v0.4.11 // indirect
	github.com/nats-io/nuid v1.0.1 // indirect
	github.com/pkg/errors v0.9.1 // indirect
	github.com/remyoudompheng/bigfft v0.0.0-20230126093431-47fa9a501578 // indirect
	go.opencensus.io v0.22.5 // indirect
	go.uber.org/multierr v1.11.0 // indirect
	go.uber.org/zap v1.27.0 // indirect
	golang.org/x/crypto v0.39.0 // indirect
	golang.org/x/net v0.41.0 // indirect
	golang.org/x/sync v0.16.0 // indirect
	golang.org/x/sys v0.33.0 // indirect
	golang.org/x/text v0.26.0 // indirect
	gorm.io/driver/mysql v1.5.7 // indirect
	gorm.io/driver/sqlserver v1.5.3 // indirect
	gorm.io/plugin/dbresolver v1.6.0 // indirect
	modernc.org/libc v1.22.2 // indirect
	modernc.org/mathutil v1.5.0 // indirect
	modernc.org/memory v1.5.0 // indirect
	modernc.org/sqlite v1.20.3 // indirect
)

replace github.com/wolfymaster/woofx3/clients/nats => ../shared/clients/golang/nats
