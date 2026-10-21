package services

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
)

func newProvenanceSvc(t *testing.T) *moduleService {
	t.Helper()
	db := openEmptySQLite(t)
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("sql db: %v", err)
	}
	// Every connection to :memory: is a separate database.
	sqlDB.SetMaxOpenConns(1)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, sqliteChain(t)).Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return NewModuleService(
		repo.NewModuleRepository(db, database.RandomIDs{}, time.Now),
		repo.NewResourceReferenceRepository(db),
		repo.NewModuleResourceInstanceRepository(db),
		nil,
	)
}

func installCozy(t *testing.T, svc *moduleService, moduleKey string, listingID *string, edition *int32) *client.Module {
	t.Helper()
	res, err := svc.CreateModule(context.Background(), &client.CreateModuleRequest{
		Name:                 "Cozy",
		ModuleId:             "cozy",
		Version:              "1.0.0",
		Manifest:             "{}",
		ModuleKey:            moduleKey,
		CreatedByType:        "CLIENT",
		CreatedByRef:         "client-1",
		MarketplaceListingId: listingID,
		MarketplaceEdition:   edition,
	})
	if err != nil {
		t.Fatalf("CreateModule %s: %v", moduleKey, err)
	}
	return res.Module
}

func ptr[T any](v T) *T {
	return &v
}

func assertProvenance(t *testing.T, label string, m *client.Module, listingID string, edition int32) {
	t.Helper()
	if m.GetMarketplaceListingId() != listingID || m.GetMarketplaceEdition() != edition {
		t.Fatalf("%s: provenance = (%q, %d), want (%q, %d)",
			label, m.GetMarketplaceListingId(), m.GetMarketplaceEdition(), listingID, edition)
	}
}

func TestMarketplaceProvenanceRoundTripsThroughGetAndList(t *testing.T) {
	svc := newProvenanceSvc(t)
	created := installCozy(t, svc, "cozy:1.0.0:abcdef0", ptr("cozy-v2"), ptr(int32(2)))
	assertProvenance(t, "CreateModule", created, "cozy-v2", 2)

	got, err := svc.GetModule(context.Background(), &client.GetModuleRequest{Id: created.Id})
	if err != nil {
		t.Fatalf("GetModule: %v", err)
	}
	assertProvenance(t, "GetModule", got.Module, "cozy-v2", 2)

	listed, err := svc.ListModules(context.Background(), &client.ListModulesRequest{})
	if err != nil {
		t.Fatalf("ListModules: %v", err)
	}
	if len(listed.Modules) != 1 {
		t.Fatalf("ListModules returned %d modules, want 1", len(listed.Modules))
	}
	assertProvenance(t, "ListModules", listed.Modules[0], "cozy-v2", 2)
}

func TestAModuleInstalledOutsideTheMarketplaceHasNoProvenance(t *testing.T) {
	svc := newProvenanceSvc(t)
	created := installCozy(t, svc, "cozy:1.0.0:abcdef0", nil, nil)
	got, err := svc.GetModule(context.Background(), &client.GetModuleRequest{Id: created.Id})
	if err != nil {
		t.Fatalf("GetModule: %v", err)
	}
	if got.Module.MarketplaceListingId != nil || got.Module.MarketplaceEdition != nil {
		t.Fatalf("provenance = (%v, %v), want both unset", got.Module.MarketplaceListingId, got.Module.MarketplaceEdition)
	}
}

// Replacing a module in place (a new version under the same name) records the
// listing the new install names, and keeps the recorded one when the install
// names none, the way created_by is kept.
func TestReplacingAModuleUpdatesOrKeepsItsProvenance(t *testing.T) {
	svc := newProvenanceSvc(t)
	installCozy(t, svc, "cozy:1.0.0:abcdef0", ptr("cozy"), ptr(int32(1)))

	upgraded := installCozy(t, svc, "cozy:2.0.0:1234567", ptr("cozy-v2"), ptr(int32(2)))
	assertProvenance(t, "upgrade", upgraded, "cozy-v2", 2)

	rolledBack := installCozy(t, svc, "cozy:1.0.0:abcdef0", nil, nil)
	assertProvenance(t, "replace without provenance", rolledBack, "cozy-v2", 2)
}

