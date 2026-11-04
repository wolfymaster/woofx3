package repository

import (
	"fmt"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// WorkflowGroupRepository holds workflow groups, their memberships, and the
// two workflow columns a group switch writes (enabled, pre_group_enabled).
// The hold and release rules live in the service; this layer only reads and
// writes rows, and every method is meant to run inside the caller's
// transaction: build one per transaction with NewWorkflowGroupRepository(tx).
type WorkflowGroupRepository struct {
	db *gorm.DB
}

func NewWorkflowGroupRepository(db *gorm.DB) *WorkflowGroupRepository {
	return &WorkflowGroupRepository{db: db}
}

func (r *WorkflowGroupRepository) Create(group *models.WorkflowGroup) error {
	return r.db.Create(group).Error
}

func (r *WorkflowGroupRepository) Update(group *models.WorkflowGroup) error {
	return r.db.Save(group).Error
}

// Delete removes the group and its memberships. The memberships go
// explicitly rather than by the foreign key's cascade, which SQLite applies
// only on a connection that enabled it.
func (r *WorkflowGroupRepository) Delete(groupID uuid.UUID) error {
	if err := r.db.Where("group_id = ?", groupID).Delete(&models.WorkflowGroupMember{}).Error; err != nil {
		return fmt.Errorf("delete memberships of group %s: %w", groupID, err)
	}
	return r.db.Where("id = ?", groupID).Delete(&models.WorkflowGroup{}).Error
}

func (r *WorkflowGroupRepository) GetByID(id uuid.UUID) (*models.WorkflowGroup, error) {
	var group models.WorkflowGroup
	err := r.db.Where("id = ?", id).First(&group).Error
	return &group, err
}

// LockByID reads the group and, on Postgres, holds its row until the
// transaction ends, so every change to one group's switch or membership runs
// one after another. SQLite has a single writer and needs no row lock.
func (r *WorkflowGroupRepository) LockByID(id uuid.UUID) (*models.WorkflowGroup, error) {
	var group models.WorkflowGroup
	err := r.db.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).First(&group).Error
	return &group, err
}

func (r *WorkflowGroupRepository) List() ([]models.WorkflowGroup, error) {
	var groups []models.WorkflowGroup
	err := r.db.Order("name ASC").Find(&groups).Error
	return groups, err
}

// MemberIDs returns the workflows in groupID, ordered by id.
func (r *WorkflowGroupRepository) MemberIDs(groupID uuid.UUID) ([]uuid.UUID, error) {
	ids := []uuid.UUID{}
	err := r.db.Model(&models.WorkflowGroupMember{}).
		Where("group_id = ?", groupID).
		Order("workflow_id ASC").
		Pluck("workflow_id", &ids).Error
	return ids, err
}

// AddMembers records that each workflow belongs to groupID. A membership
// that already exists is left as it is.
func (r *WorkflowGroupRepository) AddMembers(groupID uuid.UUID, workflowIDs []uuid.UUID) error {
	if len(workflowIDs) == 0 {
		return nil
	}
	rows := make([]models.WorkflowGroupMember, len(workflowIDs))
	for i, id := range workflowIDs {
		rows[i] = models.WorkflowGroupMember{GroupID: groupID, WorkflowID: id}
	}
	return r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&rows).Error
}

// RemoveMembers deletes the memberships of the given workflows in groupID,
// where present.
func (r *WorkflowGroupRepository) RemoveMembers(groupID uuid.UUID, workflowIDs []uuid.UUID) error {
	if len(workflowIDs) == 0 {
		return nil
	}
	return r.db.Where("group_id = ? AND workflow_id IN ?", groupID, workflowIDs).
		Delete(&models.WorkflowGroupMember{}).Error
}

