package database_test

import (
	"go/ast"
	"go/parser"
	"go/token"
	iofs "io/fs"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database"
	"github.com/wolfymaster/woofx3/db/database/migrate/migrations"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

// modelsWithoutTables are models with a uuid id that no migration chain
// creates a table for, so nothing can store them.
var modelsWithoutTables = map[string]bool{
	"Treat":       true,
	"UserMessage": true,
}

// uuidIDModels is one row of every model whose id the create callback
// assigns, with only what the schema's CHECK constraints demand filled in.
// Each row's id is left zero.
func uuidIDModels() map[string]any {
	viewers := int64(1)
	return map[string]any{
		"Action":                 &models.Action{},
		"Alert":                  &models.Alert{},
		"Asset":                  &models.Asset{},
		"BackgroundTask":         &models.BackgroundTask{},
		"Command":                &models.Command{},
		"Group":                  &models.Group{},
		"Module":                 &models.Module{},
		"ModuleFunction":         &models.ModuleFunction{},
		"ModuleResource":         &models.ModuleResource{},
		"ModuleResourceInstance": &models.ModuleResourceInstance{},
		"ModuleSetting":          &models.ModuleSetting{},
		"OverlayToken":           &models.OverlayToken{},
		"Resource":               &models.Resource{IsFolder: true},
		"ResourceReference":      &models.ResourceReference{},
		"Scene":                  &models.Scene{},
		"SceneBackup":            &models.SceneBackup{Version: "draft", SourceColumn: "widgets", Reason: "unreadable_column"},
		"SceneEvent":             &models.SceneEvent{},
		"SceneEventLogEntry":     &models.SceneEventLogEntry{Kind: "delivered"},
		"StreamGaugeSample":      &models.StreamGaugeSample{ViewerCount: &viewers},
		"StreamSession":          &models.StreamSession{},
		"StreamSessionSegment":   &models.StreamSessionSegment{},
		"Trigger":                &models.Trigger{},
		"User":                   &models.User{},
		"UserEvent":              &models.UserEvent{},
		"UserMeta":               &models.UserMeta{},
		"Widget":                 &models.Widget{},
		"WidgetSetting":          &models.WidgetSetting{},
		"WidgetStatus":           &models.WidgetStatus{},
		"WorkerEvent":            &models.WorkerEvent{},
		"WorkflowDefinition":     &models.WorkflowDefinition{},
		"WorkflowExecution":      &models.WorkflowExecution{},
		"WorkflowExecutionStep":  &models.WorkflowExecutionStep{},
	}
}

func openMigratedSQLite(t *testing.T, ids database.IDSource) *gorm.DB {
	t.Helper()
	db := openMemoryDB(t, ids)
	chain, err := migrations.For(database.DialectSQLite)
	if err != nil {
		t.Fatalf("migrations.For: %v", err)
	}
	if err := gormigrate.New(db, migrations.Options, chain).Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

// Every model creates on the SQLite chain with no id supplied, and gets a
// distinct id. Foreign keys are off: the rows reference parents that do not
// exist, and what is under test is the id, not the references.
func TestEveryUUIDModelGetsAnIDOnSQLite(t *testing.T) {
	db := openMigratedSQLite(t, &sequentialIDs{})
	if err := db.Exec("PRAGMA foreign_keys = OFF").Error; err != nil {
		t.Fatalf("disable foreign keys: %v", err)
	}

	seen := make(map[string]string)
	rows := uuidIDModels()
	names := make([]string, 0, len(rows))
	for name := range rows {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		t.Run(name, func(t *testing.T) {
			row := rows[name]
			if err := db.Create(row).Error; err != nil {
				t.Fatalf("create %s: %v", name, err)
			}
			id := idOf(t, row)
			if id == "" || id == uuid.Nil.String() {
				t.Fatalf("%s was stored with no id", name)
			}
			if other, ok := seen[id]; ok {
				t.Fatalf("%s got id %s, already given to %s", name, id, other)
			}
			seen[id] = name
		})
	}
}

// The table above must name every model with a uuid id, so a new model cannot
// skip the check.
func TestEveryUUIDModelIsCovered(t *testing.T) {
	declared := uuidIDModelNames(t)
	covered := uuidIDModels()
	for _, name := range declared {
		if _, ok := covered[name]; !ok && !modelsWithoutTables[name] {
			t.Errorf("model %s has a uuid id but is missing from uuidIDModels", name)
		}
	}
	for name := range covered {
		if !contains(declared, name) {
			t.Errorf("uuidIDModels names %s, which has no uuid id primary key", name)
		}
	}
}

func idOf(t *testing.T, row any) string {
	t.Helper()
	field := reflect.Indirect(reflect.ValueOf(row)).FieldByName("ID")
	switch value := field.Interface().(type) {
	case uuid.UUID:
		return value.String()
	case string:
		return value
	default:
		t.Fatalf("%T has an id of type %T", row, value)
		return ""
	}
}

// uuidIDModelNames reads the models package source for structs whose `ID`
// field is a uuid primary key.
func uuidIDModelNames(t *testing.T) []string {
	t.Helper()
	dir := filepath.Join(".", "models")
	fset := token.NewFileSet()
	pkgs, err := parser.ParseDir(fset, dir, func(info iofs.FileInfo) bool {
		return !strings.HasSuffix(info.Name(), "_test.go")
	}, 0)
	if err != nil {
		t.Fatalf("parse %s: %v", dir, err)
	}
	var names []string
	for _, pkg := range pkgs {
		for _, file := range pkg.Files {
			ast.Inspect(file, func(node ast.Node) bool {
				spec, ok := node.(*ast.TypeSpec)
				if !ok {
					return true
				}
				structType, ok := spec.Type.(*ast.StructType)
				if !ok {
					return false
				}
				for _, field := range structType.Fields.List {
					if len(field.Names) != 1 || field.Names[0].Name != "ID" || field.Tag == nil {
						continue
					}
					tag := field.Tag.Value
					if strings.Contains(tag, "primaryKey") && strings.Contains(tag, "type:uuid") {
						names = append(names, spec.Name.Name)
					}
				}
				return false
			})
		}
	}
	sort.Strings(names)
	return names
}

func contains(names []string, name string) bool {
	for _, n := range names {
		if n == name {
			return true
		}
	}
	return false
}
