package services

import (
	// "context"
	"fmt"
	"strings"

	"gorm.io/gorm"
	"github.com/google/uuid"
	
	"github.com/wolfymaster/woofx3/db/models"
)

type permissionService struct {
	baseService[models.Permission]
}

// NewPermissionService creates a new instance of PermissionService
func NewPermissionService() PermissionService {
	return &permissionService{
		baseService: baseService[models.Permission]{},
	}
}

// AddPolicy adds a new policy rule
func (s *permissionService) AddPolicy(db *gorm.DB, appID uuid.UUID, subject, object, action string) error {
	// Check if policy already exists
	exists, err := models.PolicyExists(db, appID, "p", subject, object, action)
	if err != nil {
		return fmt.Errorf("failed to check policy existence: %w", err)
	}
	if exists {
		return nil // Policy already exists, no need to add it again
	}

	// Create new policy
	policy := models.Permission{
		ApplicationID: appID,
		Ptype:        "p",
		V0:           subject,
		V1:           object,
		V2:           action,
	}

	return s.baseService.Create(db, &policy)
}

// RemovePolicy removes a policy rule
func (s *permissionService) RemovePolicy(db *gorm.DB, appID uuid.UUID, subject, object, action string) error {
	policy := models.Permission{
		ApplicationID: appID,
		Ptype:        "p",
		V0:           subject,
		V1:           object,
		V2:           action,
	}

	return db.Where("application_id = ? AND ptype = ? AND v0 = ? AND v1 = ? AND v2 = ?",
		appID, "p", subject, object, action).Delete(&policy).Error
}

// AddRoleForUser assigns a role to a user
func (s *permissionService) AddRoleForUser(db *gorm.DB, appID uuid.UUID, user, role string) error {
	// Check if role assignment already exists
	exists, err := models.PolicyExists(db, appID, "g", user, role, "")
	if err != nil {
		return fmt.Errorf("failed to check role assignment: %w", err)
	}
	if exists {
		return nil // Role already assigned
	}

	// Create new role assignment
	roleAssignment := models.Permission{
		ApplicationID: appID,
		Ptype:        "g",
		V0:           user,
		V1:           role,
	}

	return s.baseService.Create(db, &roleAssignment)
}

// RemoveRoleForUser removes a role from a user
func (s *permissionService) RemoveRoleForUser(db *gorm.DB, appID uuid.UUID, user, role string) error {
	roleAssignment := models.Permission{
		ApplicationID: appID,
		Ptype:        "g",
		V0:           user,
		V1:           role,
	}

	return db.Where("application_id = ? AND ptype = ? AND v0 = ? AND v1 = ?",
		appID, "g", user, role).Delete(&roleAssignment).Error
}

// GetUserRoles returns all roles assigned to a user
func (s *permissionService) GetUserRoles(db *gorm.DB, appID uuid.UUID, user string) ([]string, error) {
	rules, err := models.GetUserRoles(db, appID, user)
	if err != nil {
		return nil, fmt.Errorf("failed to get user roles: %w", err)
	}

	roles := make([]string, 0, len(rules))
	for _, rule := range rules {
		// v1 contains the role name in g-type rules
		roles = append(roles, rule.V1)
	}

	return roles, nil
}

// GetPolicies returns all policies as strings
func (s *permissionService) GetPolicies(db *gorm.DB, appID uuid.UUID) ([]string, error) {
	rules, err := models.GetPolicyRules(db, appID)
	if err != nil {
		return nil, fmt.Errorf("failed to get policies: %w", err)
	}

	policies := make([]string, 0, len(rules))
	for _, rule := range rules {
		// Format: p,sub,obj,act
		policy := fmt.Sprintf("%s,%s,%s,%s", rule.Ptype, rule.V0, rule.V1, rule.V2)
		policies = append(policies, policy)
	}

	return policies, nil
}

// Authorize checks if a user has permission to perform an action on a resource
func (s *permissionService) Authorize(db *gorm.DB, userID uuid.UUID, resource, action string) (bool, error) {
	// Get all roles for the user
	roles, err := s.GetUserRoles(db, userID, "")
	if err != nil {
		return false, fmt.Errorf("failed to get user roles: %w", err)
	}

	// Check direct permissions
	directPermission := fmt.Sprintf("%s:%s", resource, action)
	hasPermission, err := s.checkPermission(db, userID.String(), directPermission)
	if err != nil {
		return false, fmt.Errorf("failed to check direct permission: %w", err)
	}

	if hasPermission {
		return true, nil
	}

	// Check role-based permissions
	for _, role := range roles {
		hasPermission, err = s.checkPermission(db, role, directPermission)
		if err != nil {
			return false, fmt.Errorf("failed to check role permission: %w", err)
		}

		if hasPermission {
			return true, nil
		}
	}

	return false, nil
}

// checkPermission checks if a subject has a specific permission
func (s *permissionService) checkPermission(db *gorm.DB, subject, permission string) (bool, error) {
	parts := strings.Split(permission, ":")
	if len(parts) != 2 {
		return false, fmt.Errorf("invalid permission format: %s", permission)
	}

	resource, action := parts[0], parts[1]

	// Check if there's a matching policy
	var count int64
	err := db.Model(&models.Permission{}).
		Where("ptype = ? AND v0 = ? AND v1 = ? AND v2 = ?", "p", subject, resource, action).
		Count(&count).Error

	if err != nil {
		return false, fmt.Errorf("failed to check permission: %w", err)
	}

	return count > 0, nil
}

// BulkAddPolicies adds multiple policies at once
func (s *permissionService) BulkAddPolicies(db *gorm.DB, appID uuid.UUID, policies [][]string) error {
	permissions := make([]models.Permission, 0, len(policies))

	for _, policy := range policies {
		if len(policy) < 3 {
			continue // Skip invalid policies
		}

		permission := models.Permission{
			ApplicationID: appID,
			Ptype:        "p",
			V0:           policy[0], // subject
			V1:           policy[1], // resource
			V2:           policy[2], // action
		}

		if len(policy) > 3 {
			permission.V3 = policy[3]
		}
		if len(policy) > 4 {
			permission.V4 = policy[4]
		}
		if len(policy) > 5 {
			permission.V5 = policy[5]
		}

		permissions = append(permissions, permission)
	}

	// Use a transaction to ensure all or nothing
	return s.baseService.WithTransaction(db, func(tx *gorm.DB) error {
		for _, p := range permissions {
			if err := tx.Create(&p).Error; err != nil {
				return fmt.Errorf("failed to create permission: %w", err)
			}
		}
		return nil
	})
}