// GroupIDsByWorkflow returns, for each workflow in workflowIDs, the groups it
// belongs to, ordered by id. A workflow in no group is absent from the map.
// A nil workflowIDs reads every membership.
func (r *WorkflowGroupRepository) GroupIDsByWorkflow(workflowIDs []uuid.UUID) (map[uuid.UUID][]uuid.UUID, error) {
	query := r.db.Model(&models.WorkflowGroupMember{})
	if workflowIDs != nil {
		if len(workflowIDs) == 0 {
			return map[uuid.UUID][]uuid.UUID{}, nil
		}
		query = query.Where("workflow_id IN ?", workflowIDs)
	}
	var rows []models.WorkflowGroupMember
	if err := query.Order("workflow_id ASC, group_id ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	byWorkflow := make(map[uuid.UUID][]uuid.UUID)
	for _, row := range rows {
		byWorkflow[row.WorkflowID] = append(byWorkflow[row.WorkflowID], row.GroupID)
	}
	return byWorkflow, nil
}

// MemberIDsByGroup returns every group's members, ordered by id. A group with
// no members is absent from the map.
func (r *WorkflowGroupRepository) MemberIDsByGroup() (map[uuid.UUID][]uuid.UUID, error) {
	var rows []models.WorkflowGroupMember
	if err := r.db.Order("group_id ASC, workflow_id ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	byGroup := make(map[uuid.UUID][]uuid.UUID)
	for _, row := range rows {
		byGroup[row.GroupID] = append(byGroup[row.GroupID], row.WorkflowID)
	}
	return byGroup, nil
}

// HeldElsewhere returns which of workflowIDs some group other than
// exceptGroupID contains while switched on. Pass uuid.Nil to count every group.
func (r *WorkflowGroupRepository) HeldElsewhere(workflowIDs []uuid.UUID, exceptGroupID uuid.UUID) (map[uuid.UUID]bool, error) {
	held := make(map[uuid.UUID]bool)
	if len(workflowIDs) == 0 {
		return held, nil
	}
	ids := []uuid.UUID{}
	err := r.db.Model(&models.WorkflowGroupMember{}).
		Joins("JOIN workflow_groups ON workflow_groups.id = workflow_group_members.group_id").
		Where("workflow_groups.enabled = ? AND workflow_groups.id <> ? AND workflow_group_members.workflow_id IN ?",
			true, exceptGroupID, workflowIDs).
		Distinct().
		Pluck("workflow_group_members.workflow_id", &ids).Error
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		held[id] = true
	}
	return held, nil
}

// HeldWorkflowIDs returns every workflow some switched-on group contains.
func (r *WorkflowGroupRepository) HeldWorkflowIDs() (map[uuid.UUID]bool, error) {
	ids := []uuid.UUID{}
	err := r.db.Model(&models.WorkflowGroupMember{}).
		Joins("JOIN workflow_groups ON workflow_groups.id = workflow_group_members.group_id").
		Where("workflow_groups.enabled = ?", true).
		Distinct().
		Pluck("workflow_group_members.workflow_id", &ids).Error
	if err != nil {
		return nil, err
	}
	held := make(map[uuid.UUID]bool, len(ids))
	for _, id := range ids {
		held[id] = true
	}
	return held, nil
}

// LockWorkflows reads the workflows in workflowIDs, ordered by id, and on
// Postgres holds their rows until the transaction ends. Two group switches
// sharing a member therefore run one after the other, and the second reads
// the held state the first committed. Locking in id order keeps two of them
// from deadlocking.
func (r *WorkflowGroupRepository) LockWorkflows(workflowIDs []uuid.UUID) ([]*models.WorkflowDefinition, error) {
	rows := []*models.WorkflowDefinition{}
	if len(workflowIDs) == 0 {
		return rows, nil
	}
	err := r.db.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id IN ?", workflowIDs).
		Order("id ASC").
		Find(&rows).Error
	return rows, err
}

// SaveHeldState writes a workflow's enabled and pre_group_enabled columns and
// nothing else, so a group switch never overwrites steps an editor saved.
func (r *WorkflowGroupRepository) SaveHeldState(wf *models.WorkflowDefinition) error {
	now := r.db.NowFunc()
	result := r.db.Model(&models.WorkflowDefinition{}).
		Where("id = ?", wf.ID).
		Updates(map[string]any{
			"enabled":           wf.Enabled,
			"pre_group_enabled": wf.PreGroupEnabled,
			"updated_at":        now,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("save held state of workflow %s: %w", wf.ID, gorm.ErrRecordNotFound)
	}
	wf.UpdatedAt = now
	return nil
}
