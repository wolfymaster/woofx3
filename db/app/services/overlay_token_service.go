package services

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

// overlayTokenService implements `client.OverlayTokenService` (Twirp-
// generated). Mirrors `sceneService` in shape.
//
// Security posture (spec section 2.1):
//   - Tokens are plaintext at rest; the plaintext leaves the service
//     only via RPC responses (Mint/Rotate/List). Outbox payloads carry
//     the token id, never the plaintext, so downstream projections
//     (api webhooks, streamware cache poisoning) stay redaction-safe.
//   - Resolve returns identical NOT_FOUND responses for revoked and
//     unknown tokens — no enumeration oracle. It is intended for
//     engine-internal callers (streamware); the public api gateway
//     never resolves plaintext tokens.
//   - Revocation tombstones, never deletes.
//
// Outbox publishing is opt-in via `publisher`, same as sceneService:
// `db.overlay_token.created.{applicationId}` on mint and on the new
// half of rotate, `db.overlay_token.updated.{applicationId}` on revoke
// and on the tombstoned half of rotate.
type overlayTokenService struct {
	repo      *repo.OverlayTokenRepository
	sceneRepo *repo.SceneRepository
	publisher *workers.EventPublisher
}

func NewOverlayTokenService(
	tokenRepo *repo.OverlayTokenRepository,
	sceneRepo *repo.SceneRepository,
	publisher *workers.EventPublisher,
) client.OverlayTokenService {
	return &overlayTokenService{
		repo:      tokenRepo,
		sceneRepo: sceneRepo,
		publisher: publisher,
	}
}

// overlayTokenAlphabet is the Bitcoin base58 alphabet — no 0/O/I/l so
// tokens survive hand-transcription into OBS browser-source dialogs.
const overlayTokenAlphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

// overlayTokenPrefix marks the credential format; resolvers and log
// redactors key off it.
const overlayTokenPrefix = "ovl_"

// lastUsedTouchInterval throttles last_used_at writes — overlays poll
// frequently and per-request UPDATEs would dominate the write load.
const lastUsedTouchInterval = 60 * time.Second

// generateOverlayToken returns "ovl_" + base58(32 crypto/rand bytes).
// 32 bytes of entropy makes collisions a non-event; the unique index
// on `token` is the backstop.
func generateOverlayToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("read random bytes: %w", err)
	}
	return overlayTokenPrefix + base58Encode(raw), nil
}

// base58Encode is a minimal big.Int-based encoder (Bitcoin alphabet).
// Inlined rather than pulled in as a dependency — it is a dozen lines
// and the repo avoids third-party deps where from-scratch is trivial.
func base58Encode(input []byte) string {
	num := new(big.Int).SetBytes(input)
	base := big.NewInt(58)
	mod := new(big.Int)
	var encoded []byte
	for num.Sign() > 0 {
		num.DivMod(num, base, mod)
		encoded = append(encoded, overlayTokenAlphabet[mod.Int64()])
	}
	// Preserve leading zero bytes as leading '1's (standard base58).
	for _, b := range input {
		if b != 0 {
			break
		}
		encoded = append(encoded, overlayTokenAlphabet[0])
	}
	// Reverse — digits were produced least-significant first.
	for i, j := 0, len(encoded)-1; i < j; i, j = i+1, j-1 {
		encoded[i], encoded[j] = encoded[j], encoded[i]
	}
	return string(encoded)
}

func (s *overlayTokenService) MintOverlayToken(ctx context.Context, req *client.MintOverlayTokenRequest) (*client.OverlayTokenResponse, error) {
	if req.SceneId == "" {
		return nil, twirp.RequiredArgumentError("scene_id")
	}
	sceneID, err := uuid.Parse(req.SceneId)
	if err != nil {
		return nil, twirp.InvalidArgumentError("scene_id", "invalid UUID format")
	}
	appIDStr, err := resolveApplicationID(ctx, s.repo.DB(), req.ApplicationId)
	if err != nil {
		return nil, err
	}
	applicationID, err := uuid.Parse(appIDStr)
	if err != nil {
		return nil, twirp.InvalidArgumentError("application_id", "invalid UUID format")
	}

	if err := s.validateSceneOwnership(sceneID, applicationID); err != nil {
		return nil, err
	}

	token, err := s.mintRow(s.repo, sceneID, applicationID, req.Label)
	if err != nil {
		return nil, err
	}

	s.publishChange(token, "created")

	return &client.OverlayTokenResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Overlay token minted successfully",
		},
		OverlayToken: s.tokenToProto(token),
	}, nil
}

