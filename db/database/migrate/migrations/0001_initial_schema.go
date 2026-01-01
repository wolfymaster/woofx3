package migrations

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

func CreateInitialSchema() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0001_initial_schema",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Running initial schema migration...")

			// Create applications table
			if err := tx.Exec(`
CREATE TABLE IF NOT EXISTS public.applications (
	id         UUID      DEFAULT uuid_generate_v4() NOT NULL,
	name       VARCHAR(50)                          NOT NULL,
	user_id    UUID                                 NOT NULL,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP  NOT NULL,
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP  NOT NULL
);
`).Error; err != nil {
				return err
			}

			// Add primary key constraint for applications if not exists
			if err := tx.Exec(`
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'applications_pkey') THEN
		ALTER TABLE public.applications ADD CONSTRAINT applications_pkey PRIMARY KEY (id);
	END IF;
END
$$;
`).Error; err != nil {
				return err
			}

			// Create users table
			if err := tx.Exec(`
CREATE TABLE IF NOT EXISTS public.users (
	id         UUID      DEFAULT uuid_generate_v4() NOT NULL,
	username   VARCHAR(50)                          NOT NULL,
	user_id    VARCHAR(50)                          NOT NULL,
	platform   VARCHAR(20),
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP  NOT NULL,
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP  NOT NULL
);
`).Error; err != nil {
				return err
			}

			// Add primary key constraint for users if not exists
			if err := tx.Exec(`
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_pkey') THEN
		ALTER TABLE public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
	END IF;
END
$$;
`).Error; err != nil {
				return err
			}

			// Create permissions table
			if err := tx.Exec(`
CREATE TABLE IF NOT EXISTS public.permissions (
	id             SERIAL                              NOT NULL,
	application_id UUID                                NOT NULL,
	ptype          VARCHAR(100),
	v0             VARCHAR(100),
	v1             VARCHAR(100),
	v2             VARCHAR(100),
	v3             VARCHAR(100),
	v4             VARCHAR(100),
	v5             VARCHAR(100)
);
`).Error; err != nil {
				return err
			}

			// Add primary key and foreign key constraints for permissions
			if err := tx.Exec(`
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'permissions_pkey') THEN
		ALTER TABLE public.permissions ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);
	END IF;
	
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_permissions_application_id') THEN
		ALTER TABLE public.permissions 
		ADD CONSTRAINT fk_permissions_application_id 
		FOREIGN KEY (application_id) 
		REFERENCES public.applications(id) 
		ON UPDATE CASCADE ON DELETE CASCADE;
	END IF;
END
$$;
`).Error; err != nil {
				return err
			}

			// Create user_events table
			if err := tx.Exec(`
CREATE TABLE IF NOT EXISTS public.user_events (
	id             UUID      DEFAULT uuid_generate_v4() NOT NULL,
	user_id        UUID                                 NOT NULL,
	application_id UUID                                 NOT NULL,
	event_type     VARCHAR(50)                          NOT NULL,
	event_value    JSONB,
	created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP  NOT NULL
);
`).Error; err != nil {
				return err
			}

			// Add constraints for user_events
			if err := tx.Exec(`
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_events_pkey') THEN
		ALTER TABLE public.user_events ADD CONSTRAINT user_events_pkey PRIMARY KEY (id);
	END IF;
	
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_events_user') THEN
		ALTER TABLE public.user_events 
		ADD CONSTRAINT fk_user_events_user 
		FOREIGN KEY (user_id) 
		REFERENCES public.users(id) 
		ON DELETE CASCADE;
	END IF;
	
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_events_application') THEN
		ALTER TABLE public.user_events 
		ADD CONSTRAINT fk_user_events_application 
		FOREIGN KEY (application_id) 
		REFERENCES public.applications(id) 
		ON DELETE CASCADE;
	END IF;
END
$$;
`).Error; err != nil {
				return err
			}

			// Create settings table
			if err := tx.Exec(`
CREATE TABLE IF NOT EXISTS public.settings (
	id             SERIAL                                  NOT NULL,
	application_id UUID                                    NOT NULL,
	user_id        UUID,
	key            VARCHAR(100)                            NOT NULL,
	value          TEXT,
	created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP     NOT NULL,
	updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP     NOT NULL
);
`).Error; err != nil {
				return err
			}

			// Add constraints for settings
			if err := tx.Exec(`
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_pkey') THEN
		ALTER TABLE public.settings ADD CONSTRAINT settings_pkey PRIMARY KEY (id);
	END IF;
	
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_settings_application') THEN
		ALTER TABLE public.settings 
		ADD CONSTRAINT fk_settings_application 
		FOREIGN KEY (application_id) 
		REFERENCES public.applications(id) 
		ON DELETE CASCADE;
	END IF;
	
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_setting') THEN
		ALTER TABLE public.settings 
		ADD CONSTRAINT uq_setting 
		UNIQUE (application_id, key);
	END IF;
END
$$;
`).Error; err != nil {
				return err
			}

			// Create commands table
			if err := tx.Exec(`
CREATE TABLE IF NOT EXISTS public.commands (
	id             UUID      DEFAULT uuid_generate_v4() NOT NULL,
	application_id UUID                                 NOT NULL,
	command        VARCHAR(255)                         NOT NULL,
	type           VARCHAR(50)                          NOT NULL,
	type_value     VARCHAR(500),
	cooldown       INTEGER   DEFAULT 0,
	created_by     UUID,
	priority       INTEGER   DEFAULT 0,
	enabled        BOOLEAN   DEFAULT TRUE               NOT NULL,
	created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP  NOT NULL
);
`).Error; err != nil {
				return err
			}

			// Add constraints for commands
			if err := tx.Exec(`
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commands_pkey') THEN
		ALTER TABLE public.commands ADD CONSTRAINT commands_pkey PRIMARY KEY (id);
	END IF;
	
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_commands_application') THEN
		ALTER TABLE public.commands 
		ADD CONSTRAINT fk_commands_application 
		FOREIGN KEY (application_id) 
		REFERENCES public.applications(id) 
		ON DELETE CASCADE;
	END IF;
END
$$;
`).Error; err != nil {
				return err
			}

			// Create user_applications table
			if err := tx.Exec(`
CREATE TABLE IF NOT EXISTS public.user_applications (
	id             UUID                     DEFAULT uuid_generate_v4() NOT NULL,
	user_id        UUID                                                NOT NULL,
	application_id UUID                                                NOT NULL,
	role           VARCHAR(50)                                         NOT NULL,
	created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()              NOT NULL
);
`).Error; err != nil {
				return err
			}

			// Add constraints for user_applications
			if err := tx.Exec(`
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_applications_pkey') THEN
		ALTER TABLE public.user_applications ADD CONSTRAINT user_applications_pkey PRIMARY KEY (id);
	END IF;
	
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_user_applications') THEN
		ALTER TABLE public.user_applications 
		ADD CONSTRAINT fk_users_user_applications 
		FOREIGN KEY (user_id) 
		REFERENCES public.users(id);
	END IF;
	
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_applications_user_applications') THEN
		ALTER TABLE public.user_applications 
		ADD CONSTRAINT fk_applications_user_applications 
		FOREIGN KEY (application_id) 
		REFERENCES public.applications(id);
	END IF;
END
$$;
`).Error; err != nil {
				return err
			}

			// Create user_meta table
			if err := tx.Exec(`
CREATE TABLE IF NOT EXISTS public.user_meta (
	id         UUID                     DEFAULT uuid_generate_v4() NOT NULL,
	userid     UUID                                                NOT NULL,
	name       VARCHAR(50)                                         NOT NULL,
	type       VARCHAR(50)                                         NOT NULL,
	value      VARCHAR(500),
	created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP  NOT NULL
);
`).Error; err != nil {
				return err
			}

			// Add constraints for user_meta
			if err := tx.Exec(`
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_meta_pkey') THEN
		ALTER TABLE public.user_meta ADD CONSTRAINT user_meta_pkey PRIMARY KEY (id);
	END IF;
	
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_user_meta') THEN
		ALTER TABLE public.user_meta 
		ADD CONSTRAINT fk_users_user_meta 
		FOREIGN KEY (userid) 
		REFERENCES public.users(id);
	END IF;
END
$$;
`).Error; err != nil {
				return err
			}

			// Create clients table
			if err := tx.Exec(`
CREATE TABLE IF NOT EXISTS public.clients (
	id             BIGSERIAL                          NOT NULL,
	description    VARCHAR(100),
	application_id UUID                               NOT NULL,
	client_id      UUID                               NOT NULL,
	client_secret  VARCHAR(100)                       NOT NULL
);
`).Error; err != nil {
				return err
			}

			// Add constraints for clients
			if err := tx.Exec(`
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_pkey') THEN
		ALTER TABLE public.clients ADD CONSTRAINT clients_pkey PRIMARY KEY (id);
	END IF;
	
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_clients_application') THEN
		ALTER TABLE public.clients 
		ADD CONSTRAINT fk_clients_application 
		FOREIGN KEY (application_id) 
		REFERENCES public.applications(id) 
		ON DELETE CASCADE;
	END IF;
END
$$;
`).Error; err != nil {
				return err
			}

			// Create rewards table
			if err := tx.Exec(`
CREATE TABLE IF NOT EXISTS public.rewards (
	id             SERIAL                                  NOT NULL,
	client         VARCHAR(100)                            NOT NULL,
	name           VARCHAR(100)                            NOT NULL,
	activation_min INTEGER,
	activation_max INTEGER,
	type           VARCHAR(20)                             NOT NULL,
	type_value     JSON                                    NOT NULL,
	created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP     NOT NULL
);
`).Error; err != nil {
				return err
			}

			// Add primary key for rewards
			if err := tx.Exec(`
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rewards_pkey') THEN
		ALTER TABLE public.rewards ADD CONSTRAINT rewards_pkey PRIMARY KEY (id);
	END IF;
END
$$;
`).Error; err != nil {
				return err
			}

			// Create all indexes if they don't exist
			indexes := []string{
				"CREATE INDEX IF NOT EXISTS idx_applications_user_id ON public.applications (user_id)",
				"CREATE UNIQUE INDEX IF NOT EXISTS idx_permissions ON public.permissions (ptype, v0, v1, v2, v3, v4, v5)",
				"CREATE INDEX IF NOT EXISTS idx_permission_application_id ON public.permissions (application_id)",
				"CREATE INDEX IF NOT EXISTS idx_permission_ptype ON public.permissions (ptype)",
				"CREATE INDEX IF NOT EXISTS idx_permission_v0 ON public.permissions (v0)",
				"CREATE INDEX IF NOT EXISTS idx_permission_v1 ON public.permissions (v1)",
				"CREATE INDEX IF NOT EXISTS idx_permission_v2 ON public.permissions (v2)",
				"CREATE INDEX IF NOT EXISTS idx_commands_application_id ON public.commands (application_id)",
				"CREATE INDEX IF NOT EXISTS idx_user_app_application ON public.user_applications (application_id)",
				"CREATE INDEX IF NOT EXISTS idx_user_app_user ON public.user_applications (user_id)",
				"CREATE UNIQUE INDEX IF NOT EXISTS idx_user_app_unique ON public.user_applications (user_id, application_id)",
				"CREATE INDEX IF NOT EXISTS idx_user_meta_userid ON public.user_meta (userid)",
				"CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_client_id ON public.clients (client_id)",
			}

			for _, indexSQL := range indexes {
				if err := tx.Exec(indexSQL).Error; err != nil {
					return err
				}
			}

			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			tables := []string{
				"rewards",
				"clients",
				"user_meta",
				"user_applications",
				"commands",
				"settings",
				"user_events",
				"permissions",
				"applications",
				"users",
				"vods",
				"migrations",
			}

			for _, table := range tables {
				if err := tx.Exec("DROP TABLE IF EXISTS public." + table + " CASCADE").Error; err != nil {
					return err
				}
			}
			return nil
		},
	}
}
