package models

type Permission struct {
	ID    int    `gorm:"primaryKey;autoIncrement"`
	Ptype string `gorm:"column:ptype;type:varchar(100);not null;index:idx_permission_ptype"`
	V0    string `gorm:"column:v0;type:varchar(100);index:idx_permission_v0"`
	V1    string `gorm:"column:v1;type:varchar(100);index:idx_permission_v1"`
	V2    string `gorm:"column:v2;type:varchar(100);index:idx_permission_v2"`
	V3    string `gorm:"column:v3;type:varchar(100)"`
	V4    string `gorm:"column:v4;type:varchar(100)"`
	V5    string `gorm:"column:v5;type:varchar(100)"`
}

func (Permission) TableName() string {
	return "permissions"
}
