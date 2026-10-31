package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

// A streamer's workflows that start on the same event under the same conditions
// are one trigger, so they are stored as one workflow with one list of steps.
// Merging is what makes that list run strictly top to bottom: a failure or wait
// holds every later step, which separate ordered workflows do not do. Paused
// workflows and modules' workflows are never merged, because merging would change
// what is switched on, or let a module's upgrade or uninstall touch the streamer's
// steps.

// errNotMergeable marks a workflow whose steps can't be appended to as one list.
var errNotMergeable = errors.New("steps do not read as one list")

// mergeTriggerFields are the trigger fields a merge knows how to combine. A trigger
// with any other field means something merging could lose, so it stays apart.
var mergeTriggerFields = []string{"$ref", "type", "event", "conditions", "order"}

// triggerIdentity is what makes two triggers the same trigger: the event and the
// set of conditions, in any order. Must match conditionsKey in the UI's
// client/src/lib/alert-triggers.ts. ok is false for a trigger that can't merge.
func triggerIdentity(triggerJSON string) (identity string, ok bool) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal([]byte(triggerJSON), &fields); err != nil {
		return "", false
	}
	for field := range fields {
		if !slices.Contains(mergeTriggerFields, field) {
			return "", false
		}
	}
	var trigger struct {
		Type       string           `json:"type"`
		Event      string           `json:"event"`
		Conditions []map[string]any `json:"conditions"`
	}
	if err := json.Unmarshal([]byte(triggerJSON), &trigger); err != nil {
		return "", false
	}
	if trigger.Type != eventTriggerType || trigger.Event == "" {
		return "", false
	}
	conditions := make([]string, 0, len(trigger.Conditions))
	for _, condition := range trigger.Conditions {
		// Marshalling a map sorts its keys, which makes the text comparable.
		written, err := json.Marshal(condition)
		if err != nil {
			return "", false
		}
		conditions = append(conditions, string(written))
	}
	sort.Strings(conditions)
	return trigger.Event + "\x00" + strings.Join(slices.Compact(conditions), "\x00"), true
}

// runOrderLess orders workflows as the engine runs them: ordered ones first,
// lowest order first, then the rest oldest first.
func runOrderLess(a, b *models.WorkflowDefinition) bool {
	orderA, orderB := workflowOrder(a), workflowOrder(b)
	switch {
	case orderA != nil && orderB != nil && *orderA != *orderB:
		return *orderA < *orderB
	case (orderA == nil) != (orderB == nil):
		return orderA != nil
	case !a.CreatedAt.Equal(b.CreatedAt):
		return a.CreatedAt.Before(b.CreatedAt)
	}
	return a.ID.String() < b.ID.String()
}

func workflowOrder(wf *models.WorkflowDefinition) *int {
	var trigger storedTrigger
	if err := json.Unmarshal([]byte(wf.Trigger), &trigger); err != nil {
		return nil
	}
	return trigger.Order
}

type mergeTask = map[string]any

func decodeMergeTasks(stepsJSON string) ([]mergeTask, error) {
	decoder := json.NewDecoder(strings.NewReader(stepsJSON))
	// Keeps numbers as written, since these tasks are written straight back.
	decoder.UseNumber()
	var tasks []mergeTask
	if err := decoder.Decode(&tasks); err != nil {
		return nil, fmt.Errorf("read steps: %w", err)
	}
	return tasks, nil
}

func stringList(value any) []string {
	items, _ := value.([]any)
	list := make([]string, 0, len(items))
	for _, item := range items {
		if text, ok := item.(string); ok {
			list = append(list, text)
		}
	}
	return list
}

func taskID(task mergeTask) string {
	id, _ := task["id"].(string)
	return id
}

