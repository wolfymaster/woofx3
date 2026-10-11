package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

// Composition links: which workflow or chat command steps play which alert.
// The workflow and command services replace an owner's links in the same
// transaction as they write its definition, so the table always matches the
// saved definitions; the SceneService RPCs here read it, to show where an
// alert is used, and deleting an alert that is used is refused.

func isCompositionLinkOwner(kind string) bool {
	return kind == models.CompositionLinkOwnerWorkflow || kind == models.CompositionLinkOwnerCommand
}

// CompositionLinkRefusal is a link an owner cannot have: a step that plays a
// composition that does not exist or is not an alert, or a malformed one. The
// owner's save is refused with it, so a definition is never stored playing
// something it cannot play.
type CompositionLinkRefusal struct {
	Reason string
}

func (e *CompositionLinkRefusal) Error() string {
	return e.Reason
}

// alertStepJSON is the part of a workflow step, or a command action, that
// says whether it plays a stored composition. The two share a shape (see
// command.proto's actions_json).
type alertStepJSON struct {
	ID         string         `json:"id"`
	Action     string         `json:"action"`
	Parameters map[string]any `json:"parameters"`
}

// alertCompositionAction is the handler name an alert step carries, as the
// workflow engine registers it (see NewAlertAction in workflow/actions.go).
const alertCompositionAction = "alert"

// compositionLinksOf reads the links a definition's steps make: one per alert
// step whose `parameters.composition` names a stored composition. A step is
// named by its id, or by its position (`step[2]`) when it has none, as a
// command's actions may not.
//
// Steps JSON that is not an array of objects makes no links rather than an
// error, as for the resource reference edges: whether such a definition may
// be saved at all is not decided here.
func compositionLinksOf(stepsJSON string) ([]repo.CompositionLinkTarget, error) {
	var steps []alertStepJSON
	if err := json.Unmarshal([]byte(stepsJSON), &steps); err != nil {
		return nil, nil
	}
	var targets []repo.CompositionLinkTarget
	named := make(map[string]bool)
	for i, step := range steps {
		if step.Action != alertCompositionAction {
			continue
		}
		raw, present := step.Parameters["composition"]
		if !present {
			continue
		}
		stepID := step.ID
		if stepID == "" {
			stepID = fmt.Sprintf("step[%d]", i)
		}
		if named[stepID] {
			return nil, &CompositionLinkRefusal{Reason: fmt.Sprintf("alert step %q appears twice", stepID)}
		}
		named[stepID] = true
		text, _ := raw.(string)
		id, err := uuid.Parse(text)
		if err != nil {
			return nil, &CompositionLinkRefusal{
				Reason: fmt.Sprintf("alert step %q: composition must be an alert composition id", stepID),
			}
		}
		targets = append(targets, repo.CompositionLinkTarget{CompositionID: id, StepID: stepID})
	}
	return targets, nil
}

// replaceOwnerCompositionLinks makes `targets` the only links of one owner,
// inside the transaction `tx` the owner's definition is written in, so the
// links always match what is stored. Every composition must exist and be an
// alert: only alerts are played by reference, and a scene is shown by
// overlays and has no steps of its own. An empty `targets` removes them all.
//
// A composition checked here cannot disappear before the transaction
// commits: a link's foreign key refuses deleting the composition it names.
func replaceOwnerCompositionLinks(
	tx *gorm.DB,
	ownerKind, ownerID string,
	targets []repo.CompositionLinkTarget,
	now time.Time,
) error {
	if !isCompositionLinkOwner(ownerKind) {
		panic(fmt.Sprintf("composition links: unknown owner kind %q", ownerKind))
	}
	if ownerID == "" {
		panic("composition links: an owner needs an id")
	}
	scenes := repo.NewSceneRepository(tx)
	checked := make(map[uuid.UUID]bool)
	for _, target := range targets {
		if checked[target.CompositionID] {
			continue
		}
		composition, err := scenes.GetByID(target.CompositionID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return &CompositionLinkRefusal{Reason: fmt.Sprintf(
				"alert step %q plays composition %s, which does not exist", target.StepID, target.CompositionID)}
		}
		if err != nil {
			return err
		}
		if composition.Kind != models.SceneKindAlert {
			return &CompositionLinkRefusal{Reason: fmt.Sprintf(
				"alert step %q plays composition %s, which is a %s, not an alert",
				target.StepID, target.CompositionID, composition.Kind)}
		}
		checked[target.CompositionID] = true
	}
	_, err := repo.NewCompositionLinkRepository(tx).ReplaceForOwner(ownerKind, ownerID, targets, now)
	return err
}

