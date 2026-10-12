module github.com/wolfymaster/woofx3/db

go 1.25.0

require (
	github.com/benbjohnson/litestream v0.5.17
	github.com/casbin/casbin/v2 v2.122.0
	github.com/casbin/gorm-adapter/v3 v3.36.0
	github.com/cloudevents/sdk-go/v2 v2.16.2
	github.com/go-gormigrate/gormigrate/v2 v2.1.5
	github.com/google/uuid v1.6.0
	github.com/jackc/pgx/v5 v5.7.2
	github.com/libtnb/sqlite v1.0.3
	github.com/nats-io/nats.go v1.48.0
	github.com/twitchtv/twirp v8.1.3+incompatible
	github.com/wolfymaster/woofx3/clients/db v0.0.0
	github.com/wolfymaster/woofx3/clients/nats v0.0.0
	github.com/wolfymaster/woofx3/common/cloudevents v0.0.0
	github.com/wolfymaster/woofx3/common/conditions v0.0.0
	github.com/wolfymaster/woofx3/common/logging v0.0.0
	github.com/wolfymaster/woofx3/common/runtime v0.0.0
	go.opentelemetry.io/otel v1.43.0
	google.golang.org/protobuf v1.36.11
	gorm.io/driver/postgres v1.5.11
	gorm.io/gorm v1.31.1
	modernc.org/sqlite v1.49.1
)