// topLevelEnds returns the first and last tasks of the list outside any condition's
// branches, or errNotMergeable when those tasks aren't a single chain, since there
// would be no one place to attach the next workflow's steps.
func topLevelEnds(tasks []mergeTask) (first, last mergeTask, err error) {
	inBranch := map[string]bool{}
	for _, task := range tasks {
		for _, id := range append(stringList(task["onTrue"]), stringList(task["onFalse"])...) {
			inBranch[id] = true
		}
	}
	dependedOn := map[string]bool{}
	for _, task := range tasks {
		if inBranch[taskID(task)] {
			continue
		}
		depends := stringList(task["dependsOn"])
		if len(depends) > 1 {
			return nil, nil, errNotMergeable
		}
		if len(depends) == 0 {
			if first != nil {
				return nil, nil, errNotMergeable
			}
			first = task
			continue
		}
		dependedOn[depends[0]] = true
	}
	for _, task := range tasks {
		if inBranch[taskID(task)] || dependedOn[taskID(task)] {
			continue
		}
		if last != nil {
			return nil, nil, errNotMergeable
		}
		last = task
	}
	if first == nil || last == nil {
		return nil, nil, errNotMergeable
	}
	return first, last, nil
}

var expressionPattern = regexp.MustCompile(`\$\{[^{}]*\}`)

// renameReferences rewrites step ids inside every `${...}` expression under value.
// An id after a dot (`trigger.data.step_1`) is a field name, not a step.
func renameReferences(value any, renames map[string]string) any {
	switch typed := value.(type) {
	case string:
		return expressionPattern.ReplaceAllStringFunc(typed, func(expression string) string {
			for from, to := range renames {
				pattern := regexp.MustCompile(`(^|[^.\w-])` + regexp.QuoteMeta(from) + `($|[^\w-])`)
				expression = pattern.ReplaceAllString(expression, "${1}"+to+"${2}")
			}
			return expression
		})
	case []any:
		for index, item := range typed {
			typed[index] = renameReferences(item, renames)
		}
		return typed
	case map[string]any:
		for key, item := range typed {
			typed[key] = renameReferences(item, renames)
		}
		return typed
	}
	return value
}

// appendTasks adds next's tasks after merged's so they start once merged's finish,
// renaming any step id already taken, along with everything pointing at it.
func appendTasks(merged, next []mergeTask) ([]mergeTask, error) {
	if len(next) == 0 {
		return merged, nil
	}
	first, _, err := topLevelEnds(next)
	if err != nil {
		return nil, err
	}
	var last mergeTask
	if len(merged) > 0 {
		if _, last, err = topLevelEnds(merged); err != nil {
			return nil, err
		}
	}

	taken := map[string]bool{}
	exported := map[string]bool{}
	for _, task := range merged {
		taken[taskID(task)] = true
		for name := range exportsOf(task) {
			exported[name] = true
		}
	}
	for _, task := range next {
		for name := range exportsOf(task) {
			if exported[name] {
				return nil, fmt.Errorf("%w: both export %q", errNotMergeable, name)
			}
		}
	}

	renames := map[string]string{}
	for _, task := range next {
		id := taskID(task)
		if !taken[id] {
			continue
		}
		candidate := ""
		for suffix := 2; candidate == "" || taken[candidate]; suffix++ {
			candidate = id + "_" + strconv.Itoa(suffix)
		}
		renames[id] = candidate
		taken[candidate] = true
	}
	renamed := func(id string) string {
		if to, ok := renames[id]; ok {
			return to
		}
		return id
	}
	for _, task := range next {
		id := taskID(task)
		for key, value := range task {
			switch key {
			case "id":
			case "dependsOn", "onTrue", "onFalse":
				items := stringList(value)
				list := make([]any, 0, len(items))
				for _, item := range items {
					list = append(list, renamed(item))
				}
				task[key] = list
			default:
				task[key] = renameReferences(value, renames)
			}
		}
		task["id"] = renamed(id)
	}
	if last != nil {
		first["dependsOn"] = []any{taskID(last)}
	}
	return append(merged, next...), nil
}

func exportsOf(task mergeTask) map[string]any {
	exports, _ := task["exports"].(map[string]any)
	return exports
}

// mergedTrigger is the first member's trigger holding the lowest order among them,
// so the merged workflow keeps the earliest place any of them had.
func mergedTrigger(members []*models.WorkflowDefinition) (string, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal([]byte(members[0].Trigger), &fields); err != nil {
		return "", fmt.Errorf("read trigger: %w", err)
	}
	if order := workflowOrder(members[0]); order != nil {
		written, err := json.Marshal(*order)
		if err != nil {
			return "", fmt.Errorf("write trigger order: %w", err)
		}
		fields["order"] = written
	}
	written, err := json.Marshal(fields)
	if err != nil {
		return "", fmt.Errorf("write trigger: %w", err)
	}
	return string(written), nil
}

