package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

// groupChange is what happens to one workflow when a group that is on takes
// it (switched on, or the workflow added) or lets it go (switched off, the
// workflow removed, or the group deleted).
type groupChange int

const (
	groupHolds groupChange = iota + 1
	groupReleases
)

// errHeldStateBroken reports a workflow whose saved state disagrees with
// whether a group that is on contains it. The start-up invariant check
// repairs such rows; a group switch refuses to build on one.
var errHeldStateBroken = errors.New("saved pre-group state disagrees with the groups holding the workflow")

// nextState carries the whole alert group rule for one workflow. enabled and
// saved are its enabled and pre_group_enabled columns; heldElsewhere is
// whether a group other than the changing one contains it while on.
//
// A hold saves the workflow's own state only when no other group already
// holds it, so a later group never saves a state an earlier one forced, and
// then switches it on. A release puts the saved state back only when no
// other group still holds it; otherwise "on always wins" and nothing moves.
func nextState(change groupChange, enabled bool, saved *bool, heldElsewhere bool) (bool, *bool, error) {
	switch change {
	case groupHolds:
		if heldElsewhere != (saved != nil) {
			return enabled, saved, errHeldStateBroken
		}
		if !heldElsewhere {
			own := enabled
			saved = &own
		}
		return true, saved, nil
	case groupReleases:
		// The releasing group held the workflow until now.
		if saved == nil {
			return enabled, saved, errHeldStateBroken
		}
		if heldElsewhere {
			return enabled, saved, nil
		}
		return *saved, nil, nil
	}
	return enabled, saved, errors.New("unknown group change")
}

// manualState is a streamer switching a workflow on or off themselves. While
// a group holds it the switch also becomes the state restored later, so the
// manual choice wins once the groups let go.
func manualState(value bool, saved *bool) (bool, *bool) {
	if saved == nil {
		return value, nil
	}
	restored := value
	return value, &restored
}

// Limits match the workflow_groups columns.
const (
	workflowGroupNameMaxRunes        = 100
	workflowGroupDescriptionMaxRunes = 500
)

// workflowGroupService owns alert groups. Every change to a group's switch or
// membership, the member rows it moves, and the outbox events announcing both
// commit in one transaction.
type workflowGroupService struct {
	db        *gorm.DB
	publisher *workers.EventPublisher
}

func NewWorkflowGroupService(db *gorm.DB, publisher *workers.EventPublisher) (client.WorkflowGroupService, error) {
	if db == nil || publisher == nil {
		return nil, errors.New("workflow group service: db and publisher are required")
	}
	return &workflowGroupService{db: db, publisher: publisher}, nil
}

func okStatus(message string) *client.ResponseStatus {
	return &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: message}
}

func workflowGroupToProto(group *models.WorkflowGroup, memberIDs []uuid.UUID) *client.WorkflowGroup {
	return &client.WorkflowGroup{
		Id:          group.ID.String(),
		Name:        group.Name,
		Description: group.Description,
		Enabled:     group.Enabled,
		MemberIds:   uuidStrings(memberIDs),
	}
}

// workflowGroupChangeData is the snake_case payload of the
// `db.workflow_group.{created,updated,deleted}.system` outbox events. Must
// match the parser in api/src/workflow-group-event-handlers.ts.
type workflowGroupChangeData struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Enabled     bool     `json:"enabled"`
	MemberIDs   []string `json:"member_ids"`
}

func buildWorkflowGroupChangeData(group *models.WorkflowGroup, memberIDs []uuid.UUID) workflowGroupChangeData {
	return workflowGroupChangeData{
		ID:          group.ID.String(),
		Name:        group.Name,
		Description: group.Description,
		Enabled:     group.Enabled,
		MemberIDs:   uuidStrings(memberIDs),
	}
}

func uuidStrings(ids []uuid.UUID) []string {
	out := make([]string, len(ids))
	for i, id := range ids {
		out[i] = id.String()
	}
	return out
}

func parseGroupID(field, raw string) (uuid.UUID, error) {
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, twirp.InvalidArgumentError(field, "invalid UUID format")
	}
	return id, nil
}

