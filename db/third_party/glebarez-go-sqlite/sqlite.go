// Package sqlite stands in for github.com/glebarez/go-sqlite, a fork of
// modernc.org/sqlite that registers itself under the same database/sql driver
// name, "sqlite".
//
// db-proxy links modernc.org/sqlite directly (Litestream requires it), and
// database/sql panics when a driver name is registered twice. The fork is
// reached only through github.com/glebarez/sqlite, which casbin's gorm adapter
// imports and which uses nothing of the fork but that registration. Replacing
// the fork with this package makes "sqlite" resolve to the one modernc build in
// the binary, which is also what keeps two SQLite builds from holding separate
// POSIX locks on the same file.
package sqlite

import (
	_ "modernc.org/sqlite"
)
