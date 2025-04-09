package services

import (
	"gorm.io/gorm"
)

type RewardService struct {
	db *gorm.DB
}

func NewRewardService(db *gorm.DB) *RewardService {
	return &RewardService{
		db: db,
	}
}