// parseWorkflowIDs parses and de-duplicates the ids, keeping their order.
func parseWorkflowIDs(raw []string) ([]uuid.UUID, error) {
	if len(raw) == 0 {
		return nil, twirp.InvalidArgumentError("workflow_ids", "name at least one workflow")
	}
	seen := make(map[uuid.UUID]bool, len(raw))
	ids := make([]uuid.UUID, 0, len(raw))
	for _, value := range raw {
		id, err := uuid.Parse(value)
		if err != nil {
			return nil, twirp.InvalidArgumentError("workflow_ids", fmt.Sprintf("%q is not a UUID", value))
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	return ids, nil
}

func validGroupText(name, description string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", twirp.InvalidArgumentError("name", "a group needs a name")
	}
	if utf8.RuneCountInString(name) > workflowGroupNameMaxRunes {
		return "", twirp.InvalidArgumentError("name", fmt.Sprintf("at most %d characters", workflowGroupNameMaxRunes))
	}
	if utf8.RuneCountInString(description) > workflowGroupDescriptionMaxRunes {
		return "", twirp.InvalidArgumentError("description", fmt.Sprintf("at most %d characters", workflowGroupDescriptionMaxRunes))
	}
	return name, nil
}

// refuseTakenGroupName refuses a name another group already has. The unique
// constraint is the backstop for two writers racing past this check.
func refuseTakenGroupName(tx *gorm.DB, name string, self uuid.UUID) error {
	var taken int64
	if err := tx.Model(&models.WorkflowGroup{}).Where("name = ? AND id <> ?", name, self).Count(&taken).Error; err != nil {
		return twirp.InternalErrorWith(fmt.Errorf("check group name: %w", err))
	}
	if taken > 0 {
		return twirp.NewError(twirp.AlreadyExists, fmt.Sprintf("a group named %q already exists", name))
	}
	return nil
}

func lockGroup(groups *repo.WorkflowGroupRepository, id uuid.UUID) (*models.WorkflowGroup, error) {
	group, err := groups.LockByID(id)
	if err != nil {
		return nil, lookupError("workflow group", err)
	}
	return group, nil
}

// isCommandWorkflow matches assertNotCommandWorkflow in api/src/routes/workflows.ts:
// a workflow with a command trigger is run by its chat command, which owns it.
func isCommandWorkflow(wf *models.WorkflowDefinition) bool {
	var trigger struct {
		Type string `json:"type"`
	}
	return json.Unmarshal([]byte(wf.Trigger), &trigger) == nil && trigger.Type == commandTriggerType
}

// applyGroupChange holds or releases the workflows in workflowIDs on behalf of
// groupID, and returns the ids of those whose enabled switch moved. The rows
// are locked before the held state is read, so two changes sharing a member
// run one after the other and the later one sees what the earlier committed.
func (s *workflowGroupService) applyGroupChange(
	groups *repo.WorkflowGroupRepository,
	groupID uuid.UUID,
	workflowIDs []uuid.UUID,
	change groupChange,
) (map[uuid.UUID]bool, error) {
	moved := make(map[uuid.UUID]bool)
	rows, err := groups.LockWorkflows(workflowIDs)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("lock group members: %w", err))
	}
	if len(rows) != len(workflowIDs) {
		return nil, twirp.InternalErrorWith(fmt.Errorf("group %s: %d of %d members found", groupID, len(rows), len(workflowIDs)))
	}
	heldElsewhere, err := groups.HeldElsewhere(workflowIDs, groupID)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("read held members: %w", err))
	}
	for _, row := range rows {
		enabled, saved, err := nextState(change, row.Enabled, row.PreGroupEnabled, heldElsewhere[row.ID])
		if err != nil {
			return nil, twirp.InternalErrorWith(fmt.Errorf("workflow %s: %w", row.ID, err))
		}
		if enabled == row.Enabled && sameSavedState(saved, row.PreGroupEnabled) {
			continue
		}
		if enabled != row.Enabled {
			moved[row.ID] = true
		}
		row.Enabled, row.PreGroupEnabled = enabled, saved
		if err := groups.SaveHeldState(row); err != nil {
			return nil, twirp.InternalErrorWith(err)
		}
	}
	return moved, nil
}

func sameSavedState(a, b *bool) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

