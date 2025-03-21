package models

type Reward struct {
	ID int `gorm:"primaryKey;autoIncrement`
	Client string `gorm:"type:varchar(100);not null;"`
	Name string `gorm:"type:varchar(100);not null;"`
	ActivationMin int `gorm:"not null;"`
	ActivationMax int `gorm:"not null;"`	
	Type string `gorm:"type:varchar(20);not null;"`
	TypeValue JSONB `gorm:"column:eventvalue;type:jsonb"`
	CreatedAt  time.Time `gorm:"column:createdat;default:CURRENT_TIMESTAMP;not null"`
}

func (Reward) TableName() string {
	return "rewards"
}