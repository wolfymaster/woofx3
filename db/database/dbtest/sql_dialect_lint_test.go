package dbtest

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// sqlSourceDirs are the packages that write SQL against the system database,
// relative to this one.
var sqlSourceDirs = []string{
	"../repository",
	"../models",
	"../../app/services",
	"../../app/workers",
}

// portableAlternative matches SQL that only one dialect accepts and that has
// a form both accept, so it is never needed: name tables without a schema,
// bind times from the repository's injected clock, and give rows their ids
// in Go.
var portableAlternative = regexp.MustCompile(`(?i)\bpublic\.[a-z_]|\bnow\(\)|gen_random_uuid\(|uuid_generate_v4\(|datetime\('now'\)`)

// dialectOnly matches SQL that only one dialect accepts and that has no
// shared spelling. It may appear only on a dialect-checked path.
var dialectOnly = regexp.MustCompile(`(?i)::[a-z]|->>|\bilike\b|\bpg_[a-z]|\bextract\(|\bjsonb_[a-z]|\bjson_extract\(|\bstrftime\(|\bstatement_timestamp\(`)

// dialectCheck is what a condition that picks SQL per dialect contains.
var dialectCheck = regexp.MustCompile(`Dialector\.Name\(\)|isPostgres\(\)`)

// TestSQLStringsWorkOnBothDialects reads the source of every package that
// writes to the system database, subpackages included, and fails on a string
// literal holding SQL that only one dialect accepts, unless it sits on a
// dialect-checked path (see dialectGuard).
//
// It is a tripwire for the spellings that broke SQLite engines, not a proof:
// it misses SQL assembled from fragments, and a package-level constant
// holding one dialect's SQL is flagged even when only a guarded path uses
// it. The per-dialect tests prove what each query does.
func TestSQLStringsWorkOnBothDialects(t *testing.T) {
	var violations []string
	scanned := 0
	for _, root := range sqlSourceDirs {
		err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			name := entry.Name()
			if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") || strings.HasSuffix(name, ".pb.go") {
				return nil
			}
			source, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			violations = append(violations, lintSQLStrings(t, path, source)...)
			scanned++
			return nil
		})
		if err != nil {
			t.Fatalf("walk %s: %v", root, err)
		}
	}
	if scanned == 0 {
		t.Fatal("scanned no source files; sqlSourceDirs is wrong")
	}
	for _, v := range violations {
		t.Error(v)
	}
}

// sqlLinter checks the string literals of one file.
type sqlLinter struct {
	fset       *token.FileSet
	source     []byte
	violations []string
}

func lintSQLStrings(t *testing.T, path string, source []byte) []string {
	t.Helper()
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, path, source, 0)
	if err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	l := &sqlLinter{fset: fset, source: source}
	for _, decl := range file.Decls {
		l.walk(decl, false)
	}
	return l.violations
}

// walk checks every string literal under node. `guarded` is true on a path
// only one dialect reaches, where that dialect's SQL is allowed.
func (l *sqlLinter) walk(node ast.Node, guarded bool) {
	ast.Inspect(node, func(n ast.Node) bool {
		switch n := n.(type) {
		case *ast.Field:
			// Struct tags carry gorm column defaults, which describe the
			// Postgres schema and are never sent as SQL by themselves.
			return false
		case *ast.BlockStmt:
			l.walkBlock(n.List, guarded)
			return false
		case *ast.IfStmt:
			if !l.isDialectCheck(n.Cond) {
				return true
			}
			l.walk(n.Cond, guarded)
			l.walk(n.Body, true)
			if n.Else != nil {
				l.walk(n.Else, true)
			}
			return false
		case *ast.BasicLit:
			l.check(n, guarded)
		}
		return true
	})
}

// walkBlock walks a statement list, treating everything after a dialect
// guard as guarded too.
func (l *sqlLinter) walkBlock(stmts []ast.Stmt, guarded bool) {
	for _, stmt := range stmts {
		l.walk(stmt, guarded)
		if l.isDialectGuard(stmt) {
			guarded = true
		}
	}
}

// isDialectGuard reports whether stmt is `if <dialect check> { ...; return }`:
// one dialect leaves there, so the statements after it run for the other one
// only.
func (l *sqlLinter) isDialectGuard(stmt ast.Stmt) bool {
	ifStmt, ok := stmt.(*ast.IfStmt)
	if !ok || ifStmt.Else != nil || !l.isDialectCheck(ifStmt.Cond) || len(ifStmt.Body.List) == 0 {
		return false
	}
	_, returns := ifStmt.Body.List[len(ifStmt.Body.List)-1].(*ast.ReturnStmt)
	return returns
}

func (l *sqlLinter) isDialectCheck(cond ast.Expr) bool {
	start := l.fset.Position(cond.Pos()).Offset
	end := l.fset.Position(cond.End()).Offset
	return dialectCheck.Match(l.source[start:end])
}

func (l *sqlLinter) check(lit *ast.BasicLit, guarded bool) {
	if lit.Kind != token.STRING {
		return
	}
	if portableAlternative.MatchString(lit.Value) {
		l.report(lit, "one dialect's SQL with a portable form (no schema prefix; bind times from the injected clock; ids from Go)")
	}
	if dialectOnly.MatchString(lit.Value) && !guarded {
		l.report(lit, "one dialect's SQL outside a dialect-checked path")
	}
}

func (l *sqlLinter) report(lit *ast.BasicLit, why string) {
	l.violations = append(l.violations, l.fset.Position(lit.Pos()).String()+": "+why+": "+lit.Value)
}
