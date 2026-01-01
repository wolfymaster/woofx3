package repository

import (
	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

type PermissionRepository struct {
	db *gorm.DB
}

func NewPermissionRepository(db *gorm.DB) *PermissionRepository {
	return &PermissionRepository{db: db}
}

func (r *PermissionRepository) GetDb() *gorm.DB {
	return r.db
}

// CRUD Operations
func (r *PermissionRepository) Create(p *models.Permission) error {
	return r.db.Create(r).Error
}

func (r *PermissionRepository) Update(p *models.Permission) error {
	return r.db.Save(r).Error
}

func (r *PermissionRepository) Delete(p *models.Permission) error {
	return r.db.Delete(r).Error
}

/*
Add a permission rule
subject: user or role
object: resource or group
action: action
permission: allow/deny
*/
func (r *PermissionRepository) AddPType(appID uuid.UUID, subject, object, action string, perm string) error {
	var permission models.Permission

	return r.db.Where(&models.Permission{
		ApplicationID: appID,
		Ptype:         "p",
		V0:            subject,
		V1:            object,
		V2:            action,
		V3:            perm,
	}).FirstOrCreate(&permission, models.Permission{
		ApplicationID: appID,
		Ptype:         "p",
		V0:            subject,
		V1:            object,
		V2:            action,
		V3:            perm,
	}).Error
}

/*
Add a grouping rule
user: user
resource: resource
role: role
*/
func (r *PermissionRepository) AddGType(appID uuid.UUID, user string, resource string, role string) error {
	var permission models.Permission

	return r.db.Where(&models.Permission{
		ApplicationID: appID,
		Ptype:         "g",
		V0:            user,
		V1:            resource,
		V2:            role,
	}).FirstOrCreate(&permission, models.Permission{
		ApplicationID: appID,
		Ptype:         "g",
		V0:            user,
		V1:            resource,
		V2:            role,
	}).Error
}

/*
Add a grouping rule
resource: resource
group: group
*/
func (r *PermissionRepository) AddG2Type(appID uuid.UUID, resource string, group string) error {
	var permission models.Permission

	return r.db.Where(&models.Permission{
		ApplicationID: appID,
		Ptype:         "g2",
		V0:            resource,
		V1:            group,
	}).FirstOrCreate(&permission, models.Permission{
		ApplicationID: appID,
		Ptype:         "g2",
		V0:            resource,
		V1:            group,
	}).Error
}

func (r *PermissionRepository) RemovePType(appID uuid.UUID, subject, object, action string, permission string) error {
	return r.db.Where("application_id = ? AND ptype = 'p' AND v0 = ? AND v1 = ? AND v2 = ? AND v3 = ?",
		appID, subject, object, action, permission).Delete(&models.Permission{}).Error
}

func (r *PermissionRepository) RemoveGType(appID uuid.UUID, user string, resource string, role string) error {
	return r.db.Where("application_id = ? AND ptype = 'g' AND v0 = ? AND v1 = ? AND v2 = ?",
		appID, user, resource, role).Delete(&models.Permission{}).Error
}

func (r *PermissionRepository) RemoveG2Type(appID uuid.UUID, resource string, group string) error {
	return r.db.Where("application_id = ? AND ptype = 'g2' AND v0 = ? AND v1 = ?",
		appID, resource, group).Delete(&models.Permission{}).Error
}

// func (r *PermissionRepository) GetPermissionByID(db *gorm.DB, id int) (*Permission, error) {
// 	var rule Permission
// 	err := db.First(&rule, id).Error
// 	return &rule, err
// }

// func (r *PermissionRepository) GetPermissionsByApplicationID(db *gorm.DB, appID uuid.UUID) ([]Permission, error) {
// 	var rules []Permission
// 	err := db.Where("application_id = ?", appID).Find(&rules).Error
// 	return rules, err
// }

// func (r *PermissionRepository) GetPermissionsByPtype(db *gorm.DB, appID uuid.UUID, ptype string) ([]Permission, error) {
// 	var rules []Permission
// 	err := db.Where("application_id = ? AND ptype = ?", appID, ptype).Find(&rules).Error
// 	return rules, err
// }

// // Get policy rules (p, p2, etc.)
// func (r *PermissionRepository) GetPolicyRules(db *gorm.DB, appID uuid.UUID) ([]Permission, error) {
// 	var rules []Permission
// 	err := db.Where("application_id = ? AND ptype LIKE 'p%'", appID).Find(&rules).Error
// 	return rules, err
// }

// // Get grouping policy rules (g, g2, etc.)
// func (r *PermissionRepository) GetGroupingRules(db *gorm.DB, appID uuid.UUID) ([]Permission, error) {
// 	var rules []Permission
// 	err := db.Where("application_id = ? AND ptype LIKE 'g%'", appID).Find(&rules).Error
// 	return rules, err
// }

// // Get rules for a specific subject
// func (r *PermissionRepository) GetRulesForSubject(db *gorm.DB, appID uuid.UUID, subject string) ([]Permission, error) {
// 	var rules []Permission
// 	err := db.Where("application_id = ? AND v0 = ?", appID, subject).Find(&rules).Error
// 	return rules, err
// }

// // Get rules for a specific role
// func (r *PermissionRepository) GetRulesForRole(db *gorm.DB, appID uuid.UUID, role string) ([]Permission, error) {
// 	var rules []Permission
// 	err := db.Where("application_id = ? AND ptype LIKE 'p%' AND v0 = ?", appID, role).Find(&rules).Error
// 	return rules, err
// }

// // Get role assignments for a user
// func (r *PermissionRepository) GetUserRoles(db *gorm.DB, appID uuid.UUID, user string) ([]Permission, error) {
// 	var rules []Permission
// 	err := db.Where("application_id = ? AND ptype = 'g' AND v0 = ?", appID, user).Find(&rules).Error
// 	return rules, err
// }

// // Check if a specific policy exists
// func (r *PermissionRepository) PolicyExists(db *gorm.DB, appID uuid.UUID, ptype, v0, v1, v2 string) (bool, error) {
// 	var count int64
// 	err := db.Model(&Permission{}).
// 		Where("application_id = ? AND ptype = ? AND v0 = ? AND v1 = ? AND v2 = ?", appID, ptype, v0, v1, v2).
// 		Count(&count).Error
// 	return count > 0, err
// }

// // Bulk operations for better performance
// func (r *PermissionRepository) CreatePermissions(db *gorm.DB, rules []Permission) error {
// 	return db.CreateInBatches(rules, 100).Error
// }

// func (r *PermissionRepository) DeletePermissionsByApplicationID(db *gorm.DB, appID uuid.UUID) error {
// 	return db.Where("application_id = ?", appID).Delete(&Permission{}).Error
// }

// func (r *PermissionRepository) AddRoleForUser(db *gorm.DB, appID uuid.UUID, user, role string) error {
// 	rule := Permission{
// 		ApplicationID: appID,
// 		Ptype:         "g",
// 		V0:            user,
// 		V1:            role,
// 	}
// 	return rule.Create(db)
// }

// func (r *PermissionRepository) RemovePolicy(db *gorm.DB, appID uuid.UUID, subject, object, action string) error {
// 	return db.Where("application_id = ? AND ptype = 'p' AND v0 = ? AND v1 = ? AND v2 = ?",
// 		appID, subject, object, action).Delete(&Permission{}).Error
// }

// func (r *PermissionRepository) RemoveRoleForUser(db *gorm.DB, appID uuid.UUID, user, role string) error {
// 	return db.Where("application_id = ? AND ptype = 'g' AND v0 = ? AND v1 = ?",
// 		appID, user, role).Delete(&Permission{}).Error
// }
