package models

type Setting struct {
	ID            int    `gorm:"primaryKey;autoIncrement"`
	BroadcasterID int    `gorm:"not null;index:idx_settings_broadcaster_setting,priority:1"`
	SettingName   string `gorm:"type:varchar(100);not null;index:idx_settings_broadcaster_setting,priority:2"`
	SettingValue  string `gorm:"type:text"`
}

func (Setting) TableName() string {
	return "settings"
}
