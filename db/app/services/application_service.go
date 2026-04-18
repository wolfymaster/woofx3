package services

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/models"
	"github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

type applicationService struct {
	repo *repository.ApplicationRepository
}

func NewApplicationService(repo *repository.ApplicationRepository) *applicationService {
	return &applicationService{repo: repo}
}

func (s *applicationService) CreateApplication(ctx context.Context, req *client.CreateApplicationRequest) (*client.ApplicationResponse, error) {
	// If the caller asks for a default and one already exists, return it
	// rather than attempting a duplicate insert. This covers both the
	// postgres unique-index race path and the sqlite test harness (which
	// has no partial index).
	if req.IsDefault {
		if existing, err := s.repo.GetDefault(); err == nil {
			return applicationModelToResponse(existing), nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
	}

	ownerID, err := uuid.Parse(req.OwnerId)
	if err != nil {
		return nil, err
	}
	app := &models.Application{
		ID:        uuid.New(),
		Name:      req.Name,
		UserID:    ownerID,
		IsDefault: req.IsDefault,
	}
	if err := s.repo.Create(app); err != nil {
		if req.IsDefault && isUniqueViolation(err) {
			if existing, reErr := s.repo.GetDefault(); reErr == nil {
				return applicationModelToResponse(existing), nil
			}
		}
		return nil, err
	}
	return applicationModelToResponse(app), nil
}

func (s *applicationService) GetApplication(ctx context.Context, req *client.GetApplicationRequest) (*client.ApplicationResponse, error) {
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, err
	}
	app, err := s.repo.GetByID(id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return &client.ApplicationResponse{
				Status: &client.ResponseStatus{Code: client.ResponseStatus_NOT_FOUND, Message: "Application not found"},
			}, nil
		}
		return nil, err
	}
	return applicationModelToResponse(app), nil
}

func (s *applicationService) GetDefaultApplication(ctx context.Context, req *client.GetDefaultApplicationRequest) (*client.ApplicationResponse, error) {
	app, err := s.repo.GetDefault()
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return &client.ApplicationResponse{
				Status: &client.ResponseStatus{Code: client.ResponseStatus_NOT_FOUND, Message: "No default application"},
			}, nil
		}
		return nil, err
	}
	return applicationModelToResponse(app), nil
}

func (s *applicationService) UpdateApplication(ctx context.Context, req *client.UpdateApplicationRequest) (*client.ApplicationResponse, error) {
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, err
	}
	app, err := s.repo.GetByID(id)
	if err != nil {
		return nil, err
	}
	app.Name = req.Name
	app.IsDefault = req.IsDefault
	if err := s.repo.Update(app); err != nil {
		return nil, err
	}
	return applicationModelToResponse(app), nil
}

func (s *applicationService) DeleteApplication(ctx context.Context, req *client.DeleteApplicationRequest) (*client.ResponseStatus, error) {
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, err
	}
	if err := s.repo.Delete(id); err != nil {
		return nil, err
	}
	return &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "Application deleted"}, nil
}

func (s *applicationService) ListApplications(ctx context.Context, req *client.ListApplicationsRequest) (*client.ListApplicationsResponse, error) {
	apps, err := s.repo.List()
	if err != nil {
		return nil, err
	}
	out := make([]*client.Application, 0, len(apps))
	for i := range apps {
		out = append(out, applicationModelToProto(&apps[i]))
	}
	return &client.ListApplicationsResponse{
		Status:       &client.ResponseStatus{Code: client.ResponseStatus_OK},
		Applications: out,
	}, nil
}

// applicationModelToProto maps the model to the generated proto type. The
// model currently lacks CreatedAt and Enabled fields; we return sensible
// defaults (Enabled: true, CreatedAt: zero). Adding those fields to the
// model is a follow-up.
func applicationModelToProto(m *models.Application) *client.Application {
	return &client.Application{
		Id:        m.ID.String(),
		Name:      m.Name,
		OwnerId:   m.UserID.String(),
		Enabled:   true,
		IsDefault: m.IsDefault,
		CreatedAt: timestamppb.New(time.Time{}),
	}
}

func applicationModelToResponse(m *models.Application) *client.ApplicationResponse {
	return &client.ApplicationResponse{
		Status:      &client.ResponseStatus{Code: client.ResponseStatus_OK},
		Application: applicationModelToProto(m),
	}
}

// isUniqueViolation detects Postgres' 23505 SQLSTATE or a SQLite "unique"
// mention. The Postgres path is what the production migration triggers
// via the applications_single_default partial index; the SQLite path is
// defensive only — the test harness doesn't create that index.
func isUniqueViolation(err error) bool {
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unique") || strings.Contains(msg, "duplicate key")
}