// A later marketplace edition is a separate listing that installs under the
// same manifest id, and it may rename the module. It replaces the installed
// row, keyed by manifest id, rather than adding a second module beside it,
// and the row records the new listing and edition.
func TestALaterEditionReplacesTheModuleByManifestIDEvenWhenRenamed(t *testing.T) {
	svc := newProvenanceSvc(t)
	original := installCozy(t, svc, "cozy:1.0.0:abcdef0", ptr("cozy"), ptr(int32(1)))

	res, err := svc.CreateModule(context.Background(), &client.CreateModuleRequest{
		Name:                 "Cozy Alerts 2",
		ModuleId:             "cozy",
		Version:              "2.0.0",
		Manifest:             "{}",
		ModuleKey:            "cozy:2.0.0:1234567",
		CreatedByType:        "CLIENT",
		CreatedByRef:         "client-1",
		MarketplaceListingId: ptr("cozy-v2"),
		MarketplaceEdition:   ptr(int32(2)),
	})
	if err != nil {
		t.Fatalf("CreateModule edition 2: %v", err)
	}
	upgraded := res.Module
	if upgraded.Id != original.Id {
		t.Fatalf("edition 2 row id = %s, want the edition 1 row %s", upgraded.Id, original.Id)
	}
	if upgraded.Name != "Cozy Alerts 2" || upgraded.ModuleKey != "cozy:2.0.0:1234567" || upgraded.Version != "2.0.0" {
		t.Fatalf("edition 2 row = (%q, %q, %q), want the new name, key and version",
			upgraded.Name, upgraded.ModuleKey, upgraded.Version)
	}
	assertProvenance(t, "edition 2", upgraded, "cozy-v2", 2)

	listed, err := svc.ListModules(context.Background(), &client.ListModulesRequest{})
	if err != nil {
		t.Fatalf("ListModules: %v", err)
	}
	if len(listed.Modules) != 1 {
		t.Fatalf("ListModules returned %d modules, want 1", len(listed.Modules))
	}
}

func TestIncompleteMarketplaceProvenanceIsRefused(t *testing.T) {
	cases := []struct {
		name      string
		listingID *string
		edition   *int32
	}{
		{"listing without edition", ptr("cozy"), nil},
		{"edition without listing", nil, ptr(int32(1))},
		{"blank listing", ptr(""), ptr(int32(1))},
		{"edition zero", ptr("cozy"), ptr(int32(0))},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := newProvenanceSvc(t)
			_, err := svc.CreateModule(context.Background(), &client.CreateModuleRequest{
				Name:                 "Cozy",
				ModuleId:             "cozy",
				Version:              "1.0.0",
				ModuleKey:            "cozy:1.0.0:abcdef0",
				MarketplaceListingId: tc.listingID,
				MarketplaceEdition:   tc.edition,
			})
			twerr, ok := err.(twirp.Error)
			if !ok || twerr.Code() != twirp.InvalidArgument {
				t.Fatalf("CreateModule err = %v, want invalid_argument", err)
			}
		})
	}
}

// The fields cross the wire under their proto names: barkloader writes the
// install as Twirp JSON in snake_case, and the api reads modules back through
// the protobuf client.
func TestMarketplaceProvenanceCrossesTheTwirpBoundary(t *testing.T) {
	server := httptest.NewServer(client.NewModuleServiceServer(newProvenanceSvc(t)))
	defer server.Close()

	body := `{"name":"Cozy","module_id":"cozy","version":"1.0.0","module_key":"cozy:1.0.0:abcdef0",` +
		`"marketplace_listing_id":"cozy-v2","marketplace_edition":2}`
	res, err := http.Post(server.URL+"/twirp/module.ModuleService/CreateModule", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("CreateModule: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("CreateModule status = %d", res.StatusCode)
	}

	rpc := client.NewModuleServiceProtobufClient(server.URL, server.Client())
	got, err := rpc.GetModuleByModuleKey(context.Background(), &client.GetModuleByModuleKeyRequest{ModuleKey: "cozy:1.0.0:abcdef0"})
	if err != nil {
		t.Fatalf("GetModuleByModuleKey: %v", err)
	}
	assertProvenance(t, "protobuf client", got.Module, "cozy-v2", 2)
}