// saveError answers a failed save of an owner's definition: a refused link is
// the caller's to fix, anything else is the engine's.
func saveError(field, what string, err error) error {
	var refusal *CompositionLinkRefusal
	if errors.As(err, &refusal) {
		return twirp.InvalidArgumentError(field, refusal.Reason)
	}
	return twirp.InternalErrorWith(fmt.Errorf("failed to %s: %w", what, err))
}

func (s *sceneService) ListCompositionLinks(
	ctx context.Context,
	req *client.ListCompositionLinksRequest,
) (*client.CompositionLinksResponse, error) {
	id, err := uuid.Parse(req.CompositionId)
	if err != nil {
		return nil, twirp.InvalidArgumentError("composition_id", "invalid UUID format")
	}
	links, err := s.linkRepo.ListForComposition(id)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to list composition links: %w", err))
	}
	return &client.CompositionLinksResponse{
		Status: &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "Composition links retrieved"},
		Links:  compositionLinksToProto(links),
	}, nil
}

func (s *sceneService) CountCompositionLinks(
	ctx context.Context,
	req *client.CountCompositionLinksRequest,
) (*client.CountCompositionLinksResponse, error) {
	id, err := uuid.Parse(req.CompositionId)
	if err != nil {
		return nil, twirp.InvalidArgumentError("composition_id", "invalid UUID format")
	}
	n, err := s.linkRepo.CountForComposition(id)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to count composition links: %w", err))
	}
	return &client.CountCompositionLinksResponse{
		Status: &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "Composition links counted"},
		Count:  int32(n),
	}, nil
}

// linkedCompositionError refuses deleting a composition that steps still
// play. The message names each step; the `links` meta carries them as JSON
// for callers that show them.
func linkedCompositionError(links []*models.CompositionLink) twirp.Error {
	steps := make([]string, len(links))
	type linkMeta struct {
		OwnerKind string `json:"ownerKind"`
		OwnerID   string `json:"ownerId"`
		StepID    string `json:"stepId"`
	}
	meta := make([]linkMeta, len(links))
	for i, link := range links {
		steps[i] = fmt.Sprintf("%s %s step %s", link.OwnerKind, link.OwnerID, link.StepID)
		meta[i] = linkMeta{OwnerKind: link.OwnerKind, OwnerID: link.OwnerID, StepID: link.StepID}
	}
	encoded, err := json.Marshal(meta)
	if err != nil {
		panic(fmt.Sprintf("composition links: encoding plain strings failed: %v", err))
	}
	return twirp.NewError(twirp.FailedPrecondition,
		fmt.Sprintf("composition is played by %d step(s): %s", len(links), strings.Join(steps, ", "))).
		WithMeta("links", string(encoded))
}

func compositionLinksToProto(links []*models.CompositionLink) []*client.CompositionLink {
	out := make([]*client.CompositionLink, len(links))
	for i, link := range links {
		out[i] = &client.CompositionLink{
			Id:            link.ID.String(),
			CompositionId: link.CompositionID.String(),
			OwnerKind:     link.OwnerKind,
			OwnerId:       link.OwnerID,
			StepId:        link.StepID,
			CreatedAt:     timestamppb.New(link.CreatedAt),
			UpdatedAt:     timestamppb.New(link.UpdatedAt),
		}
	}
	return out
}
