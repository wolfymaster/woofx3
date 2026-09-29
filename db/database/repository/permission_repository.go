package repository

import (
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

type PermissionRepository struct {
	db *gorm.DB
}

func NewPermissionRepository(db *gorm.DB) *PermissionRepository {
	return &PermissionRepository{db: db}
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
func (r *PermissionRepository) AddPType(subject, object, action string, perm string) error {
	var permission models.Permission

	return r.db.Where(&models.Permission{
		Ptype: "p",
		V0:    subject,
		V1:    object,
		V2:    action,
		V3:    perm,
	}).FirstOrCreate(&permission, models.Permission{
		Ptype: "p",
		V0:    subject,
		V1:    object,
		V2:    action,
		V3:    perm,
	}).Error
}

/*
Add a grouping rule
user: user
resource: resource
role: role
*/
func (r *PermissionRepository) AddGType(user string, resource string, role string) error {
	var permission models.Permission

	return r.db.Where(&models.Permission{
		Ptype: "g",
		V0:    user,
		V1:    resource,
		V2:    role,
	}).FirstOrCreate(&permission, models.Permission{
		Ptype: "g",
		V0:    user,
		V1:    resource,
		V2:    role,
	}).Error
}

/*
AddGrouping writes a standard 2-arg Casbin "g" role-assignment row:
g(subject, group). subject is a chat username; group is either "group:<id>"
for a group grant or a literal username for a direct per-user grant. This is
the write path used by GroupService for user_groups membership - it
replaces the old 3-arg AddGType/hasRole scheme.
*/
func (r *PermissionRepository) AddGrouping(subject, group string) error {
	var permission models.Permission

	return r.db.Where(&models.Permission{
		Ptype: "g",
		V0:    subject,
		V1:    group,
	}).FirstOrCreate(&permission, models.Permission{
		Ptype: "g",
		V0:    subject,
		V1:    group,
	}).Error
}

func (r *PermissionRepository) RemoveGrouping(subject, group string) error {
	return r.db.Where("ptype = 'g' AND v0 = ? AND v1 = ?",
		subject, group).Delete(&models.Permission{}).Error
}

/*
Add a grouping rule
resource: resource
group: group
*/
func (r *PermissionRepository) AddG2Type(resource string, group string) error {
	var permission models.Permission

	return r.db.Where(&models.Permission{
		Ptype: "g2",
		V0:    resource,
		V1:    group,
	}).FirstOrCreate(&permission, models.Permission{
		Ptype: "g2",
		V0:    resource,
		V1:    group,
	}).Error
}

func (r *PermissionRepository) RemovePType(subject, object, action string, permission string) error {
	return r.db.Where("ptype = 'p' AND v0 = ? AND v1 = ? AND v2 = ? AND v3 = ?",
		subject, object, action, permission).Delete(&models.Permission{}).Error
}

// RemoveAllPTypeForObject deletes every "p" rule for a given object,
// regardless of subject - used when re-deriving a resource's grants from
// scratch (e.g. a command's group/user assignments changed, or the command
// was renamed so its "command/<name>" object string changed).
func (r *PermissionRepository) RemoveAllPTypeForObject(object string) error {
	return r.db.Where("ptype = 'p' AND v1 = ?", object).Delete(&models.Permission{}).Error
}

func (r *PermissionRepository) RemoveGType(user string, resource string, role string) error {
	return r.db.Where("ptype = 'g' AND v0 = ? AND v1 = ? AND v2 = ?",
		user, resource, role).Delete(&models.Permission{}).Error
}

func (r *PermissionRepository) RemoveG2Type(resource string, group string) error {
	return r.db.Where("ptype = 'g2' AND v0 = ? AND v1 = ?",
		resource, group).Delete(&models.Permission{}).Error
}

// ListQuery narrows a permission listing. Zero values mean "no filter"; the
// filters are AND-ed. PtypePrefix matches a rule family (e.g. "g" matches both
// "g" and "g2") and is ignored when Ptype is set.
type ListQuery struct {
	Ptype       string
	PtypePrefix string
	Subject     string
}

// List returns the stored Casbin rules. This is a read path
// for management UIs only - the enforcer itself loads policy through the gorm
// adapter, never through this method.
func (r *PermissionRepository) List(q ListQuery) ([]models.Permission, error) {
	var rules []models.Permission

	tx := r.db
	switch {
	case q.Ptype != "":
		tx = tx.Where("ptype = ?", q.Ptype)
	case q.PtypePrefix != "":
		tx = tx.Where("ptype LIKE ?", q.PtypePrefix+"%")
	}
	if q.Subject != "" {
		tx = tx.Where("v0 = ?", q.Subject)
	}

	err := tx.Order("ptype ASC, v0 ASC, v1 ASC, v2 ASC").Find(&rules).Error
	return rules, err
}