// publishMemberChanges announces `db.workflow.updated` for each workflow in
// ids, with the groups it now belongs to.
func (s *workflowGroupService) publishMemberChanges(tx *gorm.DB, groups *repo.WorkflowGroupRepository, ids []uuid.UUID) error {
	if len(ids) == 0 {
		return nil
	}
	var rows []*models.WorkflowDefinition
	if err := tx.Where("id IN ?", ids).Order("id ASC").Find(&rows).Error; err != nil {
		return twirp.InternalErrorWith(fmt.Errorf("read changed members: %w", err))
	}
	groupIDs, err := groups.GroupIDsByWorkflow(ids)
	if err != nil {
		return twirp.InternalErrorWith(fmt.Errorf("read groups of changed members: %w", err))
	}
	for _, row := range rows {
		data := buildWorkflowChangeData(row)
		data["group_ids"] = uuidStrings(groupIDs[row.ID])
		if err := s.publisher.PublishIn(tx, workers.PublishOptions{
			EntityType:      "workflow",
			EntityID:        row.ID.String(),
			Operation:       "updated",
			Data:            data,
			AutoAcknowledge: true,
		}); err != nil {
			return twirp.InternalErrorWith(fmt.Errorf("announce workflow %s: %w", row.ID, err))
		}
	}
	return nil
}

func (s *workflowGroupService) publishGroup(tx *gorm.DB, operation string, group *models.WorkflowGroup, memberIDs []uuid.UUID) error {
	if err := s.publisher.PublishIn(tx, workers.PublishOptions{
		EntityType:      "workflow_group",
		EntityID:        group.ID.String(),
		Operation:       operation,
		Data:            buildWorkflowGroupChangeData(group, memberIDs),
		AutoAcknowledge: true,
	}); err != nil {
		return twirp.InternalErrorWith(fmt.Errorf("announce workflow group %s: %w", group.ID, err))
	}
	return nil
}

func sortedIDs(set map[uuid.UUID]bool) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(set))
	for id := range set {
		ids = append(ids, id)
	}
	slices.SortFunc(ids, func(a, b uuid.UUID) int { return strings.Compare(a.String(), b.String()) })
	return ids
}

func (s *workflowGroupService) ListWorkflowGroups(ctx context.Context, req *client.ListWorkflowGroupsRequest) (*client.ListWorkflowGroupsResponse, error) {
	groups := repo.NewWorkflowGroupRepository(s.db)
	rows, err := groups.List()
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("list workflow groups: %w", err))
	}
	members, err := groups.MemberIDsByGroup()
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("list workflow group members: %w", err))
	}
	out := make([]*client.WorkflowGroup, len(rows))
	for i := range rows {
		out[i] = workflowGroupToProto(&rows[i], members[rows[i].ID])
	}
	return &client.ListWorkflowGroupsResponse{Status: okStatus("Workflow groups retrieved"), Groups: out}, nil
}

func (s *workflowGroupService) CreateWorkflowGroup(ctx context.Context, req *client.CreateWorkflowGroupRequest) (*client.CreateWorkflowGroupResponse, error) {
	name, err := validGroupText(req.Name, req.Description)
	if err != nil {
		return nil, err
	}
	group := &models.WorkflowGroup{Name: name, Description: req.Description}
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := refuseTakenGroupName(tx, name, uuid.Nil); err != nil {
			return err
		}
		if err := repo.NewWorkflowGroupRepository(tx).Create(group); err != nil {
			return twirp.InternalErrorWith(fmt.Errorf("create workflow group: %w", err))
		}
		return s.publishGroup(tx, "created", group, nil)
	})
	if err != nil {
		return nil, err
	}
	return &client.CreateWorkflowGroupResponse{Status: okStatus("Workflow group created"), Group: workflowGroupToProto(group, nil)}, nil
}