func (s *overlayTokenService) RevokeOverlayToken(ctx context.Context, req *client.RevokeOverlayTokenRequest) (*client.OverlayTokenResponse, error) {
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, twirp.InvalidArgumentError("id", "invalid UUID format")
	}
	token, err := s.repo.GetByID(id)
	if err != nil {
		return nil, twirp.NotFoundError("overlay token not found")
	}

	// Idempotent: a second revoke returns the existing tombstone
	// without rewriting revoked_at or re-emitting the outbox event.
	if token.Status == models.OverlayTokenStatusRevoked {
		return &client.OverlayTokenResponse{
			Status: &client.ResponseStatus{
				Code:    client.ResponseStatus_OK,
				Message: "Overlay token already revoked",
			},
			OverlayToken: s.tokenToProto(token),
		}, nil
	}

	if err := tombstone(s.repo, token); err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to revoke overlay token: %w", err))
	}

	s.publishChange(token, "updated")

	return &client.OverlayTokenResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Overlay token revoked successfully",
		},
		OverlayToken: s.tokenToProto(token),
	}, nil
}

func (s *overlayTokenService) RotateOverlayToken(ctx context.Context, req *client.RotateOverlayTokenRequest) (*client.OverlayTokenResponse, error) {
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, twirp.InvalidArgumentError("id", "invalid UUID format")
	}

	var oldToken *models.OverlayToken
	var newToken *models.OverlayToken

	// Mint-replacement + tombstone-old commit or roll back together —
	// a crash mid-rotate must never leave zero active tokens (or two)
	// for the slot being rotated.
	txErr := s.repo.Transaction(func(txRepo *repo.OverlayTokenRepository) error {
		oldToken, err = txRepo.GetByID(id)
		if err != nil {
			return twirp.NotFoundError("overlay token not found")
		}
		if oldToken.Status == models.OverlayTokenStatusRevoked {
			return twirp.NewError(twirp.FailedPrecondition, "overlay token already revoked")
		}
		newToken, err = s.mintRow(txRepo, oldToken.SceneID, oldToken.ApplicationID, oldToken.Label)
		if err != nil {
			return err
		}
		if err := tombstone(txRepo, oldToken); err != nil {
			return twirp.InternalErrorWith(fmt.Errorf("failed to revoke rotated overlay token: %w", err))
		}
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}

	s.publishChange(newToken, "created")
	s.publishChange(oldToken, "updated")

	return &client.OverlayTokenResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Overlay token rotated successfully",
		},
		OverlayToken: s.tokenToProto(newToken),
	}, nil
}

func (s *overlayTokenService) ListOverlayTokens(ctx context.Context, req *client.ListOverlayTokensRequest) (*client.ListOverlayTokensResponse, error) {
	var sceneID, applicationID *uuid.UUID
	if req.SceneId != "" {
		id, err := uuid.Parse(req.SceneId)
		if err != nil {
			return nil, twirp.InvalidArgumentError("scene_id", "invalid UUID format")
		}
		sceneID = &id
	}
	if req.ApplicationId != "" {
		id, err := uuid.Parse(req.ApplicationId)
		if err != nil {
			return nil, twirp.InvalidArgumentError("application_id", "invalid UUID format")
		}
		applicationID = &id
	}

	tokens, err := s.repo.List(sceneID, applicationID, req.IncludeRevoked)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to list overlay tokens: %w", err))
	}

	out := make([]*client.OverlayToken, len(tokens))
	for i, t := range tokens {
		out[i] = s.tokenToProto(t)
	}

	return &client.ListOverlayTokensResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Overlay tokens retrieved successfully",
		},
		OverlayTokens: out,
		TotalCount:    int32(len(out)),
	}, nil
}

func (s *overlayTokenService) ResolveOverlayToken(ctx context.Context, req *client.ResolveOverlayTokenRequest) (*client.ResolveOverlayTokenResponse, error) {
	if req.Token == "" {
		return resolveNotFoundResponse(), nil
	}

	token, err := s.repo.GetByToken(req.Token)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return resolveNotFoundResponse(), nil
		}
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to resolve overlay token: %w", err))
	}
	if token.Status != models.OverlayTokenStatusActive {
		// Identical response to the unknown-token path above — callers
		// must not be able to distinguish revoked from never-existed.
		return resolveNotFoundResponse(), nil
	}

	// Throttled liveness stamp: at most one write per token per
	// interval. Best-effort — a failed touch must not fail resolution.
	now := time.Now().UTC()
	if token.LastUsedAt == nil || now.Sub(*token.LastUsedAt) >= lastUsedTouchInterval {
		_ = s.repo.TouchLastUsed(token.ID, now)
	}

	return &client.ResolveOverlayTokenResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Overlay token resolved successfully",
		},
		SceneId:       token.SceneID.String(),
		ApplicationId: token.ApplicationID.String(),
	}, nil
}

