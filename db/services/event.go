package services

import (
	"context"

	"github.com/twitchtv/twirp"
	models "github.com/wolfymaster/wolfyttv-db/models"
	rpc "github.com/wolfymaster/wolfyttv/buf"
	"gorm.io/gorm"
)

type EventService struct {
	db *gorm.DB
}

func NewEventService(db *gorm.DB) *EventService {
	return &EventService{
		db: db,
	}
}

func (s *EventService) CreateUserEvent(ctx context.Context, req *rpc.CreateUserEventRequest) (*rpc.CreateUserEventResponse, error) {
	s.db.Config.Logger.Info(ctx, "Creating User Event")

	user, err := models.FindOrCreateUser(ctx, s.db, req.Event.UserId)
	if err != nil {
		return nil, twirp.InternalErrorWith(err)
	}

	var eventValue models.JSONB

	switch req.Event.GetEvent().(type) {
	case *rpc.UserEvent_BitCheer:
		bitCheer := req.Event.GetBitCheer()
		eventValue = models.JSONB{
			"amount": bitCheer.Amount,
		}
	case *rpc.UserEvent_Message:
		message := req.Event.GetMessage()
		eventValue = models.JSONB{
			"message": message.Message,
		}
	case *rpc.UserEvent_Subscribe:
		subscribe := req.Event.GetSubscribe()
		eventValue = models.JSONB{
			"tier":   subscribe.Tier,
			"isGift": subscribe.Gift,
		}
	case *rpc.UserEvent_Follow:
		follow := req.Event.GetFollow()
		eventValue = models.JSONB{
			"followDate": follow.FollowDate,
		}
	}

	userEvent := &models.UserEvent{
		UserID:     user.ID,
		EventType:  req.Event.EventType,
		EventValue: eventValue,
	}

	if createResult := s.db.Create(&userEvent); createResult.Error != nil {
		s.db.Config.Logger.Error(ctx, "Failed to create event", "error", createResult.Error)
		return nil, twirp.InternalErrorWith(createResult.Error)
	}

	return &rpc.CreateUserEventResponse{
		Status: &rpc.ResponseStatus{
			Code: rpc.ResponseStatus_OK,
		},
		Event: req.Event,
	}, nil
}

func (s *EventService) CreateUserChatMessage(ctx context.Context, req *rpc.CreateUserChatMessageRequest) (*rpc.CreateUserChatMessageResponse, error) {
	return nil, nil
}
