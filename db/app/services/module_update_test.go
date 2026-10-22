package services

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/dbtest"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

func TestUpdateModuleReplacesItsFunctionsOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		module := &models.Module{
			ID:        uuid.New(),
			ModuleKey: "wheel:1.0.0:abc",
			ModuleID:  "wheel",
			Name:      "Wheel",
			Version:   "1.0.0",
		}
		if err := db.Create(module).Error; err != nil {
			t.Fatalf("install module: %v", err)
		}
		svc := NewModuleService(repo.NewModuleRepository(db, time.Now), nil, nil, nil)

		resp, err := svc.UpdateModule(context.Background(), &client.UpdateModuleRequest{
			Id:      module.ID.String(),
			Version: "1.1.0",
			Functions: []*client.CreateModuleFunctionRequest{
				{ManifestId: "spin", Name: "spin", FileName: "spin.js", FileKey: "k1", EntryPoint: "main", Runtime: "js"},
				{ManifestId: "reset", Name: "reset", FileName: "reset.js", FileKey: "k2", EntryPoint: "main", Runtime: "js"},
			},
		})
		if err != nil {
			t.Fatalf("UpdateModule: %v", err)
		}

		var functions []models.ModuleFunction
		if err := db.Where("module_id = ?", module.ID).Find(&functions).Error; err != nil {
			t.Fatalf("read functions: %v", err)
		}
		if len(functions) != 2 || functions[0].ID == uuid.Nil || functions[0].ID == functions[1].ID {
			t.Fatalf("functions = %+v, want two with distinct ids", functions)
		}
		if len(resp.Module.GetFunctions()) != 2 {
			t.Fatalf("response carries %d functions, want 2", len(resp.Module.GetFunctions()))
		}
	})
}