// resolveNotFoundResponse is the single uniform miss response —
// revoked, unknown, and empty tokens all return this exact shape.
func resolveNotFoundResponse() *client.ResolveOverlayTokenResponse {
	return &client.ResolveOverlayTokenResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_NOT_FOUND,
			Message: "overlay token not found",
		},
	}
}

// validateSceneOwnership confirms the scene exists and belongs to the
// application. Both failure modes return NOT_FOUND — a caller holding
// the wrong application id must not learn that the scene exists.
func (s *overlayTokenService) validateSceneOwnership(sceneID, applicationID uuid.UUID) error {
	scene, err := s.sceneRepo.GetByID(sceneID)
	if err != nil {
		return twirp.NotFoundError("scene not found")
	}
	if scene.ApplicationID != applicationID {
		return twirp.NotFoundError("scene not found")
	}
	return nil
}

// mintRow generates and persists a fresh active token row through the
// given repository (which may be transactional, for rotate).
func (s *overlayTokenService) mintRow(r *repo.OverlayTokenRepository, sceneID, applicationID uuid.UUID, label string) (*models.OverlayToken, error) {
	tokenValue, err := generateOverlayToken()
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to generate overlay token: %w", err))
	}
	token := &models.OverlayToken{
		ID:            uuid.New(),
		Token:         tokenValue,
		SceneID:       sceneID,
		ApplicationID: applicationID,
		Label:         label,
		Status:        models.OverlayTokenStatusActive,
	}
	if err := r.Create(token); err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to create overlay token: %w", err))
	}
	return token, nil
}

// tombstone flips a token to revoked in place. Never deletes — the
// row (and its label) is the operator's rotation history.
func tombstone(r *repo.OverlayTokenRepository, token *models.OverlayToken) error {
	now := time.Now().UTC()
	token.Status = models.OverlayTokenStatusRevoked
	token.RevokedAt = &now
	return r.Update(token)
}

func (s *overlayTokenService) tokenToProto(t *models.OverlayToken) *client.OverlayToken {
	var createdAt, revokedAt, lastUsedAt *timestamppb.Timestamp
	if !t.CreatedAt.IsZero() {
		createdAt = timestamppb.New(t.CreatedAt)
	}
	if t.RevokedAt != nil {
		revokedAt = timestamppb.New(*t.RevokedAt)
	}
	if t.LastUsedAt != nil {
		lastUsedAt = timestamppb.New(*t.LastUsedAt)
	}
	return &client.OverlayToken{
		Id:            t.ID.String(),
		Token:         t.Token,
		SceneId:       t.SceneID.String(),
		ApplicationId: t.ApplicationID.String(),
		Label:         t.Label,
		Status:        t.Status,
		CreatedAt:     createdAt,
		RevokedAt:     revokedAt,
		LastUsedAt:    lastUsedAt,
	}
}

func (s *overlayTokenService) publishChange(token *models.OverlayToken, op string) {
	if s.publisher == nil {
		return
	}
	s.publisher.Publish(workers.PublishOptions{
		ApplicationID:   token.ApplicationID.String(),
		EntityType:      "overlay_token",
		EntityID:        token.ID.String(),
		Operation:       op,
		Data:            buildOverlayTokenChangeData(token),
		AutoAcknowledge: true,
	})
}

// buildOverlayTokenChangeData deliberately omits the plaintext token.
// Outbox events fan out to webhook projections and logs; consumers key
// off the id (and scene_id for cache poisoning), never the credential.
func buildOverlayTokenChangeData(token *models.OverlayToken) map[string]interface{} {
	data := map[string]interface{}{
		"id":             token.ID.String(),
		"scene_id":       token.SceneID.String(),
		"application_id": token.ApplicationID.String(),
		"label":          token.Label,
		"status":         token.Status,
	}
	if token.RevokedAt != nil {
		data["revoked_at"] = token.RevokedAt.UTC().Format(time.RFC3339)
	}
	return data
}
