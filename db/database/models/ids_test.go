package models

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// postgresOnlyIDDefault is the gorm tag fragment naming the column default
// the SQLite schema lacks.
const postgresOnlyIDDefault = "default:uuid_generate_v4()"

// TestEveryUUIDDefaultModelAssignsItsIDBeforeCreate reads this package's
// source, so a new model that declares the Postgres-only id default without
// a BeforeCreate hook fails here instead of on the first SQLite insert.
func TestEveryUUIDDefaultModelAssignsItsIDBeforeCreate(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read models dir: %v", err)
	}
	fset := token.NewFileSet()
	declaring := map[string]bool{}
	hooked := map[string]bool{}
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(fset, name, nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", name, err)
		}
		for _, decl := range file.Decls {
			switch d := decl.(type) {
			case *ast.GenDecl:
				collectDeclaringStructs(d, declaring)
			case *ast.FuncDecl:
				if name := pointerReceiverName(d); name != "" && d.Name.Name == "BeforeCreate" {
					hooked[name] = true
				}
			}
		}
	}

	if len(declaring) == 0 {
		t.Fatal("found no model declaring the Postgres id default; the scan is broken")
	}
	var missing []string
	for name := range declaring {
		if !hooked[name] {
			missing = append(missing, name)
		}
	}
	sort.Strings(missing)
	if len(missing) > 0 {
		t.Errorf("models with %s but no BeforeCreate assigning the id (see ids.go): %v", postgresOnlyIDDefault, missing)
	}
}

func collectDeclaringStructs(decl *ast.GenDecl, into map[string]bool) {
	for _, spec := range decl.Specs {
		typeSpec, ok := spec.(*ast.TypeSpec)
		if !ok {
			continue
		}
		structType, ok := typeSpec.Type.(*ast.StructType)
		if !ok {
			continue
		}
		for _, field := range structType.Fields.List {
			if field.Tag == nil {
				continue
			}
			tag := reflect.StructTag(strings.Trim(field.Tag.Value, "`"))
			if strings.Contains(tag.Get("gorm"), postgresOnlyIDDefault) {
				into[typeSpec.Name.Name] = true
			}
		}
	}
}

func pointerReceiverName(fn *ast.FuncDecl) string {
	if fn.Recv == nil || len(fn.Recv.List) != 1 {
		return ""
	}
	star, ok := fn.Recv.List[0].Type.(*ast.StarExpr)
	if !ok {
		return ""
	}
	ident, ok := star.X.(*ast.Ident)
	if !ok {
		return ""
	}
	return ident.Name
}
