package services

import (
	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
)

// SeedBuiltInGroups ensures every group in models.BuiltInGroups exists. It is
// idempotent, so db-proxy runs it on every start and it is safe against a
// database whose migrations already inserted some or all of the catalog.
//
// A group that already exists under a built-in name is promoted rather than
// duplicated: an operator who hand-made a "moderator" group before upgrading
// keeps its membership and simply gains built-in protection. Promoting is the
// only correct option anyway - group names are unique, so inserting a second
// one is impossible.
func SeedBuiltInGroups(groupRepo *repo.GroupRepository) error {
	existing, err := groupRepo.List()
	if err != nil {
		return err
	}
	byName := make(map[string]*models.Group, len(existing))
	for i := range existing {
		byName[existing[i].Name] = &existing[i]
	}

	for _, builtIn := range models.BuiltInGroups {
		if current, ok := byName[builtIn.Name]; ok {
			if current.IsBuiltIn {
				continue
			}
			current.IsBuiltIn = true
			if err := groupRepo.Update(current); err != nil {
				return err
			}
			continue
		}

		group := models.Group{
			ID:          uuid.New(),
			Name:        builtIn.Name,
			Description: builtIn.Description,
			IsBuiltIn:   true,
		}
		if err := groupRepo.Create(&group); err != nil {
			return err
		}
	}

	return nil
}
