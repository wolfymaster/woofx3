package services

// import (
// 	"errors"
// 	"fmt"
// 	"time"

// 	"gorm.io/gorm"
// 	"github.com/google/uuid"
	
// 	"github.com/wolfymaster/woofx3/db/models"
// )

// type treatService struct {
// 	baseService[models.Treat]
// }

// // NewTreatService creates a new instance of TreatService
// func NewTreatService() TreatService {
// 	return &treatService{
// 		baseService: baseService[models.Treat]{},
// 	}
// }

// // CreateTreat creates a new treat
// func (s *treatService) CreateTreat(db *gorm.DB, treat *models.Treat) error {
// 	// Validate the treat
// 	if treat.UserID == uuid.Nil {
// 		return errors.New("user ID is required")
// 	}

// 	if treat.Type == "" {
// 		return errors.New("treat type is required")
// 	}

// 	if treat.Points <= 0 {
// 		return errors.New("points must be greater than 0")
// 	}

// 	// Set default values
// 	treat.ID = uuid.New()
// 	treat.CreatedAt = time.Now()
// 	treat.UpdatedAt = time.Now()

// 	return db.Create(treat).Error
// }

// // GetTreat retrieves a treat by ID
// func (s *treatService) GetTreat(db *gorm.DB, id uuid.UUID) (*models.Treat, error) {
// 	var treat models.Treat
// 	err := db.First(&treat, "id = ?", id).Error

// 	if err != nil {
// 		if errors.Is(err, gorm.ErrRecordNotFound) {
// 			return nil, fmt.Errorf("treat not found")
// 		}
// 		return nil, fmt.Errorf("failed to get treat: %w", err)
// 	}

// 	return &treat, nil
// }

// // UpdateTreat updates an existing treat
// func (s *treatService) UpdateTreat(db *gorm.DB, treat *models.Treat) error {
// 	// Check if the treat exists
// 	existing, err := s.GetTreat(db, treat.ID)
// 	if err != nil {
// 		return err
// 	}

// 	// Update fields that are allowed to be updated
// 	existing.Type = treat.Type
// 	existing.Points = treat.Points
// 	existing.Description = treat.Description
// 	existing.UpdatedAt = time.Now()

// 	return db.Save(existing).Error
// }

// // DeleteTreat deletes a treat by ID
// func (s *treatService) DeleteTreat(db *gorm.DB, id uuid.UUID) error {
// 	// Check if the treat exists
// 	_, err := s.GetTreat(db, id)
// 	if err != nil {
// 		return err
// 	}

// 	return db.Delete(&models.Treat{}, "id = ?", id).Error
// }

// // ListTreats retrieves a list of treats with optional filtering
// func (s *treatService) ListTreats(
// 	db *gorm.DB,
// 	userID *uuid.UUID,
// 	treatType *string,
// 	startTime *time.Time,
// 	endTime *time.Time,
// 	page, pageSize int,
// ) ([]models.Treat, int64, error) {
// 	var treats []models.Treat
// 	var count int64

// 	// Build the query
// 	query := db.Model(&models.Treat{})

// 	// Apply filters
// 	if userID != nil {
// 		query = query.Where("user_id = ?", *userID)
// 	}

// 	if treatType != nil {
// 		query = query.Where("type = ?", *treatType)
// 	}

// 	if startTime != nil {
// 		query = query.Where("created_at >= ?", *startTime)
// 	}

// 	if endTime != nil {
// 		query = query.Where("created_at <= ?", *endTime)
// 	}

// 	// Count total records
// 	if err := query.Count(&count).Error; err != nil {
// 		return nil, 0, fmt.Errorf("failed to count treats: %w", err)
// 	}

// 	// Apply pagination
// 	offset := (page - 1) * pageSize
// 	query = query.Offset(offset).Limit(pageSize)

// 	// Order by creation date (newest first)
// 	query = query.Order("created_at DESC")

// 	// Execute the query
// 	if err := query.Find(&treats).Error; err != nil {
// 		return nil, 0, fmt.Errorf("failed to list treats: %w", err)
// 	}

// 	return treats, count, nil
// }

// // GetUserTreatsSummary gets a summary of treats for a user
// func (s *treatService) GetUserTreatsSummary(
// 	db *gorm.DB,
// 	userID uuid.UUID,
// 	startTime, endTime *time.Time,
// ) (*models.TreatsSummary, error) {
// 	summary := &models.TreatsSummary{
// 		UserID:                userID,
// 		TreatTypeDistribution: make(map[string]models.TreatTypeStats),
// 	}

// 	// Base query for the user
// 	query := db.Model(&models.Treat{}).Where("user_id = ?", userID)

// 	// Apply time filter if provided
// 	if startTime != nil && endTime != nil {
// 		query = query.Where("created_at BETWEEN ? AND ?", *startTime, *endTime)
// 		summary.PeriodStart = *startTime
// 		summary.PeriodEnd = *endTime
// 	} else if startTime != nil {
// 		query = query.Where("created_at >= ?", *startTime)
// 		summary.PeriodStart = *startTime
// 	} else if endTime != nil {
// 		query = query.Where("created_at <= ?", *endTime)
// 		summary.PeriodEnd = *endTime
// 	}

// 	// Get total points
// 	var totalPoints int64
// 	if err := query.Select("COALESCE(SUM(points), 0)").Scan(&totalPoints).Error; err != nil {
// 		return nil, fmt.Errorf("failed to calculate total points: %w", err)
// 	}
// 	summary.TotalPoints = int(totalPoints)

// 	// Get treat type distribution
// 	type treatTypeCount struct {
// 		Type  string
// 		Count int64
// 		Total int64
// 	}

// 	var typeCounts []treatTypeCount
// 	if err := query.Select(
// 		"type, COUNT(*) as count, SUM(points) as total",
// 	).Group("type").Find(&typeCounts).Error; err != nil {
// 		return nil, fmt.Errorf("failed to get treat type distribution: %w", err)
// 	}

// 	// Convert to map
// 	for _, tc := range typeCounts {
// 		summary.TreatTypeDistribution[tc.Type] = models.TreatTypeStats{
// 			Count: int(tc.Count),
// 			Total: int(tc.Total),
// 		}
// 	}

// 	// Get recent treats (last 10)
// 	recentQuery := db.Model(&models.Treat{}).
// 		Where("user_id = ?", userID).
// 		Order("created_at DESC").
// 		Limit(10)

// 	recentTreats := make([]models.Treat, 0)
// 	if err := recentQuery.Find(&recentTreats).Error; err != nil {
// 		return nil, fmt.Errorf("failed to get recent treats: %w", err)
// 	}
// 	summary.RecentTreats = recentTreats

// 	return summary, nil
// }