// mergedAway is what mergeSameTrigger removed, for updating what follows it.
type mergedAway struct {
	survivor *models.WorkflowDefinition
	absorbed []*models.WorkflowDefinition
}

// isMergeCandidate reports whether wf is a switched-on workflow of the streamer's.
func isMergeCandidate(wf *models.WorkflowDefinition) bool {
	return wf.Enabled && wf.CreatedByType == "USER" && wf.ManifestID == ""
}

// mergeSameTrigger folds the other workflows sharing survivorID's trigger into it,
// in one transaction, so no step is lost or doubled however it ends. The survivor
// keeps its id, which is what the caller saving it is holding. Returns nil when
// there is nothing to merge.
//
// A workflow stays apart while anything still needs it by id: a run in flight
// resumes against its own definition, and another workflow or a command may call it.
func (s *workflowService) mergeSameTrigger(survivorID uuid.UUID) (*mergedAway, error) {
	var result *mergedAway
	err := s.executionRepo.Transaction(func(tx *gorm.DB) error {
		var rows []*models.WorkflowDefinition
		if err := tx.Find(&rows).Error; err != nil {
			return fmt.Errorf("list workflows: %w", err)
		}
		var survivor *models.WorkflowDefinition
		for _, row := range rows {
			if row.ID == survivorID {
				survivor = row
			}
		}
		if survivor == nil || !isMergeCandidate(survivor) {
			return nil
		}
		identity, ok := triggerIdentity(survivor.Trigger)
		if !ok {
			return nil
		}

		members := []*models.WorkflowDefinition{survivor}
		for _, row := range rows {
			if row.ID == survivorID || !isMergeCandidate(row) {
				continue
			}
			if other, ok := triggerIdentity(row.Trigger); !ok || other != identity {
				continue
			}
			needed, err := neededById(tx, row, rows)
			if err != nil {
				return err
			}
			if needed {
				log.Printf("workflow_service: leaving workflow %s unmerged: still needed by id", row.ID)
				continue
			}
			members = append(members, row)
		}
		if len(members) < 2 {
			return nil
		}
		sort.SliceStable(members, func(i, j int) bool { return runOrderLess(members[i], members[j]) })

		var steps []mergeTask
		for _, member := range members {
			tasks, err := decodeMergeTasks(member.Steps)
			if err != nil {
				return fmt.Errorf("workflow %s: %w", member.ID, err)
			}
			if steps, err = appendTasks(steps, tasks); err != nil {
				return fmt.Errorf("workflow %s: %w", member.ID, err)
			}
		}
		written, err := json.Marshal(steps)
		if err != nil {
			return fmt.Errorf("write merged steps: %w", err)
		}
		trigger, err := mergedTrigger(members)
		if err != nil {
			return err
		}
		survivor.Steps = string(written)
		survivor.Trigger = trigger
		baseRevision := survivor.Revision
		survivor.Revision = baseRevision + 1
		if err := survivor.UpdateAtRevision(tx, baseRevision); err != nil {
			return fmt.Errorf("save merged workflow: %w", err)
		}

		absorbed := make([]*models.WorkflowDefinition, 0, len(members)-1)
		for _, member := range members {
			if member.ID == survivorID {
				continue
			}
			// Deleting the row cascades to its runs, so they move first.
			if err := tx.Model(&models.WorkflowExecution{}).Where("workflow_id = ?", member.ID).
				Update("workflow_id", survivorID).Error; err != nil {
				return fmt.Errorf("move runs of workflow %s: %w", member.ID, err)
			}
			if err := tx.Model(&models.Alert{}).Where("workflow_id = ?", member.ID).
				Update("workflow_id", survivorID).Error; err != nil {
				return fmt.Errorf("move alerts of workflow %s: %w", member.ID, err)
			}
			deleted := tx.Delete(member)
			if deleted.Error != nil {
				return fmt.Errorf("delete merged workflow %s: %w", member.ID, deleted.Error)
			}
			if deleted.RowsAffected != 1 {
				return fmt.Errorf("delete merged workflow %s: another writer got there first", member.ID)
			}
			absorbed = append(absorbed, member)
		}

		if s.publisher != nil {
			// The deletions go first: if the engine acts between the two events it
			// runs the survivor's old steps once, where the other order would run
			// the merged-away steps twice.
			for _, member := range absorbed {
				if err := s.publisher.PublishIn(tx, workers.PublishOptions{
					EntityType:      "workflow",
					EntityID:        member.ID.String(),
					Operation:       "deleted",
					Data:            map[string]any{"id": member.ID.String(), "merged_into": survivorID.String()},
					AutoAcknowledge: true,
				}); err != nil {
					return fmt.Errorf("announce merged workflow %s: %w", member.ID, err)
				}
			}
			if err := s.publisher.PublishIn(tx, workers.PublishOptions{
				EntityType:      "workflow",
				EntityID:        survivorID.String(),
				Operation:       "updated",
				Data:            buildWorkflowChangeData(survivor),
				AutoAcknowledge: true,
			}); err != nil {
				return fmt.Errorf("announce merged workflow %s: %w", survivorID, err)
			}
		}
		result = &mergedAway{survivor: survivor, absorbed: absorbed}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if result != nil {
		s.syncWorkflowEdges(result.survivor, result.survivor.CreatedByType, result.survivor.CreatedByRef)
		for _, member := range result.absorbed {
			if s.refRepo == nil {
				break
			}
			if err := s.refRepo.DeleteEdgesBySource("workflow", member.ID); err != nil {
				log.Printf("workflow_service: DeleteEdgesBySource failed for merged workflow %s: %v", member.ID, err)
			}
		}
	}
	return result, nil
}

// neededById reports whether wf has a run in flight, or whether another workflow's
// steps or a command's actions name it.
func neededById(tx *gorm.DB, wf *models.WorkflowDefinition, rows []*models.WorkflowDefinition) (bool, error) {
	var active int64
	if err := tx.Model(&models.WorkflowExecution{}).
		Where("workflow_id = ? AND status NOT IN ?", wf.ID, models.TerminalWorkflowStatuses()).
		Count(&active).Error; err != nil {
		return false, fmt.Errorf("count runs of workflow %s: %w", wf.ID, err)
	}
	if active > 0 {
		return true, nil
	}
	id := wf.ID.String()
	for _, row := range rows {
		if row.ID != wf.ID && strings.Contains(row.Steps, id) {
			return true, nil
		}
	}
	var commands int64
	if err := tx.Model(&models.Command{}).Where("CAST(actions AS TEXT) LIKE ?", "%"+id+"%").
		Count(&commands).Error; err != nil {
		return false, fmt.Errorf("find commands naming workflow %s: %w", wf.ID, err)
	}
	return commands > 0, nil
}

// MergeOwnWorkflows merges every set of switched-on workflows sharing a trigger.
// db-proxy runs it on every start, so a database from before merging is converted
// where the outbox can announce it, and a set left apart because a run was in
// flight is tried again. A set that fails stays as it was and doesn't stop the rest.
func MergeOwnWorkflows(
	workflowRepo *repo.WorkflowRepository,
	db *gorm.DB,
	publisher *workers.EventPublisher,
	refRepo *repo.ResourceReferenceRepository,
) (merged int, failed int) {
	s := &workflowService{workflowRepo: workflowRepo, executionRepo: db, publisher: publisher, refRepo: refRepo}
	rows, err := s.workflowRepo.GetAll()
	if err != nil {
		log.Printf("workflow_service: list workflows to merge: %v", err)
		return 0, 0
	}
	sort.SliceStable(rows, func(i, j int) bool { return runOrderLess(rows[i], rows[j]) })
	seen := map[string]bool{}
	for _, row := range rows {
		if !isMergeCandidate(row) {
			continue
		}
		identity, ok := triggerIdentity(row.Trigger)
		if !ok || seen[identity] {
			continue
		}
		seen[identity] = true
		result, err := s.mergeSameTrigger(row.ID)
		if err != nil {
			failed++
			log.Printf("workflow_service: leaving workflows sharing the trigger of %s unmerged: %v", row.ID, err)
			continue
		}
		if result != nil {
			merged += len(result.absorbed)
		}
	}
	return merged, failed
}