func (s *workflowGroupService) UpdateWorkflowGroup(ctx context.Context, req *client.UpdateWorkflowGroupRequest) (*client.UpdateWorkflowGroupResponse, error) {
	id, err := parseGroupID("id", req.Id)
	if err != nil {
		return nil, err
	}
	name, err := validGroupText(req.Name, req.Description)
	if err != nil {
		return nil, err
	}
	var out *client.WorkflowGroup
	err = s.db.Transaction(func(tx *gorm.DB) error {
		groups := repo.NewWorkflowGroupRepository(tx)
		group, err := lockGroup(groups, id)
		if err != nil {
			return err
		}
		if err := refuseTakenGroupName(tx, name, id); err != nil {
			return err
		}
		group.Name, group.Description = name, req.Description
		if err := groups.Update(group); err != nil {
			return twirp.InternalErrorWith(fmt.Errorf("update workflow group %s: %w", id, err))
		}
		members, err := groups.MemberIDs(id)
		if err != nil {
			return twirp.InternalErrorWith(fmt.Errorf("list members of group %s: %w", id, err))
		}
		out = workflowGroupToProto(group, members)
		return s.publishGroup(tx, "updated", group, members)
	})
	if err != nil {
		return nil, err
	}
	return &client.UpdateWorkflowGroupResponse{Status: okStatus("Workflow group updated"), Group: out}, nil
}

func (s *workflowGroupService) DeleteWorkflowGroup(ctx context.Context, req *client.DeleteWorkflowGroupRequest) (*client.DeleteWorkflowGroupResponse, error) {
	id, err := parseGroupID("id", req.Id)
	if err != nil {
		return nil, err
	}
	err = s.db.Transaction(func(tx *gorm.DB) error {
		groups := repo.NewWorkflowGroupRepository(tx)
		group, err := lockGroup(groups, id)
		if err != nil {
			return err
		}
		members, err := groups.MemberIDs(id)
		if err != nil {
			return twirp.InternalErrorWith(fmt.Errorf("list members of group %s: %w", id, err))
		}
		// A group that is on lets go of its members exactly as switching it
		// off would, before its memberships go.
		if group.Enabled {
			if _, err := s.applyGroupChange(groups, id, members, groupReleases); err != nil {
				return err
			}
		}
		if err := groups.Delete(id); err != nil {
			return twirp.InternalErrorWith(fmt.Errorf("delete workflow group %s: %w", id, err))
		}
		// Every member's group list changed, whether or not its switch moved.
		if err := s.publishMemberChanges(tx, groups, members); err != nil {
			return err
		}
		return s.publishGroup(tx, "deleted", group, members)
	})
	if err != nil {
		return nil, err
	}
	return &client.DeleteWorkflowGroupResponse{Status: okStatus("Workflow group deleted")}, nil
}

func (s *workflowGroupService) SetWorkflowGroupEnabled(ctx context.Context, req *client.SetWorkflowGroupEnabledRequest) (*client.SetWorkflowGroupEnabledResponse, error) {
	id, err := parseGroupID("id", req.Id)
	if err != nil {
		return nil, err
	}
	var out *client.WorkflowGroup
	err = s.db.Transaction(func(tx *gorm.DB) error {
		groups := repo.NewWorkflowGroupRepository(tx)
		group, err := lockGroup(groups, id)
		if err != nil {
			return err
		}
		members, err := groups.MemberIDs(id)
		if err != nil {
			return twirp.InternalErrorWith(fmt.Errorf("list members of group %s: %w", id, err))
		}
		out = workflowGroupToProto(group, members)
		if group.Enabled == req.Enabled {
			return nil
		}
		change := groupReleases
		if req.Enabled {
			change = groupHolds
		}
		moved, err := s.applyGroupChange(groups, id, members, change)
		if err != nil {
			return err
		}
		group.Enabled = req.Enabled
		if err := groups.Update(group); err != nil {
			return twirp.InternalErrorWith(fmt.Errorf("switch workflow group %s: %w", id, err))
		}
		out.Enabled = group.Enabled
		if err := s.publishMemberChanges(tx, groups, sortedIDs(moved)); err != nil {
			return err
		}
		return s.publishGroup(tx, "updated", group, members)
	})
	if err != nil {
		return nil, err
	}
	return &client.SetWorkflowGroupEnabledResponse{Status: okStatus("Workflow group switched"), Group: out}, nil
}

