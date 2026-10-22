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

// TestEveryUUIDKeyedModelAssignsItsIDBeforeCreate reads this package's
// source, so a new model keyed by a single UUID column without a
// BeforeCreate hook fails here instead of on its first insert. Without the
// hook a forgotten id is NULL on SQLite (refused) or the zero UUID on
// Postgres when the struct carries no column default (stored once, then
// colliding). A composite key, or one not named ID, is chosen by its caller
// and is not checked.
func TestEveryUUIDKeyedModelAssignsItsIDBeforeCreate(t *testing.T) {
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
				collectUUIDKeyedStructs(d, declaring)
			case *ast.FuncDecl:
				if name := pointerReceiverName(d); name != "" && d.Name.Name == "BeforeCreate" {
					hooked[name] = true
				}
			}
		}
	}

	if len(declaring) == 0 {
		t.Fatal("found no model keyed by a UUID; the scan is broken")
	}
	var missing []string
	for name := range declaring {
		if !hooked[name] {
			missing = append(missing, name)
		}
	}
	sort.Strings(missing)
	if len(missing) > 0 {
		t.Errorf("models keyed by a UUID but with no BeforeCreate assigning it (see ids.go): %v", missing)
	}
}

// collectUUIDKeyedStructs records each struct whose primary key is exactly
// one field named ID holding a UUID: a uuid.UUID, or a string gorm stores as
// uuid. A field is the primary key when its gorm tag says so, or, with no key
// tagged in the struct, when it is named ID, as gorm assumes. A key with
// another name refers to a row elsewhere (a compaction's session), so its
// caller must choose it and generating one would hide a bug.
func collectUUIDKeyedStructs(decl *ast.GenDecl, into map[string]bool) {
	for _, spec := range decl.Specs {
		typeSpec, ok := spec.(*ast.TypeSpec)
		if !ok {
			continue
		}
		structType, ok := typeSpec.Type.(*ast.StructType)
		if !ok {
			continue
		}
		var tagged, named []*ast.Field
		for _, field := range structType.Fields.List {
			gormTag := strings.ToLower(fieldGormTag(field))
			if strings.Contains(gormTag, "primarykey") {
				tagged = append(tagged, field)
			}
			if len(field.Names) == 1 && field.Names[0].Name == "ID" {
				named = append(named, field)
			}
		}
		keys := tagged
		if len(keys) == 0 {
			keys = named
		}
		if len(keys) == 1 && len(keys[0].Names) == 1 && keys[0].Names[0].Name == "ID" && holdsUUID(keys[0]) {
			into[typeSpec.Name.Name] = true
		}
	}
}

func fieldGormTag(field *ast.Field) string {
	if field.Tag == nil {
		return ""
	}
	return reflect.StructTag(strings.Trim(field.Tag.Value, "`")).Get("gorm")
}

func holdsUUID(field *ast.Field) bool {
	if selector, ok := field.Type.(*ast.SelectorExpr); ok {
		pkg, ok := selector.X.(*ast.Ident)
		return ok && pkg.Name == "uuid" && selector.Sel.Name == "UUID"
	}
	ident, ok := field.Type.(*ast.Ident)
	return ok && ident.Name == "string" && strings.Contains(strings.ToLower(fieldGormTag(field)), "type:uuid")
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
