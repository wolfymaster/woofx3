package dbtest

import (
	"go/ast"
	"go/parser"
	"go/token"
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
// use CURRENT_TIMESTAMP, and give rows their ids in Go.
var portableAlternative = regexp.MustCompile(`(?i)\bpublic\.[a-z_]|\bnow\(\)|gen_random_uuid\(|uuid_generate_v4\(|datetime\('now'\)`)

// dialectOnly matches SQL that only one dialect accepts and that has no
// shared spelling. It may appear only in a function that branches on the
// dialect.
var dialectOnly = regexp.MustCompile(`(?i)::[a-z]|->>|\bilike\b|\bpg_[a-z]|\bextract\(|\bjsonb_[a-z]|\bjson_extract\(|\bstrftime\(|\bstatement_timestamp\(`)

// dialectBranch is what a function that picks SQL per dialect contains.
var dialectBranch = regexp.MustCompile(`Dialector\.Name\(\)|isPostgres\(\)`)

// TestSQLStringsWorkOnBothDialects reads the source of every package that
// writes to the system database and fails on a string literal holding SQL
// that only one dialect accepts, unless the function holding it branches on
// the dialect. It catches the spellings that broke SQLite engines before;
// the per-dialect tests prove what each query does.
func TestSQLStringsWorkOnBothDialects(t *testing.T) {
	var violations []string
	scanned := 0
	for _, dir := range sqlSourceDirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			t.Fatalf("read %s: %v", dir, err)
		}
		for _, entry := range entries {
			name := entry.Name()
			if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") || strings.HasSuffix(name, ".pb.go") {
				continue
			}
			path := filepath.Join(dir, name)
			source, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("read %s: %v", path, err)
			}
			violations = append(violations, lintSQLStrings(t, path, source)...)
			scanned++
		}
	}
	if scanned == 0 {
		t.Fatal("scanned no source files; sqlSourceDirs is wrong")
	}
	for _, v := range violations {
		t.Error(v)
	}
}

func lintSQLStrings(t *testing.T, path string, source []byte) []string {
	t.Helper()
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, path, source, 0)
	if err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	var violations []string
	report := func(lit *ast.BasicLit, why string) {
		violations = append(violations, fset.Position(lit.Pos()).String()+": "+why+": "+lit.Value)
	}
	for _, decl := range file.Decls {
		fn, isFunc := decl.(*ast.FuncDecl)
		branches := isFunc && fn.Body != nil &&
			dialectBranch.Match(source[fset.Position(fn.Body.Pos()).Offset:fset.Position(fn.Body.End()).Offset])
		ast.Inspect(decl, func(node ast.Node) bool {
			// Struct tags carry gorm column defaults, which describe the
			// Postgres schema and are never sent as SQL by themselves.
			if _, ok := node.(*ast.Field); ok {
				return false
			}
			lit, ok := node.(*ast.BasicLit)
			if !ok || lit.Kind != token.STRING {
				return true
			}
			if portableAlternative.MatchString(lit.Value) {
				report(lit, "SQL with a portable spelling")
			}
			if dialectOnly.MatchString(lit.Value) && !branches {
				report(lit, "one dialect's SQL outside a function that branches on the dialect")
			}
			return true
		})
	}
	return violations
}