func (s *workflowGroupService) AddWorkflowGroupMembers(ctx context.Context, req *client.AddWorkflowGroupMembersRequest) (*client.AddWorkflowGroupMembersResponse, error) {
	id, err := parseGroupID("group_id", req.GroupId)
	if err != nil {
		return nil, err
	}
	workflowIDs, err := parseWorkflowIDs(req.WorkflowIds)
	if err != nil {
		return nil, err
	}
	var out *client.WorkflowGroup
	err = s.db.Transaction(func(tx *gorm.DB) error {
		groups := repo.NewWorkflowGroupRepository(tx)
		group, err := lockGroup(groups, id)
		if err != nil {
			return err
		}
		var found []*models.WorkflowDefinition
		if err := tx.Where("id IN ?", workflowIDs).Find(&found).Error; err != nil {
			return twirp.InternalErrorWith(fmt.Errorf("read workflows to add: %w", err))
		}
		if len(found) != len(workflowIDs) {
			return twirp.NotFoundError("workflow not found")
		}
		for _, wf := range found {
			if isCommandWorkflow(wf) {
				return twirp.NewError(twirp.FailedPrecondition,
					fmt.Sprintf("workflow %s runs a chat command and cannot join a group", wf.ID))
			}
		}
		before, err := groups.MemberIDs(id)
		if err != nil {
			return twirp.InternalErrorWith(fmt.Errorf("list members of group %s: %w", id, err))
		}
		added := []uuid.UUID{}
		for _, wfID := range workflowIDs {
			if !slices.Contains(before, wfID) {
				added = append(added, wfID)
			}
		}
		if len(added) > 0 {
			// Held before joining, so the new member is held by this group
			// only once the hold has been worked out.
			if group.Enabled {
				if _, err := s.applyGroupChange(groups, id, added, groupHolds); err != nil {
					return err
				}
			}
			if err := groups.AddMembers(id, added); err != nil {
				return twirp.InternalErrorWith(fmt.Errorf("add members to group %s: %w", id, err))
			}
		}
		members, err := groups.MemberIDs(id)
		if err != nil {
			return twirp.InternalErrorWith(fmt.Errorf("list members of group %s: %w", id, err))
		}
		out = workflowGroupToProto(group, members)
		if len(added) == 0 {
			return nil
		}
		if err := s.publishMemberChanges(tx, groups, added); err != nil {
			return err
		}
		return s.publishGroup(tx, "updated", group, members)
	})
	if err != nil {
		return nil, err
	}
	return &client.AddWorkflowGroupMembersResponse{Status: okStatus("Workflows added to group"), Group: out}, nil
}

func (s *workflowGroupService) RemoveWorkflowGroupMembers(ctx context.Context, req *client.RemoveWorkflowGroupMembersRequest) (*client.RemoveWorkflowGroupMembersResponse, error) {
	id, err := parseGroupID("group_id", req.GroupId)
	if err != nil {
		return nil, err
	}
	workflowIDs, err := parseWorkflowIDs(req.WorkflowIds)
	if err != nil {
		return nil, err
	}
	var out *client.WorkflowGroup
	err = s.db.Transaction(func(tx *gorm.DB) error {
		groups := repo.NewWorkflowGroupRepository(tx)
		group, err := lockGroup(groups, id)
		if err != nil {
			return err
		}
		before, err := groups.MemberIDs(id)
		if err != nil {
			return twirp.InternalErrorWith(fmt.Errorf("list members of group %s: %w", id, err))
		}
		removed := []uuid.UUID{}
		for _, wfID := range workflowIDs {
			if slices.Contains(before, wfID) {
				removed = append(removed, wfID)
			}
		}
		if len(removed) > 0 {
			if group.Enabled {
				if _, err := s.applyGroupChange(groups, id, removed, groupReleases); err != nil {
					return err
				}
			}
			if err := groups.RemoveMembers(id, removed); err != nil {
				return twirp.InternalErrorWith(fmt.Errorf("remove members from group %s: %w", id, err))
			}
		}
		members, err := groups.MemberIDs(id)
		if err != nil {
			return twirp.InternalErrorWith(fmt.Errorf("list members of group %s: %w", id, err))
		}
		out = workflowGroupToProto(group, members)
		if len(removed) == 0 {
			return nil
		}
		if err := s.publishMemberChanges(tx, groups, removed); err != nil {
			return err
		}
		return s.publishGroup(tx, "updated", group, members)
	})
	if err != nil {
		return nil, err
	}
	return &client.RemoveWorkflowGroupMembersResponse{Status: okStatus("Workflows removed from group"), Group: out}, nil
}
