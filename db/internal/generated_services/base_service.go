package services

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	// "time"

	"gorm.io/gorm"
)

// baseService provides common CRUD operations for services
type baseService[T any] struct{}

// Create creates a new entity in the database
func (s *baseService[T]) Create(db *gorm.DB, entity *T) error {
	return db.Create(entity).Error
}

// Update updates an existing entity in the database
func (s *baseService[T]) Update(db *gorm.DB, entity *T) error {
	return db.Save(entity).Error
}

// Delete removes an entity from the database by ID
func (s *baseService[T]) Delete(db *gorm.DB, id interface{}) error {
	var zero T
	return db.Delete(&zero, "id = ?", id).Error
}

// GetByID retrieves an entity by its ID
func (s *baseService[T]) GetByID(db *gorm.DB, id interface{}) (*T, error) {
	var entity T
	if err := db.First(&entity, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("%s not found", reflect.TypeOf(entity).Name())
		}
		return nil, fmt.Errorf("failed to get %s: %w", reflect.TypeOf(entity).Name(), err)
	}
	return &entity, nil
}

// List retrieves a paginated list of entities
func (s *baseService[T]) List(db *gorm.DB, page, pageSize int, where ...interface{}) ([]T, int64, error) {
	var entities []T
	var count int64

	offset := (page - 1) * pageSize

	// Build the query
	query := db.Model(&entities)
	if len(where) > 0 {
		query = query.Where(where[0], where[1:]...)
	}

	// Get total count
	if err := query.Count(&count).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count records: %w", err)
	}

	// Get paginated results
	if err := query.Offset(offset).Limit(pageSize).Find(&entities).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to list records: %w", err)
	}

	return entities, count, nil
}

// WithTransaction executes a function within a database transaction
func (s *baseService[T]) WithTransaction(db *gorm.DB, fn func(tx *gorm.DB) error) error {
	tx := db.Begin()
	if tx.Error != nil {
		return fmt.Errorf("failed to begin transaction: %w", tx.Error)
	}

	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	if err := fn(tx); err != nil {
		tx.Rollback()
		return err
	}

	if err := tx.Commit().Error; err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// WithContext adds a context to the database operation
func (s *baseService[T]) WithContext(ctx context.Context, db *gorm.DB) *gorm.DB {
	return db.WithContext(ctx)
}

// NewBaseService creates a new base service with common CRUD operations
func NewBaseService[T any]() Service[T] {
	return &baseService[T]{}
}