require (
	github.com/aws/aws-sdk-go-v2 v1.41.5 // indirect
	github.com/aws/aws-sdk-go-v2/aws/protocol/eventstream v1.7.8 // indirect
	github.com/aws/aws-sdk-go-v2/config v1.32.6 // indirect
	github.com/aws/aws-sdk-go-v2/credentials v1.19.6 // indirect
	github.com/aws/aws-sdk-go-v2/feature/ec2/imds v1.18.16 // indirect
	github.com/aws/aws-sdk-go-v2/feature/s3/manager v1.20.18 // indirect
	github.com/aws/aws-sdk-go-v2/internal/configsources v1.4.21 // indirect
	github.com/aws/aws-sdk-go-v2/internal/endpoints/v2 v2.7.21 // indirect
	github.com/aws/aws-sdk-go-v2/internal/ini v1.8.4 // indirect
	github.com/aws/aws-sdk-go-v2/internal/v4a v1.4.22 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/accept-encoding v1.13.7 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/checksum v1.9.13 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/presigned-url v1.13.21 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/s3shared v1.19.21 // indirect
	github.com/aws/aws-sdk-go-v2/service/s3 v1.97.3 // indirect
	github.com/aws/aws-sdk-go-v2/service/signin v1.0.4 // indirect
	github.com/aws/aws-sdk-go-v2/service/sso v1.30.8 // indirect
	github.com/aws/aws-sdk-go-v2/service/ssooidc v1.35.12 // indirect
	github.com/aws/aws-sdk-go-v2/service/sts v1.41.5 // indirect
	github.com/aws/smithy-go v1.24.2 // indirect
	github.com/beorn7/perks v1.0.1 // indirect
	github.com/bmatcuk/doublestar/v4 v4.6.1 // indirect
	github.com/casbin/govaluate v1.3.0 // indirect
	github.com/cenkalti/backoff/v5 v5.0.3 // indirect
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/dustin/go-humanize v1.0.1 // indirect
	github.com/glebarez/go-sqlite v1.20.3 // indirect
	github.com/glebarez/sqlite v1.7.0 // indirect
	github.com/go-logr/logr v1.4.3 // indirect
	github.com/go-logr/stdr v1.2.2 // indirect
	github.com/go-sql-driver/mysql v1.7.0 // indirect
	github.com/golang-sql/civil v0.0.0-20220223132316-b832511892a9 // indirect
	github.com/golang-sql/sqlexp v0.1.0 // indirect
	github.com/gorilla/websocket v1.5.3 // indirect
	github.com/grpc-ecosystem/grpc-gateway/v2 v2.27.2 // indirect
	github.com/hablullah/go-hijri v1.0.2 // indirect
	github.com/hablullah/go-juliandays v1.0.0 // indirect
	github.com/hashicorp/golang-lru/v2 v2.0.7 // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	github.com/jalaali/go-jalaali v0.0.0-20210801064154-80525e88d958 // indirect
	github.com/jinzhu/inflection v1.0.0 // indirect
	github.com/jinzhu/now v1.1.5 // indirect
	github.com/json-iterator/go v1.1.12 // indirect
	github.com/klauspost/compress v1.18.0 // indirect
	github.com/lmittmann/tint v1.1.3 // indirect
	github.com/magefile/mage v1.14.0 // indirect
	github.com/markusmobius/go-dateparser v1.2.4 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/matttproud/golang_protobuf_extensions/v2 v2.0.0 // indirect
	github.com/microsoft/go-mssqldb v1.6.0 // indirect
	github.com/modern-go/concurrent v0.0.0-20180306012644-bacd9c7ef1dd // indirect
	github.com/modern-go/reflect2 v1.0.2 // indirect
	github.com/nats-io/nkeys v0.4.11 // indirect
	github.com/nats-io/nuid v1.0.1 // indirect
	github.com/ncruces/go-strftime v1.0.0 // indirect
	github.com/pierrec/lz4/v4 v4.1.23 // indirect
	github.com/pkg/errors v0.9.1 // indirect
	github.com/prometheus/client_golang v1.17.0 // indirect
	github.com/prometheus/client_model v0.5.0 // indirect
	github.com/prometheus/common v0.45.0 // indirect
	github.com/prometheus/procfs v0.12.0 // indirect
	github.com/psanford/sqlite3vfs v0.0.0-20260519004904-f9180fa2acc9 // indirect
	github.com/remyoudompheng/bigfft v0.0.0-20230129092748-24d4a6f8daec // indirect
	github.com/superfly/ltx v0.5.2 // indirect
	github.com/tetratelabs/wazero v1.2.1 // indirect
	github.com/wasilibs/go-re2 v1.3.0 // indirect
	github.com/wolfymaster/woofx3/clients/barkloader v0.0.0 // indirect
	go.opentelemetry.io/auto/sdk v1.2.1 // indirect
	go.opentelemetry.io/contrib/bridges/otelslog v0.13.0 // indirect
	go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp v0.14.0 // indirect
	go.opentelemetry.io/otel/exporters/otlp/otlptrace v1.38.0 // indirect
	go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp v1.38.0 // indirect
	go.opentelemetry.io/otel/exporters/stdout/stdouttrace v1.38.0 // indirect
	go.opentelemetry.io/otel/log v0.14.0 // indirect
	go.opentelemetry.io/otel/metric v1.43.0 // indirect
	go.opentelemetry.io/otel/sdk v1.43.0 // indirect
	go.opentelemetry.io/otel/sdk/log v0.14.0 // indirect
	go.opentelemetry.io/otel/trace v1.43.0 // indirect
	go.opentelemetry.io/proto/otlp v1.7.1 // indirect
	go.uber.org/multierr v1.11.0 // indirect
	go.uber.org/zap v1.27.0 // indirect
	golang.org/x/crypto v0.52.0 // indirect
	golang.org/x/net v0.55.0 // indirect
	golang.org/x/sync v0.21.0 // indirect
	golang.org/x/sys v0.45.0 // indirect
	golang.org/x/text v0.39.0 // indirect
	google.golang.org/genproto/googleapis/api v0.0.0-20260414002931-afd174a4e478 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260414002931-afd174a4e478 // indirect
	google.golang.org/grpc v1.82.1 // indirect
	gorm.io/driver/mysql v1.5.7 // indirect
	gorm.io/driver/sqlserver v1.5.3 // indirect
	gorm.io/plugin/dbresolver v1.6.0 // indirect
	modernc.org/libc v1.72.0 // indirect
	modernc.org/mathutil v1.7.1 // indirect
	modernc.org/memory v1.11.0 // indirect
)

replace (
	github.com/glebarez/go-sqlite => ./third_party/glebarez-go-sqlite
	github.com/wolfymaster/woofx3/clients/barkloader => ../shared/clients/golang/barkloader
	github.com/wolfymaster/woofx3/clients/db => ../shared/clients/golang/db
	github.com/wolfymaster/woofx3/clients/nats => ../shared/clients/golang/nats
	github.com/wolfymaster/woofx3/common/cloudevents => ../shared/common/golang/cloudevents
	github.com/wolfymaster/woofx3/common/conditions => ../shared/common/golang/conditions
	github.com/wolfymaster/woofx3/common/logging => ../shared/common/golang/logging
	github.com/wolfymaster/woofx3/common/runtime => ../shared/common/golang/runtime
)
