package repository

import (
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/db/database"
)

func TestRepositoryConstructorsRefuseMissingDependencies(t *testing.T) {
	clock := func() time.Time { return time.Time{} }
	tests := []struct {
		name  string
		build func()
	}{
		{"module without ids", func() { NewModuleRepository(nil, nil, clock) }},
		{"module without clock", func() { NewModuleRepository(nil, database.RandomIDs{}, nil) }},
		{"workflow without ids", func() { NewWorkflowRepository(nil, nil) }},
		{"alert without ids", func() { NewAlertRepository(nil, nil) }},
		{"scene event without clock", func() { NewSceneEventRepository(nil, nil) }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			defer func() {
				if recover() == nil {
					t.Fatal("constructor accepted a missing dependency")
				}
			}()
			tt.build()
		})
	}
}
